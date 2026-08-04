import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { beginCellFragmentMove } from './cellFragmentMove'
import { mapScope, useModelStore } from '@/stores/model'
import { useSelectionStore } from '@/stores/selection'
import { resolveEscape } from '@/hotkeys/escStack'
import { paintCells } from '@/core/ops/rooms'
import { createFromBox } from '@/core/ops/doors'
import { placeIcon } from '@/core/ops/markup'
import { checkInvariants, ok, sorted, TEST_ICON_COLORS } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { MapId, RoomId } from '@/core/ids'
import type { CellKey } from '@/core/cell'

// One map laid out so a fragment can be taken from the middle of a room, across
// a room boundary, and onto ground that is either bare or occupied:
//
//   row 0  room A (0,0)(1,0)(2,0) | room B (3,0)(4,0), a door on the seam at x=3
//   row 2  room C (0,2)(1,2), an icon standing on (0,2)
//   row 6  room D (0,6), alone on otherwise bare ground
function fixture() {
  const model = useModelStore()
  const mapId = model.project.maps[0]
  return model.run('Setup', mapScope(mapId), (tx) => {
    const map = model.project.mapsById.get(mapId)!
    const paint = (cells: CellKey[]) =>
      paintCells(tx, model.project, map, cells, { areaId: WORLD_AREA_ID })

    const roomA = paint(['0,0', '1,0', '2,0'])
    const roomB = paint(['3,0', '4,0'])
    const [door] = ok(createFromBox(tx, model.project, map, '2,0', '3,0'))
    const roomC = paint(['0,2', '1,2'])
    const carried = ok(placeIcon(tx, map, '0,2', 'save', TEST_ICON_COLORS))
    const roomD = paint(['0,6'])

    return {
      mapId,
      roomA: roomA.id,
      roomB: roomB.id,
      roomC: roomC.id,
      roomD: roomD.id,
      door: door.id,
      carried: carried.id,
    }
  })
}

function mapOf(mapId: MapId) {
  return useModelStore().project.mapsById.get(mapId)!
}

function cellsOf(mapId: MapId, roomId: RoomId) {
  return sorted(mapOf(mapId).rooms.get(roomId)!.cells)
}

