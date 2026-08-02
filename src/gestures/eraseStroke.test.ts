import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { beginEraseStroke } from './eraseStroke'
import { mapScope, useModelStore } from '@/stores/model'
import { pushEscHandler, resolveEscape } from '@/hotkeys/escStack'
import { paintCells } from '@/core/ops/rooms'
import { toJSON } from '@/core/serialize'
import { checkInvariants } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { CellStroke } from './cellStroke'
import type { MapId, RoomId } from '@/core/ids'
import type { MapModel } from '@/core/types'

// The gesture takes world points, where (1.5, 0.5) is the middle of cell (1,0).
function centre(x: number, y: number) {
  return { x: x + 0.5, y: y + 0.5 }
}

describe('beginEraseStroke', () => {
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

  function press(x: number, y: number): CellStroke {
    const stroke = beginEraseStroke(firstMap().mapId, centre(x, y), onChange)
    expect(stroke).not.toBeNull()
    return stroke!
  }

  // A room painted outside any gesture, to erase from.
  function existingRoom(cells: string[]): RoomId {
    const model = useModelStore()
    const { mapId, map } = firstMap()
    return model.run('Setup', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, map, cells, { areaId: WORLD_AREA_ID }),
    ).id
  }

  function occupied(cell: string): boolean {
    return firstMap().map.cellOwner.has(cell)
  }

  describe('the stroke', () => {
    it('erases the origin cell on press, before anything moves', () => {
      existingRoom(['2,3', '3,3'])
      const stroke = press(2, 3)
      expect(occupied('2,3')).toBe(false)
      expect(occupied('3,3')).toBe(true)
      stroke.cancel()
    })

    it('publishes nothing until release', () => {
      const model = useModelStore()
      existingRoom(['2,3'])
      const stroke = press(2, 3)

      expect(model.status.canUndo).toBe(true) // the setup paint, not the erase
      expect(model.status.undoLabel).toBe('Setup')

      stroke.commit()
      expect(model.status.undoLabel).toBe('Erase')
    })

    it('erases the union of every cell the drag crossed', () => {
      existingRoom(['0,0', '1,0', '2,0', '3,0', '4,0'])

      const stroke = press(0, 0)
      stroke.extendTo(centre(3, 0))
      stroke.commit()

      expect(['0,0', '1,0', '2,0', '3,0'].some(occupied)).toBe(false)
      expect(occupied('4,0')).toBe(true)
    })

    // Same free-form rule as paint, inherited from the shared driver: the union
    // only ever grows, so dragging back over erased cells does not restore them.
    it('does not un-erase on the way back', () => {
      existingRoom(['0,0', '1,0', '2,0', '3,0'])

      const stroke = press(0, 0)
      stroke.extendTo(centre(3, 0))
      stroke.extendTo(centre(0, 0))
      stroke.commit()

      expect(firstMap().map.rooms.size).toBe(0)
    })

    it('repaints only when the union actually grew', () => {
      existingRoom(['0,0', '1,0'])
      const stroke = press(0, 0)
      onChange.mockClear()

      stroke.extendTo({ x: 0.6, y: 0.6 })
      expect(onChange).not.toHaveBeenCalled()

      stroke.extendTo(centre(1, 0))
      expect(onChange).toHaveBeenCalledTimes(1)
      stroke.cancel()
    })

    // A stroke does not have to start on a room: erasing off empty grid and
    // dragging onto one is a normal way to clip an edge.
    it('erases a room a stroke wandered onto from empty grid', () => {
      existingRoom(['3,0'])

      const stroke = press(0, 0)
      stroke.extendTo(centre(3, 0))
      stroke.commit()

      expect(firstMap().map.rooms.size).toBe(0)
    })

    it('adds no ghost overlay: erase destroys rather than absorbs', () => {
      existingRoom(['0,0', '1,0', '2,0'])
      const stroke = press(0, 0)
      stroke.extendTo(centre(2, 0))

      expect(stroke.absorbing.size).toBe(0)
      stroke.cancel()
    })
  })

  describe('splitting', () => {
    // This is core's split rule. What is being proved here is that the gesture
    // lets it happen, which is the whole reason erase names no origin room.
    it('splits a room erased through the middle', () => {
      const model = useModelStore()
      const roomId = existingRoom(['0,0', '1,0', '2,0'])

      const stroke = press(1, 0)
      stroke.commit()

      const { map } = firstMap()
      expect(map.rooms.size).toBe(2)
      // The top-most, then left-most group keeps the original identity.
      expect(map.cellOwner.get('0,0')).toBe(roomId)
      expect(map.cellOwner.get('2,0')).not.toBe(roomId)
      expect(checkInvariants(model.project)).toEqual([])
    })

    // The hazard the gesture is shaped to avoid: after the first re-apply the
    // room the stroke started on may have been split, or may not exist at all.
    // Paint has to lock its origin room because merge needs a winner; erase
    // holds no room id, so every re-apply reads the world afresh.
    it('keeps re-applying after the room it started on is gone', () => {
      const model = useModelStore()
      existingRoom(['0,0', '1,0', '2,0'])

      const stroke = press(1, 0) // splits it in two
      stroke.extendTo(centre(0, 0)) // one half gone
      stroke.extendTo(centre(2, 0)) // the other half gone
      stroke.extendTo(centre(5, 0)) // and on across empty grid
      stroke.commit()

      expect(firstMap().map.rooms.size).toBe(0)
      expect(checkInvariants(model.project)).toEqual([])
    })

    // The union is contiguous by construction (the supercover fills in the
    // cells between samples), so a single stroke cuts a strip into at most two
    // pieces however wide the gouge is.
    it('leaves the two ends when a drag erases a whole middle', () => {
      const model = useModelStore()
      existingRoom(['0,0', '1,0', '2,0', '3,0', '4,0'])

      const stroke = press(1, 0)
      stroke.extendTo(centre(3, 0))
      stroke.commit()

      const { map } = firstMap()
      expect(map.rooms.size).toBe(2)
      expect([...map.cellOwner.keys()].sort()).toEqual(['0,0', '4,0'])
      expect(checkInvariants(model.project)).toEqual([])
    })
  })

  describe('settling', () => {
    it('leaves no undo step when the stroke erased nothing', () => {
      const model = useModelStore()
      const before = model.status.undoLabel

      const stroke = press(0, 0)
      stroke.extendTo(centre(3, 0))
      stroke.commit()

      expect(model.status.undoLabel).toBe(before)
      expect(model.status.undoLabel).not.toBe('Erase')
    })

    it('commits the whole swath as one undo step', () => {
      const model = useModelStore()
      const cells = Array.from({ length: 11 }, (_, x) => `${x},0`)
      existingRoom(cells)

      const stroke = press(0, 0)
      for (let x = 1; x <= 10; x++) stroke.extendTo(centre(x, 0))
      stroke.commit()
      expect(firstMap().map.rooms.size).toBe(0)

      model.undo()
      expect(firstMap().map.rooms.size).toBe(1)
      expect(cells.every(occupied)).toBe(true)
    })

    it('rolls back to the byte-identical project it started from', () => {
      const model = useModelStore()
      existingRoom(['4,4', '5,4', '4,5', '5,5'])
      const before = JSON.stringify(toJSON(model.project))

      const stroke = press(4, 4)
      for (let i = 0; i < 500; i++) {
        stroke.extendTo(centre(i % 9, Math.floor(i / 9) % 7))
      }
      expect(firstMap().map.rooms.size).toBe(0)

      stroke.cancel()
      expect(JSON.stringify(toJSON(model.project))).toBe(before)
      expect(checkInvariants(model.project)).toEqual([])
    })

    it('undoes a five-hundred-move stroke back to byte-identical too', () => {
      const model = useModelStore()
      existingRoom(['4,4', '5,4', '4,5', '5,5'])
      const before = JSON.stringify(toJSON(model.project))

      const stroke = press(4, 4)
      for (let i = 0; i < 500; i++) {
        stroke.extendTo(centre(i % 9, Math.floor(i / 9) % 7))
      }
      stroke.commit()
      expect(checkInvariants(model.project)).toEqual([])

      model.undo()
      expect(JSON.stringify(toJSON(model.project))).toBe(before)
    })

    // The split rule mints rooms, so erase has the same id-stability
    // requirement paint does: without `Transaction.reset()` rewinding the id
    // source, every pointer move would give the split-off half a new id.
    it('keeps a split-off room at the same id across every re-apply', () => {
      existingRoom(['0,0', '1,0', '2,0'])

      const stroke = press(1, 0)
      const splitOff = firstMap().map.cellOwner.get('2,0')
      expect(splitOff).toBeDefined()

      for (let y = 1; y <= 20; y++) stroke.extendTo(centre(1, y))
      expect(firstMap().map.cellOwner.get('2,0')).toBe(splitOff)

      stroke.commit()
      expect(firstMap().map.cellOwner.get('2,0')).toBe(splitOff)
    })

    it('is a no-op to commit after cancelling', () => {
      const model = useModelStore()
      existingRoom(['0,0'])
      const stroke = press(0, 0)
      stroke.cancel()
      stroke.commit()

      expect(occupied('0,0')).toBe(true)
      expect(model.status.undoLabel).toBe('Setup')
    })
  })

  describe('Esc', () => {
    it('aborts the stroke and commits nothing', () => {
      const model = useModelStore()
      existingRoom(['0,0', '1,0', '2,0', '3,0'])
      const stroke = press(0, 0)
      stroke.extendTo(centre(3, 0))
      expect(firstMap().map.rooms.size).toBe(0)

      expect(resolveEscape()).toBe(true)
      expect(firstMap().map.rooms.size).toBe(1)
      expect(model.status.undoLabel).toBe('Setup')
      expect(onChange).toHaveBeenCalled()
    })

    // Proved against a sentinel underneath rather than against an empty stack:
    // the tiers are module-global, so "nothing is registered" would be an
    // assertion about every other test in the file.
    it('unregisters itself once the stroke has settled', () => {
      const sentinel = vi.fn<() => void>()
      const pop = pushEscHandler('gesture', sentinel)

      const stroke = press(0, 0)
      stroke.commit()

      expect(resolveEscape()).toBe(true)
      expect(sentinel).toHaveBeenCalledTimes(1)
      pop()
    })

    // The tier matters, not just that Esc arrives. The precedence stack puts an
    // in-progress gesture above the selection, so a first press aborts the drag
    // and only a second one deselects.
    //
    // The sentinel goes in underneath after the stroke has started, on top of
    // its own tier: registering it first would prove nothing, because a stroke
    // wrongly registered in the selection tier would then still be the later
    // push and still win on ordering alone. (The registration lives in
    // cellStroke, shared with paint.)
    //
    // This is also why every test above settles its stroke: the tiers are
    // module-global, so a stroke left open leaves a live handler sitting in the
    // gesture tier for the rest of the file, and this assertion would then be
    // about that stroke rather than this one.
    it('aborts ahead of anything in a lower tier', () => {
      const deselect = vi.fn<() => void>()
      existingRoom(['0,0'])
      const stroke = press(0, 0)
      const pop = pushEscHandler('selection', deselect)

      resolveEscape()

      expect(deselect).not.toHaveBeenCalled()
      expect(occupied('0,0')).toBe(true)
      pop()
      stroke.commit()
    })

    it('leaves the eventual release harmless', () => {
      const model = useModelStore()
      existingRoom(['0,0', '1,0', '2,0', '3,0', '4,0'])
      const stroke = press(0, 0)
      stroke.extendTo(centre(3, 0))
      resolveEscape()

      // The user is still holding the button down; the pointerup still comes.
      stroke.extendTo(centre(4, 0))
      stroke.commit()

      expect(firstMap().map.rooms.size).toBe(1)
      expect(model.status.undoLabel).toBe('Setup')
    })
  })

  it('declines to start on a map that is not there', () => {
    expect(beginEraseStroke('map_gone' as MapId, centre(0, 0), onChange)).toBeNull()
  })
})
