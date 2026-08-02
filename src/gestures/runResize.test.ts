import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { beginRunResize, handleGrabAllowed, type RunResize } from './runResize'
import { mapScope, useModelStore } from '@/stores/model'
import { pushEscHandler, resolveEscape } from '@/hotkeys/escStack'
import { paintCells } from '@/core/ops/rooms'
import { resizableRuns } from '@/core/derive/walls'
import { toJSON } from '@/core/serialize'
import { checkInvariants } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { EdgeRun } from '@/core/derive/walls'
import type { Side } from '@/core/cell'
import type { MapId, RoomId } from '@/core/ids'
import type { MapModel } from '@/core/types'

// The gesture takes world points, where (1.5, 0.5) is the middle of cell (1,0).
function centre(x: number, y: number) {
  return { x: x + 0.5, y: y + 0.5 }
}

describe('beginRunResize', () => {
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

  function room(cells: string[]): RoomId {
    const model = useModelStore()
    const { mapId, map } = firstMap()
    return model.run('Setup', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, map, cells, { areaId: WORLD_AREA_ID }),
    ).id
  }

  // The run on one side of a room. Every test grabs its run this way rather
  // than building an `EdgeRun` by hand, so what is being resized is what the
  // renderer would actually have drawn a handle on.
  function runOn(roomId: RoomId, side: Side): EdgeRun {
    const runs = resizableRuns(firstMap().map.rooms.get(roomId)!).filter((r) => r.side === side)
    expect(runs).toHaveLength(1)
    return runs[0]
  }

  function grab(roomId: RoomId, side: Side): RunResize {
    const resize = beginRunResize(firstMap().mapId, roomId, runOn(roomId, side), onChange)
    expect(resize).not.toBeNull()
    return resize!
  }

  function cellsOf(roomId: RoomId): string[] {
    return [...(firstMap().map.rooms.get(roomId)?.cells ?? [])].sort()
  }

  function owner(cell: string): RoomId | undefined {
    return firstMap().map.cellOwner.get(cell)
  }

  describe('the pointer, as a distance', () => {
    // The rule stated without arithmetic: the run moves so that the cell under
    // the pointer is the new boundary cell. Nothing is rounded, so there is no
    // threshold to get wrong at a boundary.
    it('starts at zero and changes nothing on press', () => {
      const id = room(['0,0', '1,0', '0,1', '1,1'])
      const before = cellsOf(id)

      const resize = grab(id, 'E')
      expect(resize.distance).toBe(0)
      expect(cellsOf(id)).toEqual(before)
      resize.cancel()
    })

    // A press on a run is always inside the run's own cell, because
    // `drawZone`'s rule 1 is that the pointer's cell decides the room: a
    // press starting at zero is structural, not a coincidence of this fixture.
    it('counts whole cells outward from the run', () => {
      const id = room(['0,0', '1,0', '0,1', '1,1'])
      const resize = grab(id, 'E')

      resize.moveTo(centre(2, 0))
      expect(resize.distance).toBe(1)
      resize.moveTo(centre(4, 0))
      expect(resize.distance).toBe(3)
      resize.moveTo(centre(0, 0))
      expect(resize.distance).toBe(-1)
      resize.cancel()
    })

    // The cell, not a rounded displacement from the edge line: that is the
    // other obvious way to write this, and it is wrong. The press has to land
    // inside the run's own cell (drawZone rule 1) but can land anywhere in it,
    // and the band is clamped below a quarter cell, so at low zoom most of the
    // cell is not near the line at all. A rounding rule would already be
    // shrinking from a press at the cell's inner edge.
    it('stays at zero anywhere within the run’s own cell', () => {
      const id = room(['0,0', '1,0', '0,1', '1,1'])
      const resize = grab(id, 'E')

      for (const x of [1.99, 1.5, 1.01]) {
        resize.moveTo({ x, y: 0.5 })
        expect(resize.distance).toBe(0)
      }
      expect(cellsOf(id)).toEqual(['0,0', '0,1', '1,0', '1,1'])
      resize.cancel()
    })

    // Grabbed-run-only, from the pointer's side: displacement across the run
    // is the whole input, and sliding along it is not displacement.
    it('ignores movement along the run', () => {
      const id = room(['0,0', '1,0', '0,1', '1,1'])
      const resize = grab(id, 'E')
      const before = cellsOf(id)

      resize.moveTo(centre(1, 1))
      resize.moveTo(centre(1, 9))
      resize.moveTo(centre(1, -9))

      expect(resize.distance).toBe(0)
      expect(cellsOf(id)).toEqual(before)
      resize.cancel()
    })

    it('measures every side outward from the room', () => {
      const id = room(['0,0', '1,0', '0,1', '1,1'])

      const north = grab(id, 'N')
      north.moveTo(centre(0, -2))
      expect(north.distance).toBe(2)
      north.cancel()

      const south = grab(id, 'S')
      south.moveTo(centre(0, 3))
      expect(south.distance).toBe(2)
      south.cancel()

      const west = grab(id, 'W')
      west.moveTo(centre(-2, 0))
      expect(west.distance).toBe(2)
      west.cancel()
    })

    it('repaints only when the distance actually changed', () => {
      const id = room(['0,0', '1,0', '0,1', '1,1'])
      const resize = grab(id, 'E')
      onChange.mockClear()

      // Both inside cell (2,0): a different pixel, the same cell.
      resize.moveTo({ x: 2.1, y: 0.1 })
      expect(onChange).toHaveBeenCalledTimes(1)
      resize.moveTo({ x: 2.9, y: 0.9 })
      expect(onChange).toHaveBeenCalledTimes(1)

      resize.moveTo(centre(3, 0))
      expect(onChange).toHaveBeenCalledTimes(2)
      resize.cancel()
    })
  })

  describe('expanding', () => {
    it('extrudes the run by whole cells', () => {
      const id = room(['0,0', '1,0', '0,1', '1,1'])
      const resize = grab(id, 'E')

      resize.moveTo(centre(3, 0))
      resize.commit()

      expect(cellsOf(id)).toEqual(['0,0', '0,1', '1,0', '1,1', '2,0', '2,1', '3,0', '3,1'])
    })

    // Grabs c1's right edge (the run of 2 on rows 0-1) on an L and drags right
    // by two. Row 2 is never picked up, even though the first step of the
    // drag squares the room off and makes its right side a straight run of 3.
    //
    // Dragged one cell at a time on purpose. A single jump to the far cell
    // passes even if the run is re-read from the speculative model between
    // moves, because there is no "between" step: re-reading it is exactly the
    // mistake this rule exists to forbid.
    it('never picks up extra length as the shape changes mid-drag', () => {
      const id = room(['0,0', '1,0', '0,1', '1,1', '0,2', '1,2', '2,2'])
      const run = runOn(id, 'E')
      expect(run.cells).toEqual(['1,0', '1,1'])

      const resize = beginRunResize(firstMap().mapId, id, run, onChange)!
      resize.moveTo(centre(2, 0)) // squares the room off into a 3x3
      resize.moveTo(centre(3, 0))
      resize.commit()

      expect(cellsOf(id)).toEqual([
        '0,0',
        '0,1',
        '0,2',
        '1,0',
        '1,1',
        '1,2',
        '2,0',
        '2,1',
        '2,2',
        '3,0',
        '3,1',
      ])
      expect(owner('3,2')).toBeUndefined()
    })

    // Expanding into another room's cells is destructive: the resizing room
    // wins and absorbs those cells, the same as a paint-merge.
    it('absorbs the cells it lands on', () => {
      const mine = room(['0,0', '0,1'])
      const theirs = room(['1,0', '1,1', '2,0', '2,1'])

      const resize = grab(mine, 'E')
      resize.moveTo(centre(1, 0))
      resize.commit()

      expect(owner('1,0')).toBe(mine)
      expect(owner('1,1')).toBe(mine)
      // Cells, not the whole room: what it did not reach is still theirs.
      expect(owner('2,0')).toBe(theirs)
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })
  })

  describe('the ghost', () => {
    // The absorb overlay carries over from paint, which was built general
    // enough to serve both. What differs is the set: paint highlights every
    // cell of every room it will swallow (whole-room by design), while an
    // expansion vacates only the cells it lands on, so highlighting the whole
    // donor would warn about a destruction that will not happen.
    it('highlights the cells an expansion is about to take, and only those', () => {
      const mine = room(['0,0', '0,1'])
      room(['1,0', '1,1', '2,0', '2,1'])

      const resize = grab(mine, 'E')
      resize.moveTo(centre(1, 0))

      expect([...resize.absorbing].sort()).toEqual(['1,0', '1,1'])
      resize.cancel()
    })

    it('says nothing about empty grid an expansion merely fills', () => {
      const id = room(['0,0', '0,1'])
      const resize = grab(id, 'E')

      resize.moveTo(centre(3, 0))
      expect(resize.absorbing.size).toBe(0)
      resize.cancel()
    })

    // A shrink's destruction is already on screen: the cells vanish from the
    // canvas while the button is still down.
    it('adds nothing for a shrink', () => {
      const id = room(['0,0', '1,0', '2,0', '0,1', '1,1', '2,1'])
      const resize = grab(id, 'E')

      resize.moveTo(centre(0, 0))
      expect(resize.absorbing.size).toBe(0)
      resize.cancel()
    })

    it('follows the pointer back: a shrunk drag no longer warns', () => {
      const mine = room(['0,0', '0,1'])
      room(['1,0', '1,1'])

      const resize = grab(mine, 'E')
      resize.moveTo(centre(1, 0))
      expect(resize.absorbing.size).toBe(2)

      resize.moveTo(centre(0, 0))
      expect(resize.absorbing.size).toBe(0)
      resize.cancel()
    })

    it('clears when the gesture settles', () => {
      const mine = room(['0,0', '0,1'])
      room(['1,0', '1,1'])

      const resize = grab(mine, 'E')
      resize.moveTo(centre(1, 0))
      resize.commit()

      expect(resize.absorbing.size).toBe(0)
    })
  })

  describe('shrinking', () => {
    it('retracts the run by whole cells', () => {
      const id = room(['0,0', '1,0', '2,0', '0,1', '1,1', '2,1'])
      const resize = grab(id, 'E')

      resize.moveTo(centre(1, 0))
      resize.commit()

      expect(cellsOf(id)).toEqual(['0,0', '0,1', '1,0', '1,1'])
    })

    // A shrink floors at one cell: resize cannot delete a room outright (use
    // erase for that). Core enforces the floor; the gesture just has to let a
    // wild drag reach it and stay there rather than clamping on its own, which
    // is why `distance` is still -40 below.
    //
    // An L, so the run's cells have different depths: on a rectangle the floor
    // stops the first step and the room never moves at all, which would prove
    // much less.
    it('floors at one cell however far the drag goes', () => {
      const id = room(['0,0', '1,0', '2,0', '3,0', '0,1', '0,2'])
      const resize = grab(id, 'N')

      resize.moveTo(centre(0, 40))
      expect(resize.distance).toBe(-40)
      resize.commit()

      expect(firstMap().map.rooms.size).toBe(1)
      expect(cellsOf(id)).toEqual(['0,2'])
    })

    // Removed cells follow erase semantics: a shrink that disconnects the
    // room triggers the split rule.
    it('splits a room a shrink disconnects', () => {
      const model = useModelStore()
      // Two posts on a bar. Retracting the bar by one leaves the posts with
      // nothing joining them.
      const id = room(['0,0', '2,0', '0,1', '1,1', '2,1'])
      expect(runOn(id, 'S').cells).toEqual(['0,1', '1,1', '2,1'])

      const resize = grab(id, 'S')
      resize.moveTo(centre(0, 0))
      expect(resize.distance).toBe(-1)
      resize.commit()

      expect(firstMap().map.rooms.size).toBe(2)
      expect([...firstMap().map.cellOwner.keys()].sort()).toEqual(['0,0', '2,0'])
      expect(checkInvariants(model.project)).toEqual([])
    })
  })

  describe('out and back', () => {
    // The reason the run is captured at press and never re-derived: dragging
    // out N then back in N restores the exact original geometry, with no
    // gouging of pre-existing cells, icons, or walls.
    it('restores byte-identical geometry, over a neighbour and back', () => {
      const model = useModelStore()
      const mine = room(['0,0', '0,1'])
      room(['1,0', '1,1', '2,0', '2,1'])
      const before = JSON.stringify(toJSON(model.project))

      const resize = grab(mine, 'E')
      for (let x = 1; x <= 6; x++) resize.moveTo(centre(x, 0))
      for (let x = 6; x >= 0; x--) resize.moveTo(centre(x, 0))

      expect(resize.distance).toBe(0)
      resize.commit()
      expect(JSON.stringify(toJSON(model.project))).toBe(before)
    })

    // Falls out rather than being arranged: `resizeRun` returns immediately at
    // distance 0, so the transaction is empty and the seam drops it.
    it('leaves no undo step', () => {
      const model = useModelStore()
      const id = room(['0,0', '1,0', '0,1', '1,1'])
      expect(model.status.undoLabel).toBe('Setup')

      const resize = grab(id, 'E')
      resize.moveTo(centre(4, 0))
      resize.moveTo(centre(1, 0))
      resize.commit()

      expect(model.status.undoLabel).toBe('Setup')
    })

    // The same property under a real drag's sample count, which is where an
    // implementation that accumulated instead of replacing would drift.
    it('survives five hundred moves', () => {
      const model = useModelStore()
      const id = room(['0,0', '1,0', '2,0', '0,1', '1,1', '2,1'])
      const before = JSON.stringify(toJSON(model.project))

      const resize = grab(id, 'S')
      for (let i = 0; i < 500; i++) resize.moveTo(centre(0, (i % 11) - 4))
      resize.moveTo(centre(0, 1))

      resize.commit()
      expect(JSON.stringify(toJSON(model.project))).toBe(before)
      expect(checkInvariants(model.project)).toEqual([])
    })
  })

  describe('settling', () => {
    it('publishes nothing until release', () => {
      const model = useModelStore()
      const id = room(['0,0', '1,0', '0,1', '1,1'])

      const resize = grab(id, 'E')
      resize.moveTo(centre(2, 0))
      expect(owner('2,0')).toBe(id) // the canvas already shows it
      expect(model.status.undoLabel).toBe('Setup')

      resize.commit()
      expect(model.status.undoLabel).toBe('Resize Room')
    })

    it('commits the whole drag as one undo step', () => {
      const model = useModelStore()
      const id = room(['0,0', '1,0', '0,1', '1,1'])

      const resize = grab(id, 'E')
      for (let x = 2; x <= 8; x++) resize.moveTo(centre(x, 0))
      resize.commit()
      expect(cellsOf(id)).toHaveLength(18)

      model.undo()
      expect(cellsOf(id)).toEqual(['0,0', '0,1', '1,0', '1,1'])
    })

    it('rolls back to the byte-identical project it started from', () => {
      const model = useModelStore()
      const mine = room(['0,0', '0,1'])
      room(['3,0', '3,1'])
      const before = JSON.stringify(toJSON(model.project))

      const resize = grab(mine, 'E')
      resize.moveTo(centre(6, 0))
      expect(firstMap().map.rooms.size).toBe(1) // ate the neighbour whole

      resize.cancel()
      expect(JSON.stringify(toJSON(model.project))).toBe(before)
      expect(checkInvariants(model.project)).toEqual([])
    })

    it('is a no-op to commit after cancelling', () => {
      const model = useModelStore()
      const id = room(['0,0', '1,0', '0,1', '1,1'])

      const resize = grab(id, 'E')
      resize.moveTo(centre(4, 0))
      resize.cancel()
      resize.commit()

      expect(cellsOf(id)).toEqual(['0,0', '0,1', '1,0', '1,1'])
      expect(model.status.undoLabel).toBe('Setup')
    })
  })

  describe('Esc', () => {
    it('aborts the drag and commits nothing', () => {
      const model = useModelStore()
      const id = room(['0,0', '1,0', '0,1', '1,1'])
      const resize = grab(id, 'E')
      resize.moveTo(centre(4, 0))

      expect(resolveEscape()).toBe(true)
      expect(cellsOf(id)).toEqual(['0,0', '0,1', '1,0', '1,1'])
      expect(model.status.undoLabel).toBe('Setup')
      expect(onChange).toHaveBeenCalled()
    })

    // Proved against a sentinel underneath rather than against an empty stack:
    // the tiers are module-global, so "nothing is registered" would be an
    // assertion about every other test in the file. Which is also why every
    // test here settles its gesture.
    it('unregisters itself once the gesture has settled', () => {
      const sentinel = vi.fn<() => void>()
      const pop = pushEscHandler('gesture', sentinel)

      const id = room(['0,0', '1,0', '0,1', '1,1'])
      grab(id, 'E').commit()

      expect(resolveEscape()).toBe(true)
      expect(sentinel).toHaveBeenCalledTimes(1)
      pop()
    })

    // The sentinel goes in underneath after the gesture has started, on its
    // own tier: registering it first would prove nothing, because a gesture
    // wrongly registered in the selection tier would then still be the later
    // push and still win on ordering alone.
    it('aborts ahead of anything in a lower tier', () => {
      const deselect = vi.fn<() => void>()
      const id = room(['0,0', '1,0', '0,1', '1,1'])
      const resize = grab(id, 'E')
      const pop = pushEscHandler('selection', deselect)

      resolveEscape()

      expect(deselect).not.toHaveBeenCalled()
      pop()
      resize.commit()
    })

    it('leaves the eventual release harmless', () => {
      const model = useModelStore()
      const id = room(['0,0', '1,0', '0,1', '1,1'])
      const resize = grab(id, 'E')
      resize.moveTo(centre(4, 0))
      resolveEscape()

      // The user is still holding the button down; the pointerup still comes.
      resize.moveTo(centre(6, 0))
      resize.commit()

      expect(cellsOf(id)).toEqual(['0,0', '0,1', '1,0', '1,1'])
      expect(model.status.undoLabel).toBe('Setup')
    })
  })

  it('declines to start on a map that is not there', () => {
    const id = room(['0,0', '1,0', '0,1', '1,1'])
    const run = runOn(id, 'E')
    expect(beginRunResize('map_gone' as MapId, id, run, onChange)).toBeNull()
  })
})

// On touch, the first press only selects the room; only a subsequent press
// on a now-visible handle resizes. Desktop keeps a one-gesture hover-resize
// in addition.
describe('handleGrabAllowed', () => {
  it('lets a mouse resize a room it has not armed', () => {
    expect(handleGrabAllowed('mouse', false)).toBe(true)
  })

  it('makes touch a two-step', () => {
    expect(handleGrabAllowed('touch', false)).toBe(false)
    expect(handleGrabAllowed('touch', true)).toBe(true)
  })

  // A pen aims like a mouse: pixel-accurate, and hovering on hardware that
  // reports it, so it gets the one-gesture path rather than the finger's.
  it('treats a pen as desktop', () => {
    expect(handleGrabAllowed('pen', false)).toBe(true)
  })
})