describe('the cell-fragment move', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  const selection = () => useSelectionStore()

  function select(mapId: MapId, cells: CellKey[]) {
    selection().set(
      cells.map((id) => ({ kind: 'cell', id }) as const),
      mapId,
    )
  }

  // A whole drag, the way the component runs one: press on a cell, move, let go.
  function drag(mapId: MapId, from: CellKey, to: CellKey) {
    const move = beginCellFragmentMove(mapId, from, () => {})
    expect(move).not.toBeNull()
    move!.moveTo(to)
    move!.commit()
  }

  describe('what it does to the map', () => {
    // The identity rule: the grabbed cells become new rooms, the leftover keeps
    // the original room. This is the whole difference from a room move, and it
    // is why the sub-mode toggle exists.
    it('takes the grabbed cells out as a new room and leaves the original', () => {
      const { mapId, roomA } = fixture()
      select(mapId, ['0,0'])

      drag(mapId, '0,0', '0,4')

      expect(cellsOf(mapId, roomA)).toEqual(['1,0', '2,0'])
      const landedId = mapOf(mapId).cellOwner.get('0,4')
      expect(landedId).toBeDefined()
      expect(landedId).not.toBe(roomA)
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    // Cell-select is the fragment tool by design, so a selection that happens
    // to cover a whole room still lands as a new one: identity, name and
    // transitions all go, where a room move would keep them.
    it('makes a new room even when the fragment is a whole room', () => {
      const { mapId, roomD } = fixture()
      select(mapId, ['0,6'])

      drag(mapId, '0,6', '2,6')

      expect(mapOf(mapId).rooms.has(roomD)).toBe(false)
      expect(mapOf(mapId).cellOwner.get('2,6')).toBeDefined()
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    it('lands one new room per connected group of the fragment', () => {
      const { mapId } = fixture()
      // Two cells of one room with a third between them left behind, so the
      // fragment arrives in two pieces.
      select(mapId, ['0,0', '2,0'])

      drag(mapId, '0,0', '0,4')

      const owners = new Set([mapOf(mapId).cellOwner.get('0,4'), mapOf(mapId).cellOwner.get('2,4')])
      expect(owners.size).toBe(2)
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    it('carries an icon standing on a grabbed cell', () => {
      const { mapId, carried } = fixture()
      select(mapId, ['0,2'])

      drag(mapId, '0,2', '0,4')

      expect(mapOf(mapId).icons.get(carried)!.cell).toBe('0,4')
    })

    // Fully destructive at the destination, the ghosting model's rule for every
    // move.
    it('overwrites what it lands on', () => {
      const { mapId, roomD } = fixture()
      select(mapId, ['0,0'])

      drag(mapId, '0,0', '0,6')

      expect(mapOf(mapId).rooms.has(roomD)).toBe(false)
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    // The fragment's old anchors are gone, so re-validation removes a door that
    // no longer joins two rooms. A room move rides its transitions; this does
    // not.
    it('drops a transition the fragment was anchoring', () => {
      const { mapId, door } = fixture()
      select(mapId, ['2,0'])

      drag(mapId, '2,0', '2,4')

      expect(mapOf(mapId).transitions.has(door)).toBe(false)
    })

    // One gesture, one transaction, however many rooms it creates and destroys.
    it('is one undo step, and one undo puts everything back', () => {
      const { mapId, roomA, roomD } = fixture()
      const model = useModelStore()
      select(mapId, ['0,0', '2,0'])

      drag(mapId, '0,0', '0,6')

      expect(model.status.undoLabel).toBe('Move Cells')
      model.undo()
      expect(cellsOf(mapId, roomA)).toEqual(['0,0', '1,0', '2,0'])
      expect(mapOf(mapId).rooms.has(roomD)).toBe(true)
      expect(checkInvariants(model.project)).toEqual([])
    })
  })

  describe('the drag itself', () => {
    it('applies speculatively, before the release', () => {
      const { mapId, roomA } = fixture()
      select(mapId, ['0,0'])

      const move = beginCellFragmentMove(mapId, '0,0', () => {})!
      move.moveTo('0,4')

      expect(cellsOf(mapId, roomA)).toEqual(['1,0', '2,0'])
      move.cancel()
    })

    // The destination is replaced on every move, never accumulated, so the
    // second reading is measured from the origin rather than from the first.
    it('follows the pointer rather than accumulating', () => {
      const { mapId } = fixture()
      select(mapId, ['0,0'])

      const move = beginCellFragmentMove(mapId, '0,0', () => {})!
      move.moveTo('0,4')
      move.moveTo('0,3')
      move.commit()

      expect(mapOf(mapId).cellOwner.get('0,3')).toBeDefined()
      expect(mapOf(mapId).cellOwner.has('0,4')).toBe(false)
    })

    it('leaves no undo step when the drag comes back to where it started', () => {
      const { mapId, roomA } = fixture()
      const model = useModelStore()
      const before = model.status.undoLabel
      select(mapId, ['0,0'])

      const move = beginCellFragmentMove(mapId, '0,0', () => {})!
      move.moveTo('0,4')
      move.moveTo('0,0')
      move.commit()

      expect(model.status.undoLabel).toBe(before)
      expect(cellsOf(mapId, roomA)).toEqual(['0,0', '1,0', '2,0'])
    })

    it('puts everything back on Esc, and ignores the release that follows', () => {
      const { mapId, roomA } = fixture()
      const model = useModelStore()
      const before = model.status.undoLabel
      select(mapId, ['0,0'])

      const move = beginCellFragmentMove(mapId, '0,0', () => {})!
      move.moveTo('0,4')
      expect(resolveEscape()).toBe(true)

      expect(cellsOf(mapId, roomA)).toEqual(['0,0', '1,0', '2,0'])
      move.commit()
      expect(model.status.undoLabel).toBe(before)
      expect(cellsOf(mapId, roomA)).toEqual(['0,0', '1,0', '2,0'])
    })
  })

  describe('the ghost', () => {
    // The cells the drop is about to take off a room that is staying put. Read
    // against the pre-move grid, because by draw time they belong to the new
    // rooms and look no different from cells picked up off bare grid.
    it('marks what the drop is about to overwrite', () => {
      const { mapId } = fixture()
      select(mapId, ['0,0'])

      const move = beginCellFragmentMove(mapId, '0,0', () => {})!
      move.moveTo('0,6')

      expect([...move.absorbing]).toEqual(['0,6'])
      move.cancel()
    })

    // A destination cell the same fragment is vacating is not absorbed: the one
    // transaction moves out of it rather than anyone losing it.
    it('does not mark a cell the fragment is itself vacating', () => {
      const { mapId } = fixture()
      select(mapId, ['0,0', '1,0'])

      const move = beginCellFragmentMove(mapId, '0,0', () => {})!
      move.moveTo('1,0')

      expect([...move.absorbing]).toEqual(['2,0'])
      move.cancel()
    })

    // What the fragment is about to become, which the speculative model cannot
    // say: by draw time the new rooms render exactly like a room that was
    // moved whole.
    it('marks where the fragment will land', () => {
      const { mapId } = fixture()
      select(mapId, ['0,0', '1,0'])

      const move = beginCellFragmentMove(mapId, '0,0', () => {})!
      move.moveTo('0,4')

      expect(sorted(move.becoming)).toEqual(['0,4', '1,4'])
      move.cancel()
    })

    it('has nothing to mark once the gesture is over', () => {
      const { mapId } = fixture()
      select(mapId, ['0,0'])

      const move = beginCellFragmentMove(mapId, '0,0', () => {})!
      move.moveTo('0,4')
      move.commit()

      expect(move.becoming.size).toBe(0)
      expect(move.absorbing.size).toBe(0)
    })
  })

  describe('the selection afterwards', () => {
    // A cell ref names a position, so the move invalidates the refs it is
    // moving. What landed is what is selected, the rule a paste follows.
    it('holds the cells that landed, not the ones that were grabbed', () => {
      const { mapId } = fixture()
      select(mapId, ['0,0', '1,0'])

      drag(mapId, '0,0', '0,4')

      expect(sorted(selection().cellsOn(mapId))).toEqual(['0,4', '1,4'])
    })

    it('is left alone by a drag that was abandoned', () => {
      const { mapId } = fixture()
      select(mapId, ['0,0'])

      const move = beginCellFragmentMove(mapId, '0,0', () => {})!
      move.moveTo('0,4')
      move.cancel()

      expect(selection().cellsOn(mapId)).toEqual(['0,0'])
    })
  })

  describe('what starts nothing', () => {
    it('refuses an empty selection', () => {
      const { mapId } = fixture()
      expect(beginCellFragmentMove(mapId, '0,0', () => {})).toBeNull()
    })

    // A selection of another kind holds no cell, so there is no fragment to
    // take even though something is selected.
    it('refuses a selection holding no cells', () => {
      const { mapId, roomA } = fixture()
      selection().set([{ kind: 'room', id: roomA }], mapId)
      expect(beginCellFragmentMove(mapId, '0,0', () => {})).toBeNull()
    })

    // A cell that lost its owner cannot be dragged out of a room it is no
    // longer in.
    it('refuses a selection holding only cells no room owns', () => {
      const { mapId } = fixture()
      select(mapId, ['9,9'])
      expect(beginCellFragmentMove(mapId, '9,9', () => {})).toBeNull()
    })

    it('refuses a map that is gone', () => {
      fixture()
      expect(beginCellFragmentMove('map_missing' as MapId, '0,0', () => {})).toBeNull()
    })
  })
})
