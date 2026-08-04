import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { beginSelectionMove } from './selectionMove'
import type { CellMove } from './ghostGesture'
import { mapScope, useModelStore } from '@/stores/model'
import { useSelectionStore } from '@/stores/selection'
import { resolveEscape } from '@/hotkeys/escStack'
import { createFromBox } from '@/core/ops/doors'
import { createLine, placeIcon } from '@/core/ops/markup'
import { paintCells } from '@/core/ops/rooms'
import { checkInvariants, ok, sorted, TEST_ICON_COLORS } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { IconId, LineId, MapId, RoomId, TransitionId } from '@/core/ids'
import type { CellKey } from '@/core/cell'
import type { MapModel, ObjectRef } from '@/core/types'

// Select mode's Drag column, row by row: one kind of selection per case, then
// the rules that hold across every row.
//
// `selectionMove.test.ts` covers the same gesture from its API surface, which
// is where the cases about what refuses to start one live.

const LINE_DEFAULTS = { color: '#8bd5ff', arrowStart: false, arrowEnd: true }

// Every setup step commits under this label, so the top of the undo stack
// before a drag is known and "the drag added one step" and "the drag added no
// step" are both exact assertions.
const SETUP = 'Setup'

describe('the Drag column of Select mode', () => {
  let onChange: Mock<() => void>

  beforeEach(() => {
    setActivePinia(createTestPinia())
    onChange = vi.fn<() => void>()
  })

  function mapId(): MapId {
    return useModelStore().project.maps[0]
  }

  // Re-read on every use: an undo replaces the objects, so a captured map or
  // room would be asserted against after it stopped being the live one.
  function map(): MapModel {
    const model = useModelStore()
    return model.project.mapsById.get(mapId())!
  }

  function room(cells: CellKey[]): RoomId {
    const model = useModelStore()
    return model.run(
      SETUP,
      mapScope(mapId()),
      (tx) => paintCells(tx, model.project, map(), cells, { areaId: WORLD_AREA_ID }).id,
    )
  }

  function icon(cell: CellKey): IconId {
    const model = useModelStore()
    return model.run(
      SETUP,
      mapScope(mapId()),
      (tx) => ok(placeIcon(tx, map(), cell, 'save', TEST_ICON_COLORS)).id,
    )
  }

  function line(points: CellKey[]): LineId {
    const model = useModelStore()
    return model.run(
      SETUP,
      mapScope(mapId()),
      (tx) => ok(createLine(tx, map(), points, LINE_DEFAULTS)).id,
    )
  }

  // A 1x2 box across the seam between two adjacent rooms: one edge door.
  function door(from: CellKey, to: CellKey): TransitionId {
    const model = useModelStore()
    return model.run(
      SETUP,
      mapScope(mapId()),
      (tx) => ok(createFromBox(tx, model.project, map(), from, to))[0].id,
    )
  }

  function select(...refs: ObjectRef[]): void {
    useSelectionStore().set(refs, mapId())
  }

  function drag(from: CellKey): CellMove {
    const move = beginSelectionMove(mapId(), from, onChange)
    expect(move).not.toBeNull()
    return move!
  }

  function cellsOf(roomId: RoomId): CellKey[] {
    return sorted(map().rooms.get(roomId)!.cells)
  }

  function edgesOf(transitionId: TransitionId): string[] {
    const transition = map().transitions.get(transitionId)!
    return transition.kind === 'edge' ? transition.segments.map((segment) => segment.edge) : []
  }

  describe('what each kind of selection moves', () => {
    it('moves a selected room by the whole-cell delta, keeping its identity', () => {
      const a = room(['0,0', '1,0', '0,1', '1,1'])
      select({ kind: 'room', id: a })

      const move = drag('0,0')
      move.moveTo('2,1')
      move.commit()

      // Identity survives, which is what separates a room move from the cell
      // fragment move: the same room id now owns the translated footprint.
      expect(map().rooms.has(a)).toBe(true)
      expect(cellsOf(a)).toEqual(['2,1', '2,2', '3,1', '3,2'])
      expect(map().cellOwner.has('0,0')).toBe(false)
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    it('moves a selected icon by the delta', () => {
      room(['0,0', '1,0', '2,0', '0,1', '1,1', '2,1'])
      const badge = icon('1,0')
      select({ kind: 'icon', id: badge })

      const move = drag('1,0')
      move.moveTo('2,1')
      move.commit()

      expect(map().icons.get(badge)!.cell).toBe('2,1')
      expect(map().iconAtCell.has('1,0')).toBe(false)
    })

    it('moves a selected line by the delta, every point together', () => {
      const drawn = line(['0,0', '1,0', '2,0'])
      select({ kind: 'line', id: drawn })

      const move = drag('0,0')
      move.moveTo('0,2')
      move.commit()

      expect(map().lines.get(drawn)!.points).toEqual(['0,2', '1,2', '2,2'])
    })

    // A transition is anchored to the edge between two rooms and its geometry is
    // derived from them, so there is nothing for a drag to move. The press still
    // selects it; the drag itself is inert.
    it('does nothing for a transition, on the model or the undo stack', () => {
      const a = room(['0,0', '0,1'])
      const b = room(['1,0', '1,1'])
      const opening = door('0,0', '1,0')
      select({ kind: 'transition', id: opening })

      const model = useModelStore()
      const before = model.status.undoLabel
      const geometry = edgesOf(opening)

      const move = beginSelectionMove(mapId(), '0,0', onChange)
      move?.moveTo('3,3')
      move?.commit()

      expect(cellsOf(a)).toEqual(['0,0', '0,1'])
      expect(cellsOf(b)).toEqual(['1,0', '1,1'])
      expect(edgesOf(opening)).toEqual(geometry)
      expect(model.status.undoLabel).toBe(before)
    })
  })

  describe('as one transaction', () => {
    it('moves a mixed selection and takes one undo to put it all back', () => {
      const movingRoom = room(['0,0', '0,1'])
      room(['5,0', '6,0', '5,1', '6,1'])
      const badge = icon('5,0')
      const drawn = line(['0,5', '1,5'])
      select(
        { kind: 'room', id: movingRoom },
        { kind: 'icon', id: badge },
        { kind: 'line', id: drawn },
      )

      const model = useModelStore()
      const move = drag('0,0')
      move.moveTo('1,0')
      move.commit()

      expect(cellsOf(movingRoom)).toEqual(['1,0', '1,1'])
      expect(map().icons.get(badge)!.cell).toBe('6,0')
      expect(map().lines.get(drawn)!.points).toEqual(['1,5', '2,5'])

      // Three kinds, three ops, one step. A second undo would be undoing the
      // setup, so the label proves the whole batch came off together.
      model.undo()
      expect(cellsOf(movingRoom)).toEqual(['0,0', '0,1'])
      expect(map().icons.get(badge)!.cell).toBe('5,0')
      expect(map().lines.get(drawn)!.points).toEqual(['0,5', '1,5'])
      expect(model.status.undoLabel).toBe(SETUP)
      expect(checkInvariants(model.project)).toEqual([])
    })

    // One transaction, but not one name. A selection of a single kind names that
    // kind, so the entry reads the way the same object's own move would; a mix
    // has no truthful specific name and says so. `Del` labels itself by the same
    // rule, and the two must not disagree about a selection they both act on.
    it('names the step after the kind, and only says "selection" for a mix', () => {
      const a = room(['0,0', '0,1'])
      const drawn = line(['0,5', '1,5'])
      select({ kind: 'room', id: a })

      const model = useModelStore()
      const first = drag('0,0')
      first.moveTo('2,0')
      first.commit()
      expect(model.status.undoLabel).toBe('Move Room')

      select({ kind: 'room', id: a }, { kind: 'line', id: drawn })
      const second = drag('2,0')
      second.moveTo('2,1')
      second.commit()
      expect(model.status.undoLabel).toBe('Move Selection')
    })

    // Zero delta is guarded inside each op, so the transaction the gesture opens
    // stays empty and the seam drops it rather than stacking a step that does
    // nothing.
    it('leaves no undo step when the drag returns to its origin cell', () => {
      const a = room(['0,0', '0,1'])
      select({ kind: 'room', id: a })

      const model = useModelStore()
      const move = drag('0,0')
      move.moveTo('3,3')
      move.moveTo('0,0')
      move.commit()

      expect(cellsOf(a)).toEqual(['0,0', '0,1'])
      expect(model.status.undoLabel).toBe(SETUP)
      expect(checkInvariants(model.project)).toEqual([])
    })

    it('leaves no undo step for a press and release that never moved', () => {
      const a = room(['0,0', '0,1'])
      select({ kind: 'room', id: a })

      const model = useModelStore()
      drag('0,0').commit()

      expect(cellsOf(a)).toEqual(['0,0', '0,1'])
      expect(model.status.undoLabel).toBe(SETUP)
    })
  })

  describe('while the drag is live', () => {
    it('shows the pending result on the model before the release', () => {
      const a = room(['0,0', '0,1'])
      select({ kind: 'room', id: a })

      const move = drag('0,0')
      move.moveTo('2,0')

      expect(cellsOf(a)).toEqual(['2,0', '2,1'])
      expect(map().cellOwner.has('0,0')).toBe(false)
    })

    // Each re-apply runs one move against the pristine model, so the delta is
    // measured from the origin cell and the cells passed through leave no trace.
    it('replaces the destination each move rather than accumulating a path', () => {
      const a = room(['0,0', '0,1'])
      select({ kind: 'room', id: a })

      const move = drag('0,0')
      move.moveTo('1,0')
      move.moveTo('2,0')
      move.moveTo('3,0')
      move.commit()

      expect(cellsOf(a)).toEqual(['3,0', '3,1'])
      expect(map().rooms.size).toBe(1)
    })

    it('reports the cell under the pointer, starting at the press', () => {
      const a = room(['0,0', '0,1'])
      select({ kind: 'room', id: a })

      const move = drag('0,0')
      expect(move.to).toBe('0,0')

      move.moveTo('2,1')
      expect(move.to).toBe('2,1')
    })

    it('repaints on a change of destination and again when it settles', () => {
      const a = room(['0,0', '0,1'])
      select({ kind: 'room', id: a })

      const move = drag('0,0')
      move.moveTo('2,0')
      expect(onChange).toHaveBeenCalledTimes(1)

      move.commit()
      expect(onChange).toHaveBeenCalledTimes(2)
    })
  })

  describe('the footprint it takes', () => {
    // Destination cells are taken outright: the moving group wins, and the room
    // that held them keeps only what is left.
    it('takes the destination cells from the room that held them', () => {
      const a = room(['0,0', '0,1'])
      const b = room(['2,0', '2,1', '3,0', '3,1'])
      select({ kind: 'room', id: a })

      const move = drag('0,0')
      move.moveTo('2,0')
      move.commit()

      expect(cellsOf(a)).toEqual(['2,0', '2,1'])
      expect(cellsOf(b)).toEqual(['3,0', '3,1'])
      expect(map().cellOwner.get('2,0')).toBe(a)
      expect(map().rooms.size).toBe(2)
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    it('reports the cells it is about to take from a room that is not moving', () => {
      const a = room(['0,0', '0,1'])
      room(['2,0', '2,1', '3,0', '3,1'])
      select({ kind: 'room', id: a })

      const move = drag('0,0')
      move.moveTo('2,0')

      // The overlay is the only way the canvas can show this: once the move is
      // applied those cells belong to the moving room and look no different from
      // cells picked up off bare grid.
      expect(sorted(move.absorbing)).toEqual(['2,0', '2,1'])

      move.commit()
      expect(sorted(move.absorbing)).toEqual([])
    })

    it('reports nothing for a destination on bare grid', () => {
      const a = room(['0,0', '0,1'])
      select({ kind: 'room', id: a })

      const move = drag('0,0')
      move.moveTo('5,0')

      expect(sorted(move.absorbing)).toEqual([])
    })

    // Cells handed from one moving room to another are not being destroyed, so
    // they are not in the overlay: the room vacating them is in the same move.
    it('reports nothing for cells handed over inside the moving group', () => {
      const a = room(['0,0', '0,1'])
      const b = room(['1,0', '1,1'])
      select({ kind: 'room', id: a }, { kind: 'room', id: b })

      const move = drag('0,0')
      move.moveTo('1,0')

      expect(sorted(move.absorbing)).toEqual([])

      move.commit()
      expect(cellsOf(a)).toEqual(['1,0', '1,1'])
      expect(cellsOf(b)).toEqual(['2,0', '2,1'])
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })
  })

  describe('the transitions of the rooms it moves', () => {
    // A door between two rooms that both move keeps its identity and rides
    // along; a door to a room left behind cannot survive, because its two rooms
    // stop touching.
    it('carries a door between two moved rooms and drops one to a room left behind', () => {
      const a = room(['0,0', '0,1'])
      const b = room(['1,0', '1,1'])
      room(['2,0', '2,1'])
      const inside = door('0,0', '1,0')
      const outside = door('1,0', '2,0')
      select({ kind: 'room', id: a }, { kind: 'room', id: b })

      const move = drag('0,0')
      move.moveTo('0,3')
      move.commit()

      expect(map().transitions.has(inside)).toBe(true)
      expect(map().transitions.has(outside)).toBe(false)
      // The seam between the two moved rooms, translated by the same delta.
      expect(edgesOf(inside)).toEqual(['1,3,V'])
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })
  })

  describe('Esc', () => {
    it('aborts the drag, leaving the model and the stack as they were', () => {
      const a = room(['0,0', '0,1'])
      select({ kind: 'room', id: a })

      const model = useModelStore()
      const move = drag('0,0')
      move.moveTo('2,0')
      expect(cellsOf(a)).toEqual(['2,0', '2,1'])

      expect(resolveEscape()).toBe(true)
      expect(cellsOf(a)).toEqual(['0,0', '0,1'])
      expect(model.status.undoLabel).toBe(SETUP)
      expect(sorted(move.absorbing)).toEqual([])
      expect(checkInvariants(model.project)).toEqual([])
    })

    // The pointerup that was always coming still arrives after the abort, and it
    // must not re-apply the move or commit anything.
    it('makes the release that follows it harmless', () => {
      const a = room(['0,0', '0,1'])
      select({ kind: 'room', id: a })

      const model = useModelStore()
      const move = drag('0,0')
      move.moveTo('2,0')
      resolveEscape()

      move.moveTo('4,0')
      move.commit()

      expect(cellsOf(a)).toEqual(['0,0', '0,1'])
      expect(model.status.undoLabel).toBe(SETUP)
    })
  })

  it('answers null when the map is gone', () => {
    expect(beginSelectionMove('map_gone' as MapId, '0,0', onChange)).toBeNull()
  })
})
