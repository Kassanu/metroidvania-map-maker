// Dragging a selected cell carries the whole cell selection as a fragment,
// which is not a room move: the grabbed cells become new rooms, one per
// orthogonally connected group, and the leftover keeps the original room's
// identity, name and properties. The drop is destructive at the destination.
// These drive the gesture directly, with no component and no DOM.

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { beginCellFragmentMove } from './cellFragmentMove'
import { mapScope, PROJECT_SCOPE, useModelStore } from '@/stores/model'
import { useSelectionStore } from '@/stores/selection'
import { resolveEscape } from '@/hotkeys/escStack'
import { createFromBox } from '@/core/ops/doors'
import { placeIcon } from '@/core/ops/markup'
import { createNewArea } from '@/core/ops/project'
import { paintCells, renameRoom, setRoomNotes } from '@/core/ops/rooms'
import { WORLD_AREA_ID } from '@/core/ids'
import { checkInvariants, ok, rect, snapshot, sorted, TEST_ICON_COLORS } from '@/core/testUtils'
import type { CellKey } from '@/core/cell'
import type { AreaId, IconId, MapId, RoomId } from '@/core/ids'
import type { MapModel, ObjectRef } from '@/core/types'

beforeEach(() => {
  setActivePinia(createTestPinia())
})

// Every fixture works on the project's one map.
function theMapId(): MapId {
  return useModelStore().project.maps[0]
}

function theMap(): MapModel {
  const model = useModelStore()
  return model.project.mapsById.get(theMapId())!
}

function paint(cells: CellKey[], areaId: AreaId = WORLD_AREA_ID): RoomId {
  const model = useModelStore()
  return model.run(
    'Fixture',
    mapScope(theMapId()),
    (transaction) => paintCells(transaction, model.project, theMap(), cells, { areaId }).id,
  )
}

function newArea(name: string): AreaId {
  const model = useModelStore()
  return model.run(
    'Fixture',
    PROJECT_SCOPE,
    (transaction) => createNewArea(transaction, model.project, name, '#204060', '#8090a0').id,
  )
}

function selectCells(cells: CellKey[]): void {
  useSelectionStore().set(
    cells.map((id): ObjectRef => ({ kind: 'cell', id })),
    theMapId(),
  )
}

function ownerOf(cell: CellKey): RoomId | undefined {
  return theMap().cellOwner.get(cell)
}

function cellsOfRoom(roomId: RoomId): CellKey[] {
  return sorted(theMap().rooms.get(roomId)!.cells)
}

// Starts the drag, failing loudly on the null a caller with nothing to move
// gets back. Tests that are about that null call the gesture directly.
function grab(from: CellKey) {
  const move = beginCellFragmentMove(theMapId(), from, () => {})
  if (!move) throw new Error(`expected a fragment move from ${from}`)
  return move
}

