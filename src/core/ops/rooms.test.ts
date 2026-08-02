import { describe, it, expect } from 'vitest'
import { edgeOfCell } from '../cell'
import { resizableRuns } from '../derive/walls'
import { WORLD_AREA_ID, newAreaId } from '../ids'
import { putArea } from '../primitives'
import { createArea } from '../factory'
import {
  cellsOf,
  checkInvariants,
  grid,
  makeRoom,
  ok,
  refusal,
  rect,
  setup,
  sorted,
  tx,
} from '../testUtils'
import { placeIcon } from './markup'
import {
  assignRoomArea,
  deleteRooms,
  drawInnerWall,
  eraseCells,
  eraseInnerWall,
  moveCellFragment,
  moveRooms,
  paintCells,
  renameRoom,
  resizeRun,
  setRoomNotes,
  transformRooms,
} from './rooms'
import { createNewArea } from './project'

describe('paint', () => {
  it('creates a room from an empty cell', () => {
    const { project, map } = setup()
    const transaction = tx(map)
    const room = paintCells(transaction, project, map, ['0,0'], { areaId: WORLD_AREA_ID })!
    expect(cellsOf(room)).toEqual(['0,0'])
    expect(map.cellOwner.get('0,0')).toBe(room.id)
    expect(room.areaId).toBe(WORLD_AREA_ID)
  })

  it('grows an existing room when the stroke continues from it', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, ['0,0'])
    makeRoom(project, map, ['1,0', '2,0'], room.id)
    expect(cellsOf(room)).toEqual(['0,0', '1,0', '2,0'])
    expect(map.rooms.size).toBe(1)
  })

  it('absorbs a crossed room whole: the origin room always wins', () => {
    const { project, map } = setup()
    // cells 0,1,2,3: room A at 0, room B at 2-3. Dragging 0->1->2 makes all
    // four one room A and deletes B (the spec's own worked example).
    const a = makeRoom(project, map, ['0,0'])
    const b = makeRoom(project, map, ['2,0', '3,0'])

    makeRoom(project, map, ['1,0', '2,0'], a.id)

    expect(map.rooms.size).toBe(1)
    expect(map.rooms.has(b.id)).toBe(false)
    expect(cellsOf(a)).toEqual(['0,0', '1,0', '2,0', '3,0'])
    // Absorbed cells adopt the surviving room's properties.
    for (const cell of cellsOf(a)) expect(map.cellOwner.get(cell)).toBe(a.id)
  })

  it('keeps the survivor’s own area, not the absorbed room’s', () => {
    const { project, map } = setup()
    const other = createArea(newAreaId(), 'Brinstar', '#111', '#eee')
    const seed = tx()
    putArea(seed, project, other)
    seed.commit()

    const a = makeRoom(project, map, ['0,0'])
    const transaction = tx(map)
    const b = paintCells(transaction, project, map, ['2,0'], { areaId: other.id })!
    transaction.commit()
    expect(b.areaId).toBe(other.id)

    makeRoom(project, map, ['1,0', '2,0'], a.id)
    expect(a.areaId).toBe(WORLD_AREA_ID)
  })

  it('carries the absorbed room’s inner walls across', () => {
    const { project, map } = setup()
    const a = makeRoom(project, map, rect(0, 0, 2, 2))
    const b = makeRoom(project, map, rect(3, 0, 2, 2))

    const wall = tx(map)
    drawInnerWall(wall, map, b.id, edgeOfCell('3,0', 'S'), 'dotted')
    wall.commit()

    makeRoom(project, map, ['2,0', '3,0'], a.id)
    expect(a.innerWalls.get(edgeOfCell('3,0', 'S'))).toBe('dotted')
  })
})

