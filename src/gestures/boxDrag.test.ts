import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { beginBoxDrag, type BoxDrag } from './boxDrag'
import { mapScope, useModelStore, PROJECT_SCOPE } from '@/stores/model'
import { useDoorDefaultsStore } from '@/stores/doorDefaults'
import { createNewLockType } from '@/core/ops/project'
import { resolveEscape } from '@/hotkeys/escStack'
import { paintCells } from '@/core/ops/rooms'
import { checkInvariants } from '@/core/testUtils'
import { OPEN_LOCK_ID, WORLD_AREA_ID } from '@/core/ids'
import type { MapId } from '@/core/ids'
import type { MapModel, Transition } from '@/core/types'

// The gesture takes world points, where (1.5, 0.5) is the middle of cell (1,0).
function centre(x: number, y: number) {
  return { x: x + 0.5, y: y + 0.5 }
}

describe('beginBoxDrag', () => {
  let onChange: Mock<() => void>

  beforeEach(() => {
    setActivePinia(createTestPinia())
    onChange = vi.fn<() => void>()
  })

  function firstMap(): { mapId: MapId; map: MapModel } {
    const model = useModelStore()
    const mapId = model.project.maps[0]
    return { mapId, map: model.project.mapsById.get(mapId)! }
  }

  function room(cells: string[]) {
    const model = useModelStore()
    const { mapId, map } = firstMap()
    return model.run('Setup', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, map, cells, { areaId: WORLD_AREA_ID }),
    ).id
  }

  // Two 1x3 rooms either side of the seam at x = 1, adjacent, so boxes across
  // it are doors.
  function twoRooms() {
    room(['0,0', '0,1', '0,2'])
    room(['1,0', '1,1', '1,2'])
  }

  // Two rooms with a two-cell gap between them on row 0: elevator territory.
  function acrossAGap() {
    room(['0,0'])
    room(['3,0'])
  }

  function drag(from: string): BoxDrag {
    const box = beginBoxDrag(firstMap().mapId, from, onChange)
    expect(box).not.toBeNull()
    return box!
  }

  function transitions(): Transition[] {
    return [...firstMap().map.transitions.values()]
  }

  // Run a whole drag and commit it, the way the component does.
  function dragFromTo(from: string, to: [number, number]) {
    const box = drag(from)
    box.moveTo(centre(to[0], to[1]))
    box.commit()
    return box
  }

  describe('the preview', () => {
    // A press that has not moved is a click, which resolves to the teleport
    // gesture, so it must not flash a refusal under every click.
    it('shows nothing while the box is still one cell', () => {
      twoRooms()
      const box = drag('0,0')

      expect(box.preview).toBeNull()
    })

    it('appears with the outcome once the box reaches another cell', () => {
      twoRooms()
      const box = drag('0,0')
      box.moveTo(centre(1, 0))

      expect(box.preview).toEqual({ from: '0,0', to: '1,0', outcome: 'edge' })
    })

    it('says elevator across a gap, and invalid where nothing connects', () => {
      acrossAGap()
      const box = drag('0,0')

      box.moveTo(centre(3, 0))
      expect(box.preview?.outcome).toBe('elevator')

      // Into the gap but not across it: no second room, so nothing connects.
      box.moveTo(centre(2, 0))
      expect(box.preview?.outcome).toBe('invalid')
    })

    // A box thicker than 2 cells across the boundary is invalid: the easiest
    // invalid case to reach by accident, because it is one cell further than
    // the door you meant.
    it('says invalid for a box more than two thick across the seam', () => {
      room(['0,0', '1,0', '2,0', '0,1', '1,1', '2,1'])
      room(['0,2', '1,2', '2,2', '0,3', '1,3', '2,3'])

      // 1 wide x 2 tall, straddling the seam at y = 2: a door.
      const door = drag('0,1')
      door.moveTo(centre(0, 2))
      expect(door.preview?.outcome).toBe('edge')

      // The same seam, one cell deeper on each side: 4 thick, so it cancels.
      // Note what it is not: this is also a 1-thick box, so it falls through
      // to the elevator test and is rejected there for having no gap rather
      // than by the thickness rule. Both roads lead to a refusal, which is
      // the point.
      const tooThick = drag('0,0')
      tooThick.moveTo(centre(0, 3))
      expect(tooThick.preview?.outcome).toBe('invalid')
    })

    // Backtracking shrinks the box, so the outcome has to come back with it.
    it('follows the pointer back, returning to no preview at the origin', () => {
      twoRooms()
      const box = drag('0,0')

      box.moveTo(centre(1, 0))
      expect(box.preview?.outcome).toBe('edge')
      box.moveTo(centre(0, 0))
      expect(box.preview).toBeNull()
    })

    it('repaints only when the far corner changes cells', () => {
      twoRooms()
      const box = drag('0,0')

      box.moveTo({ x: 1.2, y: 0.2 })
      expect(onChange).toHaveBeenCalledTimes(1)
      // Same cell, different point: nothing has changed to draw.
      box.moveTo({ x: 1.8, y: 0.8 })
      expect(onChange).toHaveBeenCalledTimes(1)
    })
  })

  describe('what it commits', () => {
    // A 1x2 box across the seam is the basic door gesture.
    it('makes a door from a 1x2 box across a seam', () => {
      twoRooms()
      dragFromTo('0,0', [1, 0])

      expect(transitions()).toHaveLength(1)
      const door = transitions()[0]
      expect(door.kind).toBe('edge')
      expect(door.kind === 'edge' && door.segments).toHaveLength(1)
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    it('makes an N-wide door from an N-long box', () => {
      twoRooms()
      dragFromTo('0,0', [1, 2])

      const door = transitions()[0]
      expect(door.kind === 'edge' && door.segments).toHaveLength(3)
    })

    // Segments are grouped into separate transition objects per room-pair, so
    // one drag across two different neighbours makes two doors, not one.
    it('groups a drag spanning two room pairs into two doors', () => {
      // A column of three against two separate neighbours, with a hole between
      // them: cell (1,1) is empty, so the box holds two cross-room edges in two
      // different pairs and nothing joins them.
      room(['0,0', '0,1', '0,2'])
      room(['1,0'])
      room(['1,2'])
      dragFromTo('0,0', [1, 2])

      expect(transitions()).toHaveLength(2)
      expect(transitions().every((each) => each.kind === 'edge')).toBe(true)
    })

    // Doors cannot be diagonal, so a corner box resolves by the ordinary cell
    // walk into a horizontal door plus a vertical one.
    it('makes two doors from a 2x2 corner box', () => {
      room(['0,0'])
      room(['1,0', '1,1', '0,1'])
      dragFromTo('0,0', [1, 1])

      const axes = transitions()
        .flatMap((each) => (each.kind === 'edge' ? each.segments : []))
        .map((segment) => segment.edge.split(',')[2])
        .sort()
      expect(transitions()).toHaveLength(2)
      expect(axes).toEqual(['H', 'V'])
    })

    // Endpoints snap to the facing edges even if the released cell was not
    // literally on that edge: here the drag is released two cells deep into
    // the destination room.
    it('makes an elevator across a gap, snapped to the facing edges', () => {
      room(['0,0'])
      room(['3,0', '4,0', '5,0'])
      dragFromTo('0,0', [5, 0])

      const elevator = transitions()[0]
      expect(elevator.kind).toBe('elevator')
      if (elevator.kind !== 'elevator') throw new Error('expected an elevator')
      expect([elevator.a, elevator.b]).toEqual(['0,0', '3,0'])
      expect(elevator.axis).toBe('h')
    })

    it('commits nothing for an invalid box', () => {
      acrossAGap()
      dragFromTo('0,0', [2, 0])

      expect(transitions()).toEqual([])
    })

    it('commits nothing when the box never left its origin cell', () => {
      twoRooms()
      const box = drag('0,0')
      box.commit()

      expect(transitions()).toEqual([])
    })

    // Out and back to the origin leaves the model exactly as it was: not
    // restored, but never changed, because every re-apply runs against the
    // pristine model.
    it('leaves nothing behind when the pointer returns to the origin', () => {
      twoRooms()
      const box = drag('0,0')
      box.moveTo(centre(1, 2))
      box.moveTo(centre(0, 0))
      box.commit()

      expect(transitions()).toEqual([])
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })
  })

  describe('as one undo step', () => {
    it('puts the whole drag on the stack once, whatever it passed through', () => {
      twoRooms()
      const model = useModelStore()

      const box = drag('0,0')
      box.moveTo(centre(1, 0))
      box.moveTo(centre(1, 1))
      box.moveTo(centre(1, 2))
      box.commit()

      expect(model.status.undoLabel).toBe('Add Transition')
      expect(transitions()).toHaveLength(1)

      // One step for the whole drag: the undo that removes the door leaves the
      // rooms it was drawn between alone.
      model.undo()
      expect(transitions()).toEqual([])
      expect(model.status.undoLabel).toBe('Setup')
    })

    // Even the drag that made two objects: one gesture, one transaction.
    it('undoes both doors of a two-pair drag together', () => {
      room(['0,0', '0,1', '0,2'])
      room(['1,0'])
      room(['1,2'])
      const model = useModelStore()

      dragFromTo('0,0', [1, 2])
      expect(transitions()).toHaveLength(2)

      model.undo()
      expect(transitions()).toEqual([])
    })

    it('adds no undo step for a box that classified to nothing', () => {
      acrossAGap()
      const model = useModelStore()

      dragFromTo('0,0', [2, 0])

      // The last thing on the stack is still the room that was painted before
      // the drag: an empty transaction never reached it.
      expect(model.status.undoLabel).toBe('Setup')
    })
  })

  describe('Esc', () => {
    it('aborts the drag, leaving nothing on the model or the stack', () => {
      twoRooms()
      const model = useModelStore()

      const box = drag('0,0')
      box.moveTo(centre(1, 1))
      expect(transitions()).toHaveLength(1)

      expect(resolveEscape()).toBe(true)
      expect(transitions()).toEqual([])
      expect(model.status.undoLabel).toBe('Setup')
    })

    // The pointerup that was always coming still arrives after an `Esc`, and it
    // must not resurrect the gesture.
    it('makes the pointerup that follows it harmless', () => {
      twoRooms()
      const box = drag('0,0')
      box.moveTo(centre(1, 1))
      resolveEscape()

      box.moveTo(centre(1, 2))
      box.commit()

      expect(transitions()).toEqual([])
      expect(box.preview).toBeNull()
    })
  })

  // The whole point of the toolbar strip: set it once, draw several. The
  // defaults are read on every re-apply rather than captured at press, so
  // changing the picker mid-drag re-colours the ghost you are looking at.
  describe('the creation defaults', () => {
    it('gives a new door the lock and direction the strip says', () => {
      const model = useModelStore()
      const missile = model.run('Add Lock', PROJECT_SCOPE, (tx) =>
        createNewLockType(tx, model.project, 'Missile Door', '#e23b3b'),
      )
      const defaults = useDoorDefaultsStore()
      defaults.selectLock(missile.id)
      defaults.setOneWay(true)
      twoRooms()

      dragFromTo('0,0', [1, 0])

      const door = transitions()[0]
      expect(door.locks).toEqual({ a: missile.id, b: missile.id })
      expect(door.direction).toBe('aToB')
    })

    it('gives an elevator the same, and defaults to Open two-way', () => {
      const defaults = useDoorDefaultsStore()
      acrossAGap()

      dragFromTo('0,0', [3, 0])
      const plain = transitions()[0]
      expect(plain.locks).toEqual({ a: OPEN_LOCK_ID, b: OPEN_LOCK_ID })
      expect(plain.direction).toBe('both')

      defaults.setOneWay(true)
      const model = useModelStore()
      model.run('More rooms', mapScope(firstMap().mapId), (tx) =>
        paintCells(tx, model.project, firstMap().map, ['0,3'], { areaId: WORLD_AREA_ID }),
      )
      model.run('More rooms', mapScope(firstMap().mapId), (tx) =>
        paintCells(tx, model.project, firstMap().map, ['3,3'], { areaId: WORLD_AREA_ID }),
      )
      dragFromTo('0,3', [3, 3])
      expect(transitions().some((each) => each.direction === 'aToB')).toBe(true)
    })
  })

  it('answers null when the map is gone', () => {
    expect(beginBoxDrag('map_gone' as MapId, '0,0', onChange)).toBeNull()
  })
})
