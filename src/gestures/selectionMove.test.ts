import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { beginSelectionMove } from './selectionMove'
import { mapScope, useModelStore } from '@/stores/model'
import { useSelectionStore } from '@/stores/selection'
import { resolveEscape } from '@/hotkeys/escStack'
import { paintCells } from '@/core/ops/rooms'
import { createFromBox } from '@/core/ops/doors'
import { createLine, placeIcon } from '@/core/ops/markup'
import { checkInvariants, ok, sorted, TEST_ICON_COLORS } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { IconId, LineId, MapId, RoomId, TransitionId } from '@/core/ids'
import type { ObjectRef } from '@/core/types'

// One map holding every kind the drag column names, laid out so a one-cell
// nudge is unambiguous:
//
//   row 0  room A (0,0)(1,0) | room B (2,0)(3,0), a door on the seam at x=2
//   row 2  room C (0,2), with an icon standing on it
//   row 4  a loose icon on room D (4,4), and a line across (0,4)..(2,4)
function fixture() {
  const model = useModelStore()
  const mapId = model.project.maps[0]
  return model.run('Setup', mapScope(mapId), (tx) => {
    const map = model.project.mapsById.get(mapId)!
    const paint = (cells: string[]) =>
      paintCells(tx, model.project, map, cells, {
        areaId: WORLD_AREA_ID,
      })

    const roomA = paint(['0,0', '1,0'])
    const roomB = paint(['2,0', '3,0'])
    const [door] = ok(createFromBox(tx, model.project, map, '1,0', '2,0'))
    const roomC = paint(['0,2'])
    const carried = ok(placeIcon(tx, map, '0,2', 'save', TEST_ICON_COLORS))
    const roomD = paint(['4,4', '5,4'])
    const loose = ok(placeIcon(tx, map, '4,4', 'save', TEST_ICON_COLORS))
    const line = ok(
      createLine(tx, map, ['0,4', '1,4', '2,4'], {
        color: '#d9a441',
        arrowStart: false,
        arrowEnd: false,
      }),
    )

    return {
      mapId,
      roomA: roomA.id,
      roomB: roomB.id,
      roomC: roomC.id,
      roomD: roomD.id,
      door: door.id,
      carried: carried.id,
      loose: loose.id,
      line: line.id,
    }
  })
}

function mapOf(mapId: MapId) {
  return useModelStore().project.mapsById.get(mapId)!
}

function cellsOf(mapId: MapId, roomId: RoomId) {
  return sorted(mapOf(mapId).rooms.get(roomId)!.cells)
}