describe('erase and split', () => {
  it('erases cells', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 1))
    const transaction = tx(map)
    eraseCells(transaction, project, map, ['2,0'])
    expect(cellsOf(room)).toEqual(['0,0', '1,0'])
    expect(map.cellOwner.has('2,0')).toBe(false)
  })

  it('splits a room when an erase disconnects it, top-left group keeping identity', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 1))

    const transaction = tx(map)
    eraseCells(transaction, project, map, ['1,0'])

    expect(map.rooms.size).toBe(2)
    // The group holding the top-most-then-left-most cell keeps the identity.
    expect(cellsOf(room)).toEqual(['0,0'])
    const other = [...map.rooms.values()].find((candidate) => candidate.id !== room.id)!
    expect(cellsOf(other)).toEqual(['2,0'])
  })

  it('gives split-off rooms a copy of the original’s properties', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 1))
    room.name = 'Landing Site'
    room.notes = 'start'

    const transaction = tx(map)
    eraseCells(transaction, project, map, ['1,0'])
    const other = [...map.rooms.values()].find((candidate) => candidate.id !== room.id)!
    expect(other.name).toBe('Landing Site')
    expect(other.notes).toBe('start')
    expect(other.areaId).toBe(room.areaId)
  })

  it('deletes the icon on an erased cell', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 2, 1))

    const place = tx(map)
    const icon = ok(placeIcon(place, map, '1,0', 'save'))
    place.commit()
    expect(map.icons.size).toBe(1)

    const transaction = tx(map)
    eraseCells(transaction, project, map, ['1,0'])
    expect(map.icons.has(icon.id)).toBe(false)
    expect(map.iconAtCell.has('1,0')).toBe(false)
  })

  it('drops an inner wall that is no longer strictly interior', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 2))
    const edge = edgeOfCell('0,0', 'S')

    const wall = tx(map)
    ok(drawInnerWall(wall, map, room.id, edge, 'solid'))
    wall.commit()

    const transaction = tx(map)
    eraseCells(transaction, project, map, ['0,1'])
    expect(room.innerWalls.has(edge)).toBe(false)
  })

  it('refuses to draw an inner wall on an outer boundary', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 1))
    const transaction = tx(map)
    // An outer boundary, with the reason spelled out. The Draw-mode gesture can
    // tell a mis-aimed vertex drag from a stale id.
    expect(refusal(drawInnerWall(transaction, map, room.id, edgeOfCell('0,0', 'N'), 'solid'))).toBe(
      'not-interior',
    )
  })
})

describe('delete rooms', () => {
  it('removes the room, its cells and its icons', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 1))
    const place = tx(map)
    ok(placeIcon(place, map, '0,0', 'boss'))
    place.commit()

    const transaction = tx(map)
    deleteRooms(transaction, project, map, [room.id])
    expect(map.rooms.size).toBe(0)
    expect(map.cellOwner.size).toBe(0)
    expect(map.icons.size).toBe(0)
  })
})

describe('resize by edge run', () => {
  it('extrudes only the grabbed run: non-rectangular rooms stay non-rectangular', () => {
    const { project, map } = setup()
    // The spec's L example: grab c1's right edge (the run of 2, rows 0-1) and
    // drag right by two. Row 2 must never be picked up.
    const room = makeRoom(
      project,
      map,
      grid(`
      ##.
      ##.
      ###
    `),
    )
    const run = resizableRuns(room).find(
      (candidate) => candidate.side === 'E' && candidate.cells.length === 2,
    )!

    const transaction = tx(map)
    resizeRun(transaction, project, map, room.id, run, 2)

    expect(cellsOf(room)).toEqual(
      sorted(['0,0', '1,0', '2,0', '3,0', '0,1', '1,1', '2,1', '3,1', '0,2', '1,2', '2,2']),
    )
    // c3,row2 was NOT added.
    expect(map.cellOwner.has('3,2')).toBe(false)
  })

  it('is exactly invertible: expanding N then retracting N restores the geometry', () => {
    const { project, map } = setup()
    // An L, so the restoration is a real claim: a rectangle would come back
    // even if the retraction were sloppy about which cells it took.
    const room = makeRoom(
      project,
      map,
      grid(`
        ##.
        ##.
        ###
      `),
    )
    const before = cellsOf(room)
    const run = resizableRuns(room).find(
      (candidate) => candidate.side === 'E' && candidate.cells.length === 2,
    )!

    const transaction = tx(map)
    resizeRun(transaction, project, map, room.id, run, 3)
    expect(cellsOf(room)).not.toEqual(before)

    // Retract the same run by the same distance. Because only the grabbed run
    // ever moves, this must land exactly back on the original geometry.
    // "out-then-back-to-start = no-op" with no gouging of the pre-existing cells
    // in row 2.
    const grown = resizableRuns(room).find(
      (candidate) => candidate.side === 'E' && candidate.cells.length === 2,
    )!
    resizeRun(transaction, project, map, room.id, grown, -3)
    expect(cellsOf(room)).toEqual(before)
  })

  it('a drag that returns to its origin commits nothing', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 2))
    const before = cellsOf(room)
    const run = resizableRuns(room).find((candidate) => candidate.side === 'E')!

    // How a real drag works: re-apply from scratch on each pointer move rather
    // than stacking deltas.
    const drag = tx(map)
    resizeRun(drag, project, map, room.id, run, 3)
    drag.reset()
    resizeRun(drag, project, map, room.id, run, 0)

    expect(cellsOf(room)).toEqual(before)
    expect(drag.isEmpty).toBe(true)
  })

  it('expands destructively into another room’s cells, taking cells not the whole room', () => {
    const { project, map } = setup()
    const a = makeRoom(project, map, rect(0, 0, 2, 2))
    const b = makeRoom(project, map, rect(2, 0, 2, 2))
    const run = resizableRuns(a).find((candidate) => candidate.side === 'E')!

    const transaction = tx(map)
    resizeRun(transaction, project, map, a.id, run, 1)

    // A took B's first column. B survives with the rest, unlike a paint merge
    // which would have absorbed B entirely.
    expect(map.rooms.has(b.id)).toBe(true)
    expect(cellsOf(b)).toEqual(['3,0', '3,1'])
    expect(map.cellOwner.get('2,0')).toBe(a.id)
  })

  it('shrinks inward by the dragged distance', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 3))
    const run = resizableRuns(room).find((candidate) => candidate.side === 'N')!

    const transaction = tx(map)
    resizeRun(transaction, project, map, room.id, run, -1)
    expect(cellsOf(room)).toEqual(sorted(rect(0, 1, 2, 2)))
  })

  it('floors at one cell: resize can never delete a room outright', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 1))
    const run = resizableRuns(room).find((candidate) => candidate.side === 'N')!

    const transaction = tx(map)
    // Shrinking a 2x1 from the north would take both cells. Asserting the room
    // still exists is the real claim. `cells.size >= 1` is vacuous, since
    // settleRooms deletes any room that reaches zero cells, so a room still in
    // the map has at least one by construction.
    resizeRun(transaction, project, map, room.id, run, -5)
    expect(map.rooms.has(room.id)).toBe(true)
    expect(map.rooms.size).toBe(1)
  })

  it('splits when a shrink disconnects the room', () => {
    const { project, map } = setup()
    // A U shape: shrinking the bottom row away leaves two disconnected arms.
    const room = makeRoom(
      project,
      map,
      grid(`
      #.#
      #.#
      ###
    `),
    )
    const run = resizableRuns(room).find(
      (candidate) => candidate.side === 'S' && candidate.cells.length === 3,
    )!

    const transaction = tx(map)
    resizeRun(transaction, project, map, room.id, run, -1)
    expect(map.rooms.size).toBe(2)
  })
})