describe('the identity of a moved cell fragment', () => {
  it('makes the grabbed cells a new room and leaves the rest the original', () => {
    const model = useModelStore()
    const hall = paint(rect(0, 0, 3, 3))
    model.run('Fixture', mapScope(theMapId()), (transaction) => {
      renameRoom(transaction, theMap(), hall, 'Hall')
    })
    selectCells(['2,0', '2,1', '2,2'])

    const move = grab('2,0')
    move.moveTo('6,0')
    move.commit()

    expect(theMap().rooms.size).toBe(2)
    expect(cellsOfRoom(hall)).toEqual(['0,0', '0,1', '0,2', '1,0', '1,1', '1,2'])
    expect(theMap().rooms.get(hall)!.name).toBe('Hall')

    const landed = ownerOf('6,0')!
    expect(landed).not.toBe(hall)
    expect(cellsOfRoom(landed)).toEqual(['6,0', '6,1', '6,2'])
    expect(theMap().rooms.get(landed)!.name).not.toBe('Hall')
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('lands one new room per connected group of grabbed cells', () => {
    const model = useModelStore()
    const hall = paint(rect(0, 0, 3, 3))
    selectCells(['0,0', '2,0'])

    const move = grab('0,0')
    move.moveTo('0,5')
    move.commit()

    expect(theMap().rooms.size).toBe(3)
    expect(cellsOfRoom(hall)).toHaveLength(7)
    expect(cellsOfRoom(ownerOf('0,5')!)).toEqual(['0,5'])
    expect(cellsOfRoom(ownerOf('2,5')!)).toEqual(['2,5'])
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('treats a diagonal touch as no touch, so the pieces stay separate rooms', () => {
    const model = useModelStore()
    paint(rect(0, 0, 3, 3))
    // Adjacency is orthogonal only: (0,0) and (1,1) share a corner and nothing
    // else.
    selectCells(['0,0', '1,1'])

    const move = grab('0,0')
    move.moveTo('0,5')
    move.commit()

    expect(ownerOf('0,5')).not.toBe(ownerOf('1,6'))
    expect(theMap().rooms.size).toBe(3)
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('keeps the identity on the leftmost of the topmost leftover cells', () => {
    const model = useModelStore()
    const row = paint(['0,0', '1,0', '2,0'])
    model.run('Fixture', mapScope(theMapId()), (transaction) => {
      renameRoom(transaction, theMap(), row, 'Row')
    })
    // Lifting the middle cell splits what is left in two.
    selectCells(['1,0'])

    const move = grab('1,0')
    move.moveTo('1,5')
    move.commit()

    expect(theMap().rooms.size).toBe(3)
    expect(cellsOfRoom(row)).toEqual(['0,0'])
    expect(theMap().rooms.get(row)!.name).toBe('Row')
    expect(ownerOf('2,0')).not.toBe(row)
    expect(ownerOf('1,5')).not.toBe(row)
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('resolves a split leftover by topmost before leftmost', () => {
    const model = useModelStore()
    //   . # #
    //   . #        the lifted cell
    //   # #
    const bend = paint(['1,0', '2,0', '1,1', '0,2', '1,2'])
    model.run('Fixture', mapScope(theMapId()), (transaction) => {
      renameRoom(transaction, theMap(), bend, 'Bend')
    })
    selectCells(['1,1'])

    const move = grab('1,1')
    move.moveTo('4,1')
    move.commit()

    // (0,2) is further left than (1,0), and (1,0) still wins: y is compared
    // first.
    expect(cellsOfRoom(bend)).toEqual(['1,0', '2,0'])
    expect(theMap().rooms.get(bend)!.name).toBe('Bend')
    expect(cellsOfRoom(ownerOf('0,2')!)).toEqual(['0,2', '1,2'])
    expect(ownerOf('0,2')).not.toBe(bend)
    expect(theMap().rooms.size).toBe(3)
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('lands a fragment covering a whole room as a new room without its name', () => {
    const model = useModelStore()
    const vault = paint(['6,0', '7,0'])
    model.run('Fixture', mapScope(theMapId()), (transaction) => {
      renameRoom(transaction, theMap(), vault, 'Vault')
      setRoomNotes(transaction, theMap(), vault, 'gold')
    })
    selectCells(['6,0', '7,0'])

    const move = grab('6,0')
    move.moveTo('6,5')
    move.commit()

    // The granularity toggle is the choice: at cell granularity the room's
    // identity does not travel, however much of it was grabbed.
    expect(theMap().rooms.has(vault)).toBe(false)
    expect(theMap().rooms.size).toBe(1)
    const landed = theMap().rooms.get(ownerOf('6,5')!)!
    expect(sorted(landed.cells)).toEqual(['6,5', '7,5'])
    expect(landed.name).not.toBe('Vault')
    expect(landed.notes).toBe('')
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('drops a transition anchored to a grabbed cell', () => {
    const model = useModelStore()
    paint(['0,0', '1,0'])
    paint(['2,0', '3,0'])
    model.run('Fixture', mapScope(theMapId()), (transaction) => {
      ok(createFromBox(transaction, model.project, theMap(), '1,0', '2,0'))
    })
    expect(theMap().transitions.size).toBe(1)

    selectCells(['1,0'])
    const move = grab('1,0')
    move.moveTo('1,5')
    move.commit()

    expect(theMap().transitions.size).toBe(0)
    expect(checkInvariants(model.project)).toEqual([])
  })
})

describe('the area a moved fragment lands in', () => {
  it('takes the topmost-leftmost cell area for a group spanning two rooms', () => {
    const model = useModelStore()
    const cave = newArea('Cave')
    paint(['0,0', '1,0'], cave)
    paint(['2,0', '3,0'])
    // One contiguous group, half from each room. (1,0) is its topmost-leftmost
    // cell, so the whole group arrives in the Cave.
    selectCells(['1,0', '2,0'])

    const move = grab('1,0')
    move.moveTo('1,5')
    move.commit()

    const landed = ownerOf('1,5')!
    expect(ownerOf('2,5')).toBe(landed)
    expect(theMap().rooms.get(landed)!.areaId).toBe(cave)
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('keeps each disconnected group in its own source area', () => {
    const model = useModelStore()
    const cave = newArea('Cave')
    paint(['0,0'], cave)
    paint(['3,0'])
    selectCells(['0,0', '3,0'])

    const move = grab('0,0')
    move.moveTo('0,5')
    move.commit()

    expect(theMap().rooms.size).toBe(2)
    expect(theMap().rooms.get(ownerOf('0,5')!)!.areaId).toBe(cave)
    expect(theMap().rooms.get(ownerOf('3,5')!)!.areaId).toBe(WORLD_AREA_ID)
    expect(checkInvariants(model.project)).toEqual([])
  })
})

describe('what a moved fragment does to the destination', () => {
  it('overwrites a room it lands on completely', () => {
    const model = useModelStore()
    paint(['0,0', '1,0'])
    const vault = paint(['4,0', '5,0'])
    selectCells(['0,0', '1,0'])

    const move = grab('0,0')
    move.moveTo('4,0')
    move.commit()

    expect(theMap().rooms.has(vault)).toBe(false)
    expect(theMap().rooms.size).toBe(1)
    expect(cellsOfRoom(ownerOf('4,0')!)).toEqual(['4,0', '5,0'])
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('takes only the covered cells from a room that survives the drop', () => {
    const model = useModelStore()
    paint(['0,0', '1,0'])
    const hall = paint(['4,0', '5,0', '6,0'])
    model.run('Fixture', mapScope(theMapId()), (transaction) => {
      renameRoom(transaction, theMap(), hall, 'Hall')
    })
    selectCells(['0,0', '1,0'])

    const move = grab('0,0')
    move.moveTo('4,0')
    move.commit()

    expect(cellsOfRoom(hall)).toEqual(['6,0'])
    expect(theMap().rooms.get(hall)!.name).toBe('Hall')
    expect(ownerOf('4,0')).not.toBe(hall)
    expect(theMap().rooms.size).toBe(2)
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('carries icons, and the incoming one wins the cell it lands on', () => {
    const model = useModelStore()
    paint(['0,0', '1,0'])
    paint(['4,0', '5,0'])
    let carried!: IconId
    let staying!: IconId
    let sitting!: IconId
    model.run('Fixture', mapScope(theMapId()), (transaction) => {
      carried = ok(placeIcon(transaction, theMap(), '0,0', 'save', TEST_ICON_COLORS)).id
      staying = ok(placeIcon(transaction, theMap(), '1,0', 'missile', TEST_ICON_COLORS)).id
      sitting = ok(placeIcon(transaction, theMap(), '4,0', 'boss', TEST_ICON_COLORS)).id
    })
    selectCells(['0,0'])

    const move = grab('0,0')
    move.moveTo('4,0')
    move.commit()

    // One icon per cell survives because the arriving icon replaces the one
    // already there.
    expect(theMap().icons.size).toBe(2)
    expect(theMap().icons.get(carried)!.cell).toBe('4,0')
    expect(theMap().iconAtCell.get('4,0')).toBe(carried)
    expect(theMap().icons.has(sitting)).toBe(false)
    expect(theMap().icons.get(staying)!.cell).toBe('1,0')
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('ignores selected cells that no room owns', () => {
    const model = useModelStore()
    const room = paint(['0,0', '1,0'])
    // (5,5) is bare grid. A fragment never materialises a room out of it.
    selectCells(['0,0', '5,5'])

    const move = grab('0,0')
    move.moveTo('0,3')
    move.commit()

    expect(theMap().cellOwner.has('5,8')).toBe(false)
    expect(theMap().rooms.size).toBe(2)
    expect(cellsOfRoom(room)).toEqual(['1,0'])
    expect(cellsOfRoom(ownerOf('0,3')!)).toEqual(['0,3'])
    expect(checkInvariants(model.project)).toEqual([])
  })
})

describe('the cell fragment move gesture', () => {
  it('returns null when there is nothing to move', () => {
    const room = paint(['0,0', '1,0'])
    const selection = useSelectionStore()

    expect(beginCellFragmentMove(theMapId(), '0,0', () => {})).toBeNull()

    selection.set([{ kind: 'room', id: room }], theMapId())
    expect(beginCellFragmentMove(theMapId(), '0,0', () => {})).toBeNull()

    selectCells(['5,5'])
    expect(beginCellFragmentMove(theMapId(), '5,5', () => {})).toBeNull()

    selectCells(['0,0'])
    expect(beginCellFragmentMove('no-such-map' as MapId, '0,0', () => {})).toBeNull()
  })

  it('replaces the destination on every move rather than accumulating', () => {
    const model = useModelStore()
    paint(['0,0', '1,0'])
    selectCells(['0,0'])

    const move = grab('0,0')
    move.moveTo('0,3')
    move.moveTo('3,3')
    expect(move.to).toBe('3,3')
    move.commit()

    expect(theMap().cellOwner.has('0,3')).toBe(false)
    expect(cellsOfRoom(ownerOf('3,3')!)).toEqual(['3,3'])
    expect(theMap().rooms.size).toBe(2)
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('leaves no undo step for a zero delta', () => {
    const model = useModelStore()
    const room = paint(['0,0', '1,0'])
    const before = model.status.undoLabel
    selectCells(['0,0'])

    const idle = grab('0,0')
    expect(idle.to).toBe('0,0')
    idle.commit()
    expect(model.status.undoLabel).toBe(before)

    const roundTrip = grab('0,0')
    roundTrip.moveTo('0,3')
    roundTrip.moveTo('0,0')
    roundTrip.commit()

    // Out and back restores rather than reconstructs, so the transaction is
    // empty and the seam drops it.
    expect(theMap().rooms.size).toBe(1)
    expect(cellsOfRoom(room)).toEqual(['0,0', '1,0'])
    expect(model.status.undoLabel).toBe(before)
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('applies speculatively and rolls back on cancel', () => {
    const model = useModelStore()
    const hall = paint(rect(0, 0, 3, 3))
    selectCells(['2,0', '2,1', '2,2'])

    const move = grab('2,0')
    move.moveTo('6,0')
    expect(theMap().rooms.size).toBe(2)
    expect(cellsOfRoom(hall)).toHaveLength(6)
    expect(ownerOf('6,0')).toBeDefined()

    move.cancel()
    expect(theMap().rooms.size).toBe(1)
    expect(cellsOfRoom(hall)).toHaveLength(9)
    expect(theMap().cellOwner.has('6,0')).toBe(false)
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('aborts on Escape, and the commit that follows does nothing', () => {
    const model = useModelStore()
    const hall = paint(rect(0, 0, 3, 3))
    const before = model.status.undoLabel
    selectCells(['2,0'])

    const move = grab('2,0')
    move.moveTo('6,0')
    expect(resolveEscape()).toBe(true)
    expect(cellsOfRoom(hall)).toHaveLength(9)

    // The pointerup that was always coming still arrives after the abort.
    move.commit()
    expect(cellsOfRoom(hall)).toHaveLength(9)
    expect(theMap().rooms.size).toBe(1)
    expect(model.status.undoLabel).toBe(before)
  })

  it('is one undo step however many rooms it creates and destroys', () => {
    const model = useModelStore()
    paint(rect(0, 0, 3, 3))
    paint(['4,0', '5,0'])
    const before = snapshot(model.project)
    selectCells(['2,0', '2,1', '2,2'])

    const move = grab('2,0')
    move.moveTo('4,0')
    move.commit()

    // One split, one partial absorb, one room created.
    expect(theMap().rooms.size).toBe(3)
    expect(model.status.undoLabel).toBe('Move Cells')

    model.undo()
    expect(snapshot(model.project)).toEqual(before)
    expect(checkInvariants(model.project)).toEqual([])
  })
})

describe('the fragment move overlays', () => {
  it('absorbs only destination cells the fragment is not itself vacating', () => {
    paint(['0,0', '1,0', '2,0'])
    paint(['3,0', '4,0'])
    selectCells(['0,0', '1,0', '2,0'])

    const move = grab('0,0')
    move.moveTo('1,0')

    // The fragment lands on (1,0), (2,0) and (3,0). The first two it is leaving
    // itself; only (3,0) is taken from a room that stays put.
    expect(sorted(move.absorbing)).toEqual(['3,0'])
    move.cancel()
  })

  it('names the cells about to become new rooms, and clears both on settling', () => {
    paint(rect(0, 0, 3, 3))
    selectCells(['2,0', '2,1', '2,2'])

    const move = grab('2,0')
    move.moveTo('7,0')
    expect(sorted(move.becoming)).toEqual(['7,0', '7,1', '7,2'])

    move.commit()
    expect(move.becoming.size).toBe(0)
    expect(move.absorbing.size).toBe(0)
  })
})

describe('the selection after a fragment move', () => {
  it('holds the cells that landed after a commit, and is untouched by a cancel', () => {
    const selection = useSelectionStore()
    paint(['0,0', '1,0', '2,0'])
    selectCells(['0,0', '1,0'])

    const move = grab('0,0')
    move.moveTo('4,0')
    move.commit()

    // A cell reference names a position, so the move invalidates the references
    // it moves.
    expect(sorted(selection.cellsOn(theMapId()))).toEqual(['4,0', '5,0'])

    selectCells(['4,0', '5,0'])
    const aborted = grab('4,0')
    aborted.moveTo('7,0')
    aborted.cancel()
    expect(sorted(selection.cellsOn(theMapId()))).toEqual(['4,0', '5,0'])
  })
})