describe('the selection move', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function select(mapId: MapId, refs: ObjectRef[]) {
    useSelectionStore().set(refs, mapId)
  }

  const room = (id: RoomId): ObjectRef => ({ kind: 'room', id })
  const icon = (id: IconId): ObjectRef => ({ kind: 'icon', id })
  const line = (id: LineId): ObjectRef => ({ kind: 'line', id })
  const transition = (id: TransitionId): ObjectRef => ({ kind: 'transition', id })

  // Runs a whole drag, the way the component does: press on a cell, move, let
  // go. Returns nothing, because what is asserted is the model afterwards.
  function drag(mapId: MapId, from: string, to: string) {
    const move = beginSelectionMove(mapId, from, () => {})
    expect(move).not.toBeNull()
    move!.moveTo(to)
    move!.commit()
  }

  describe('what moves', () => {
    it('moves one room by the delta between the origin cell and the pointer', () => {
      const { mapId, roomA } = fixture()
      select(mapId, [room(roomA)])

      drag(mapId, '0,0', '0,1')

      expect(cellsOf(mapId, roomA)).toEqual(['0,1', '1,1'])
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    it('applies the pending move speculatively, before the release', () => {
      const { mapId, roomA } = fixture()
      select(mapId, [room(roomA)])

      const move = beginSelectionMove(mapId, '0,0', () => {})!
      move.moveTo('0,1')

      expect(cellsOf(mapId, roomA)).toEqual(['0,1', '1,1'])
      move.commit()
    })

    it('replaces the destination rather than accumulating a path', () => {
      const { mapId, roomA } = fixture()
      select(mapId, [room(roomA)])

      const move = beginSelectionMove(mapId, '0,0', () => {})!
      move.moveTo('0,5')
      move.moveTo('0,1')
      move.commit()

      expect(cellsOf(mapId, roomA)).toEqual(['0,1', '1,1'])
    })

    it('moves a line by the same delta', () => {
      const { mapId, line: lineId } = fixture()
      select(mapId, [line(lineId)])

      drag(mapId, '1,4', '2,5')

      expect(mapOf(mapId).lines.get(lineId)!.points).toEqual(['1,5', '2,5', '3,5'])
    })

    it('moves an icon on its own, inside the room that holds it', () => {
      const { mapId, roomD, loose } = fixture()
      select(mapId, [icon(loose)])

      drag(mapId, '4,4', '5,4')

      expect(mapOf(mapId).icons.get(loose)!.cell).toBe('5,4')
      // The room it stands on did not move with it: only what is selected does.
      expect(cellsOf(mapId, roomD)).toEqual(['4,4', '5,4'])
    })

    // The op decides what a destination has to be, not the gesture: an icon
    // belongs to a cell some room owns, so a drag onto bare grid applies
    // nothing and the icon stays where it was.
    it('leaves an icon put when the destination is outside every room', () => {
      const { mapId, loose } = fixture()
      select(mapId, [icon(loose)])

      drag(mapId, '4,4', '9,9')

      expect(mapOf(mapId).icons.get(loose)!.cell).toBe('4,4')
    })

    // The room carries the icons standing on its cells. Selecting the icon as
    // well asks for the same destination twice, and the two agree because both
    // are measured from where the icon was before anything moved.
    it('lands a carried icon on one cell when both it and its room are selected', () => {
      const { mapId, roomC, carried } = fixture()
      select(mapId, [room(roomC), icon(carried)])

      drag(mapId, '0,2', '1,2')

      expect(cellsOf(mapId, roomC)).toEqual(['1,2'])
      expect(mapOf(mapId).icons.get(carried)!.cell).toBe('1,2')
    })
  })

  describe('the batch', () => {
    it('moves a mixed selection of every movable kind as one undo step', () => {
      const model = useModelStore()
      const { mapId, roomA, line: lineId, roomD, loose } = fixture()
      select(mapId, [room(roomA), room(roomD), line(lineId), icon(loose)])

      drag(mapId, '0,0', '0,1')

      expect(cellsOf(mapId, roomA)).toEqual(['0,1', '1,1'])
      expect(cellsOf(mapId, roomD)).toEqual(['4,5', '5,5'])
      expect(mapOf(mapId).lines.get(lineId)!.points).toEqual(['0,5', '1,5', '2,5'])
      expect(mapOf(mapId).icons.get(loose)!.cell).toBe('4,5')

      // One step for the lot, so one undo puts all four back.
      model.undo()
      expect(cellsOf(mapId, roomA)).toEqual(['0,0', '1,0'])
      expect(mapOf(mapId).lines.get(lineId)!.points).toEqual(['0,4', '1,4', '2,4'])
      expect(model.status.undoLabel).toBe('Setup')
    })

    it('names the step after the kind when the selection holds one, and not when it holds more', () => {
      const model = useModelStore()
      const { mapId, roomA, line: lineId } = fixture()

      select(mapId, [room(roomA)])
      drag(mapId, '0,0', '0,1')
      expect(model.status.undoLabel).toBe('Move Room')

      select(mapId, [room(roomA), line(lineId)])
      drag(mapId, '0,1', '0,2')
      expect(model.status.undoLabel).toBe('Move Selection')
    })

    // Two rooms moving together: the second's destination is the first's
    // origin, which only works because the whole batch is one transaction
    // against the pristine grid.
    it('moves two adjacent rooms as a group, through each other’s cells', () => {
      const { mapId, roomA, roomB } = fixture()
      select(mapId, [room(roomA), room(roomB)])

      drag(mapId, '0,0', '1,0')

      expect(cellsOf(mapId, roomA)).toEqual(['1,0', '2,0'])
      expect(cellsOf(mapId, roomB)).toEqual(['3,0', '4,0'])
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    it('carries a transition between two moved rooms', () => {
      const { mapId, roomA, roomB, door } = fixture()
      select(mapId, [room(roomA), room(roomB)])

      drag(mapId, '0,0', '0,1')

      expect(mapOf(mapId).transitions.has(door)).toBe(true)
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    it('drops a transition whose rooms stop touching', () => {
      const { mapId, roomA, door } = fixture()
      select(mapId, [room(roomA)])

      drag(mapId, '0,0', '0,3')

      expect(mapOf(mapId).transitions.has(door)).toBe(false)
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })
  })

  describe('what it takes from the map', () => {
    // Fully destructive: the moving room takes the footprint outright, and the
    // room that held those cells loses them.
    it('takes the destination cells from a room staying put', () => {
      const { mapId, roomA, roomB } = fixture()
      select(mapId, [room(roomA)])

      drag(mapId, '0,0', '2,0')

      expect(cellsOf(mapId, roomA)).toEqual(['2,0', '3,0'])
      expect(mapOf(mapId).rooms.has(roomB)).toBe(false)
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    // The overlay says which cells are about to be taken, because the
    // speculative model cannot: by draw time they belong to the mover and look
    // like cells picked up off bare grid.
    it('highlights the cells it is about to take, and nothing it already owns', () => {
      const { mapId, roomA } = fixture()
      select(mapId, [room(roomA)])

      const move = beginSelectionMove(mapId, '0,0', () => {})!
      move.moveTo('1,0')

      // Room A slides one right onto (1,0) and (2,0). The first is its own
      // cell and the second is room B's, so only the second is taken.
      expect(sorted(move.absorbing)).toEqual(['2,0'])
      move.cancel()
    })

    it('highlights nothing when the group moves through its own cells', () => {
      const { mapId, roomA, roomB } = fixture()
      select(mapId, [room(roomA), room(roomB)])

      const move = beginSelectionMove(mapId, '0,0', () => {})!
      move.moveTo('1,0')

      expect(sorted(move.absorbing)).toEqual([])
      move.cancel()
    })

    it('empties the overlay once the gesture is over', () => {
      const { mapId, roomA } = fixture()
      select(mapId, [room(roomA)])

      const move = beginSelectionMove(mapId, '0,0', () => {})!
      move.moveTo('1,0')
      move.commit()

      expect([...move.absorbing]).toEqual([])
    })
  })

  describe('the ways it does nothing', () => {
    it('leaves no undo step when the drag comes back to where it started', () => {
      const model = useModelStore()
      const { mapId, roomA } = fixture()
      select(mapId, [room(roomA)])
      const before = model.status.undoLabel

      const move = beginSelectionMove(mapId, '0,0', () => {})!
      move.moveTo('3,3')
      move.moveTo('0,0')
      move.commit()

      expect(cellsOf(mapId, roomA)).toEqual(['0,0', '1,0'])
      expect(model.status.undoLabel).toBe(before)
    })

    it('puts everything back on Esc, and ignores the release that follows', () => {
      const model = useModelStore()
      const { mapId, roomA } = fixture()
      select(mapId, [room(roomA)])
      const before = model.status.undoLabel

      const move = beginSelectionMove(mapId, '0,0', () => {})!
      move.moveTo('0,1')
      expect(resolveEscape()).toBe(true)

      expect(cellsOf(mapId, roomA)).toEqual(['0,0', '1,0'])
      move.moveTo('0,3')
      move.commit()
      expect(cellsOf(mapId, roomA)).toEqual(['0,0', '1,0'])
      expect(model.status.undoLabel).toBe(before)
    })

    // A transition is anchored to the edge between two rooms and has no
    // geometry of its own, so there is nothing for a drag to move. Answered as
    // null rather than as a gesture that applies nothing, so no transaction is
    // opened at all.
    it('starts nothing for a selection holding only a transition', () => {
      const { mapId, door } = fixture()
      select(mapId, [transition(door)])

      expect(beginSelectionMove(mapId, '2,0', () => {})).toBeNull()
    })

    it('moves the rest of a selection that also holds a transition', () => {
      const { mapId, roomA, door } = fixture()
      select(mapId, [room(roomA), transition(door)])

      drag(mapId, '0,0', '0,1')

      expect(cellsOf(mapId, roomA)).toEqual(['0,1', '1,1'])
    })

    it('starts nothing for an empty selection', () => {
      const { mapId } = fixture()

      expect(beginSelectionMove(mapId, '0,0', () => {})).toBeNull()
    })

    it('starts nothing for a selection belonging to another tab', () => {
      const { mapId, roomA } = fixture()
      select('map_elsewhere' as MapId, [room(roomA)])

      expect(beginSelectionMove(mapId, '0,0', () => {})).toBeNull()
    })

    it('starts nothing when the map is gone', () => {
      const { mapId, roomA } = fixture()
      select(mapId, [room(roomA)])

      expect(beginSelectionMove('map_missing' as MapId, '0,0', () => {})).toBeNull()
    })
  })
})