describe('move', () => {
  it('preserves identity and carries icons and inner walls', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 2))
    const edge = edgeOfCell('0,0', 'S')

    const seed = tx(map)
    drawInnerWall(seed, map, room.id, edge, 'dotted')
    const icon = ok(placeIcon(seed, map, '1,1', 'save'))
    seed.commit()

    const transaction = tx(map)
    moveRooms(transaction, project, map, [room.id], 5, 5)

    expect(map.rooms.has(room.id)).toBe(true)
    expect(cellsOf(room)).toEqual(sorted(rect(5, 5, 2, 2)))
    expect(icon.cell).toBe('6,6')
    expect(map.iconAtCell.get('6,6')).toBe(icon.id)
    expect(room.innerWalls.has(edgeOfCell('5,5', 'S'))).toBe(true)
  })

  it('overwrites whatever it lands on: the moving room wins', () => {
    const { project, map } = setup()
    const mover = makeRoom(project, map, rect(0, 0, 2, 1))
    const victim = makeRoom(project, map, rect(4, 0, 3, 1))

    const transaction = tx(map)
    moveRooms(transaction, project, map, [mover.id], 4, 0)

    expect(cellsOf(mover)).toEqual(['4,0', '5,0'])
    expect(cellsOf(victim)).toEqual(['6,0'])
  })

  it('shifting by one does not trip the one-icon-per-cell rule', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 1))
    const seed = tx(map)
    ok(placeIcon(seed, map, '0,0', 'a'))
    ok(placeIcon(seed, map, '1,0', 'b'))
    ok(placeIcon(seed, map, '2,0', 'c'))
    seed.commit()

    const transaction = tx(map)
    expect(() => moveRooms(transaction, project, map, [room.id], 1, 0)).not.toThrow()
    expect(sorted(map.iconAtCell.keys())).toEqual(['1,0', '2,0', '3,0'])
  })

  it('is a no-op when dropped back on its origin', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 2))
    const transaction = tx(map)
    moveRooms(transaction, project, map, [room.id], 0, 0)
    expect(transaction.isEmpty).toBe(true)
  })
})

describe('rotate and flip', () => {
  it('rotates the room’s cells and keeps its identity', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 1))
    const transaction = tx(map)
    transformRooms(transaction, project, map, [room.id], 'rotateRight')

    expect(map.rooms.has(room.id)).toBe(true)
    expect(room.cells.size).toBe(3)
    // Was a horizontal strip; now vertical.
    const columns = new Set([...room.cells].map((cell) => cell.split(',')[0]))
    expect(columns.size).toBe(1)
  })

  it('carries icons to their new cell', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 2))
    const seed = tx(map)
    const icon = ok(placeIcon(seed, map, '0,0', 'save'))
    seed.commit()

    const transaction = tx(map)
    transformRooms(transaction, project, map, [room.id], 'flipH')
    expect(icon.cell).toBe('1,0')
  })
})

describe('cell-fragment move', () => {
  it('makes new rooms and leaves the identity with the leftover', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 4, 1))

    const transaction = tx(map)
    const created = moveCellFragment(transaction, project, map, ['2,0', '3,0'], 0, 5)

    expect(created).toHaveLength(1)
    expect(created[0].id).not.toBe(room.id)
    // The leftover keeps the original identity.
    expect(cellsOf(room)).toEqual(['0,0', '1,0'])
    expect(cellsOf(created[0])).toEqual(['2,5', '3,5'])
  })

  it('inherits the source area', () => {
    const { project, map } = setup()
    const other = createArea(newAreaId(), 'Norfair', '#222', '#ddd')
    const seed = tx()
    putArea(seed, project, other)
    seed.commit()

    const paint = tx(map)
    paintCells(paint, project, map, rect(0, 0, 3, 1), { areaId: other.id })
    paint.commit()

    const transaction = tx(map)
    const created = moveCellFragment(transaction, project, map, ['2,0'], 0, 4)
    expect(created[0].areaId).toBe(other.id)
  })

  it('splits the leftover by the top-left tiebreaker when the cut disconnects it', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 5, 1))

    const transaction = tx(map)
    moveCellFragment(transaction, project, map, ['2,0'], 0, 6)

    // Original + two leftover pieces (one keeps identity) + the new fragment.
    expect(map.rooms.size).toBe(3)
    expect(cellsOf(room)).toEqual(['0,0', '1,0'])
  })
})

// These four had no test at all, which is why converting them from Room to
// RoomId changed nothing visible. They are the ops the inspector calls.
describe('room properties', () => {
  it('renames, re-notes and reassigns the area by id', () => {
    const { project, map } = setup()
    const create = tx()
    const brinstar = createNewArea(create, project, 'Brinstar', '#2b6', '#efe')
    create.commit()

    const room = makeRoom(project, map, rect(0, 0, 2, 2))
    const edit = tx(map)
    renameRoom(edit, map, room.id, 'Landing Site')
    setRoomNotes(edit, map, room.id, 'save point here')
    assignRoomArea(edit, map, room.id, brinstar.id)
    edit.commit()

    expect(room.name).toBe('Landing Site')
    expect(room.notes).toBe('save point here')
    expect(room.areaId).toBe(brinstar.id)
    expect(checkInvariants(project)).toEqual([])
  })

  it('undoes a rename', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 2))
    const before = room.name

    const edit = tx(map)
    renameRoom(edit, map, room.id, 'Crateria')
    expect(room.name).toBe('Crateria')
    edit.rollback()

    expect(room.name).toBe(before)
    void project
  })

  it('erases an inner wall by room id', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 2))
    const edge = edgeOfCell('0,0', 'E')

    const draw = tx(map)
    ok(drawInnerWall(draw, map, room.id, edge, 'dotted'))
    draw.commit()
    expect(room.innerWalls.get(edge)).toBe('dotted')

    const erase = tx(map)
    eraseInnerWall(erase, map, room.id, edge)
    erase.commit()

    expect(room.innerWalls.has(edge)).toBe(false)
    expect(checkInvariants(project)).toEqual([])
  })

  it('throws on a stale room id rather than doing nothing', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, ['9,9'])
    const kill = tx(map)
    deleteRooms(kill, project, map, [room.id])
    kill.commit()

    const edit = tx(map)
    expect(() => renameRoom(edit, map, room.id, 'Nowhere')).toThrow(/no room with id/)
    expect(() => setRoomNotes(edit, map, room.id, 'x')).toThrow(/no room with id/)
    expect(() => assignRoomArea(edit, map, room.id, WORLD_AREA_ID)).toThrow(/no room with id/)
    expect(() => eraseInnerWall(edit, map, room.id, edgeOfCell('9,9', 'E'))).toThrow(
      /no room with id/,
    )
  })
})
