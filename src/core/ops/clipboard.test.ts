import { describe, it, expect } from 'vitest'
import { edgeOfCell } from '../cell'
import { createNewArea } from './project'
import { copyCells, copyLines, copyRooms, cutCells, duplicateRooms, paste } from './clipboard'
import { createFromBox } from './doors'
import { createLine, placeIcon } from './markup'
import { drawInnerWall, paintCells } from './rooms'
import { cellsOf, checkInvariants, grid, makeRoom, ok, rect, setup, sorted, tx } from '../testUtils'

const LINE_DEFAULTS = { color: '#ffcc00', arrowStart: false, arrowEnd: true }

describe('copy and paste: whole rooms', () => {
  it('pastes a new room carrying inner walls and icons, with a new id', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 2))
    const seed = tx(map)
    drawInnerWall(seed, map, room.id, edgeOfCell('0,0', 'S'), 'dotted')
    ok(placeIcon(seed, map, '1,1', 'save'))
    seed.commit()

    const payload = copyRooms(map, [room.id])
    const transaction = tx(map)
    const { rooms } = paste(transaction, project, map, payload, { at: { x: 10, y: 10 } })

    expect(rooms).toHaveLength(1)
    expect(rooms[0].id).not.toBe(room.id)
    expect(cellsOf(rooms[0])).toEqual(sorted(rect(10, 10, 2, 2)))
    expect(rooms[0].innerWalls.get(edgeOfCell('10,10', 'S'))).toBe('dotted')
    expect(map.iconAtCell.get('11,11')).toBeDefined()
    // The original is untouched.
    expect(cellsOf(room)).toEqual(sorted(rect(0, 0, 2, 2)))
    expect(checkInvariants(project)).toEqual([])
  })

  it('applies the "<name> copy" convention through nameFor', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, ['0,0'])
    room.name = 'Landing Site'

    const payload = copyRooms(map, [room.id])
    const transaction = tx(map)
    const { rooms } = paste(transaction, project, map, payload, {
      at: { x: 5, y: 5 },
      nameFor: ({ name }) => `${name} copy`,
    })
    expect(rooms[0].name).toBe('Landing Site copy')
  })

  it('never carries transitions: they connect two rooms', () => {
    const { project, map } = setup()
    const a = makeRoom(project, map, rect(0, 0, 1, 2))
    const b = makeRoom(project, map, rect(1, 0, 1, 2))
    const seed = tx(map)
    ok(createFromBox(seed, project, map, '0,0', '1,1'))
    seed.commit()
    expect(map.transitions.size).toBe(1)

    const payload = copyRooms(map, [a.id, b.id])
    const transaction = tx(map)
    paste(transaction, project, map, payload, { at: { x: 20, y: 20 } })

    // Still just the original door; the paste redraws nothing.
    expect(map.transitions.size).toBe(1)
    expect(checkInvariants(project)).toEqual([])
  })

  it('is destructive at the destination: incoming wins', () => {
    const { project, map } = setup()
    const source = makeRoom(project, map, rect(0, 0, 2, 1))
    const victim = makeRoom(project, map, rect(10, 10, 3, 1))

    const payload = copyRooms(map, [source.id])
    const transaction = tx(map)
    paste(transaction, project, map, payload, { at: { x: 10, y: 10 } })

    expect(cellsOf(victim)).toEqual(['12,10'])
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('copy and paste: cell fragments', () => {
  it('produces new rooms by connectivity, not by the source’s boundaries', () => {
    const { project, map } = setup()
    // One source room, but the grabbed cells are two disconnected groups.
    makeRoom(project, map, rect(0, 0, 5, 1))

    const payload = copyCells(map, ['0,0', '1,0', '3,0', '4,0'])
    const transaction = tx(map)
    const { rooms } = paste(transaction, project, map, payload, { at: { x: 0, y: 10 } })

    expect(rooms).toHaveLength(2)
    expect(sorted(rooms.flatMap((room) => [...room.cells]))).toEqual(
      sorted(['0,10', '1,10', '3,10', '4,10']),
    )
    expect(checkInvariants(project)).toEqual([])
  })

  it('carries no identity: a fragment paste gets fresh names', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 1))
    room.name = 'Brinstar Entry'
    room.notes = 'important'

    const payload = copyCells(map, ['0,0', '1,0'])
    const transaction = tx(map)
    const { rooms } = paste(transaction, project, map, payload, {
      at: { x: 0, y: 5 },
      nameFor: ({ index }) => `Room ${index + 1}`,
    })
    expect(rooms[0].name).toBe('Room 1')
    expect(rooms[0].notes).toBe('')
  })

  it('inherits the source area (B8.1) via the top-left-most cell', () => {
    const { project, map } = setup()
    const create = tx()
    const brinstar = createNewArea(create, project, 'Brinstar', '#2b6', '#efe')
    create.commit()

    const paint = tx(map)
    paintCells(paint, project, map, rect(0, 0, 2, 1), { areaId: brinstar.id })
    paint.commit()

    const payload = copyCells(map, ['0,0', '1,0'])
    const transaction = tx(map)
    const { rooms } = paste(transaction, project, map, payload, { at: { x: 0, y: 8 } })
    expect(rooms[0].areaId).toBe(brinstar.id)
  })

  it('carries only strictly-interior inner walls', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 1))
    const interior = edgeOfCell('0,0', 'E') // between (0,0) and (1,0)
    const straddling = edgeOfCell('1,0', 'E') // between (1,0) and (2,0)
    const seed = tx(map)
    drawInnerWall(seed, map, room.id, interior, 'solid')
    drawInnerWall(seed, map, room.id, straddling, 'dotted')
    seed.commit()

    // Grab only (0,0) and (1,0): `interior` is inside the grab, `straddling`
    // has one cell left behind and must be carried by neither piece.
    const payload = copyCells(map, ['0,0', '1,0'])
    expect(payload.innerWalls).toHaveLength(1)

    const transaction = tx(map)
    const { rooms } = paste(transaction, project, map, payload, { at: { x: 0, y: 6 } })
    expect(rooms[0].innerWalls.get(edgeOfCell('0,6', 'E'))).toBe('solid')
    expect(rooms[0].innerWalls.size).toBe(1)
  })
})

describe('cut', () => {
  it('removes the cells from the source and applies the split rule', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 5, 1))

    const transaction = tx(map)
    const payload = cutCells(transaction, project, map, ['2,0'])

    expect(payload.cells).toHaveLength(1)
    // The cut disconnected the source, so it split.
    expect(map.rooms.size).toBe(2)
    expect(cellsOf(room)).toEqual(['0,0', '1,0'])
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('lines', () => {
  it('are not carried incidentally by a room copy', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 1))
    const seed = tx(map)
    ok(createLine(seed, map, ['0,0', '1,0', '2,0'], LINE_DEFAULTS))
    seed.commit()

    const payload = copyRooms(map, [room.id])
    expect(payload.lines).toHaveLength(0)

    const transaction = tx(map)
    paste(transaction, project, map, payload, { at: { x: 0, y: 9 } })
    expect(map.lines.size).toBe(1)
  })

  it('travel when explicitly selected', () => {
    const { map } = setup()
    const seed = tx(map)
    const line = ok(createLine(seed, map, ['0,0', '1,0'], LINE_DEFAULTS))
    seed.commit()

    const payload = copyLines(map, [line.id])
    expect(payload.lines).toHaveLength(1)

    const { project } = setup()
    const transaction = tx(map)
    const { lines } = paste(transaction, project, map, payload, { at: { x: 4, y: 4 } })
    expect(lines[0].points).toEqual(['4,4', '5,4'])
    expect(lines[0].id).not.toBe(line.id)
  })
})

describe('duplicate', () => {
  it('offsets the copy clear of the original', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 1))

    const transaction = tx(map)
    const created = duplicateRooms(transaction, project, map, [room.id], {
      nameFor: ({ name }) => `${name} copy`,
    })

    expect(created).toHaveLength(1)
    expect(cellsOf(created[0])).toEqual(sorted(rect(3, 0, 2, 1)))
    expect(checkInvariants(project)).toEqual([])
  })

  // The property, rather than one literal: paste is destructive, so any
  // overlap between copy and source deletes part of the source. A 1x2 fixture
  // cannot catch it. The old default of (1,1) missed a one-row room entirely.
  // This sweeps shapes tall and wide enough to expose it.
  it('never eats the source, whatever its shape', () => {
    for (const shape of [
      rect(0, 0, 3, 3),
      rect(0, 0, 1, 4),
      rect(0, 0, 4, 1),
      grid(`
        ##.
        #..
        ###
      `),
    ]) {
      const { project, map } = setup()
      const room = makeRoom(project, map, shape)
      const before = cellsOf(room)

      const transaction = tx(map)
      const created = duplicateRooms(transaction, project, map, [room.id])

      expect(cellsOf(room), `source lost cells duplicating ${shape.length}-cell shape`).toEqual(
        before,
      )
      expect(created).toHaveLength(1)
      expect(created[0].cells.size).toBe(before.length)
      expect(checkInvariants(project)).toEqual([])
    }
  })

  it('honours an explicit offset, including one that overlaps on purpose', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 2))

    const transaction = tx(map)
    const created = duplicateRooms(transaction, project, map, [room.id], {
      offset: { x: 10, y: 10 },
    })

    expect(cellsOf(created[0])).toEqual(sorted(rect(10, 10, 2, 2)))
    expect(checkInvariants(project)).toEqual([])
  })

  it('commits as one undoable step', () => {
    const { project, map, history } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 1))

    const transaction = history.begin('Duplicate', { kind: 'map', mapId: map.id })
    duplicateRooms(transaction, project, map, [room.id], { offset: { x: 5, y: 0 } })
    history.commit(transaction)
    expect(map.rooms.size).toBe(2)

    history.undo()
    expect(map.rooms.size).toBe(1)
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('clipboard survives a paste into another map', () => {
  it('pastes geometry relative to its own origin', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(7, 7, 2, 2))
    const payload = copyRooms(map, [...map.rooms.keys()])

    // Offsets are relative to the payload's top-left, so pasting at the origin
    // lands exactly there regardless of where it was copied from.
    const transaction = tx(map)
    const { rooms } = paste(transaction, project, map, payload, { at: { x: 0, y: 0 } })
    expect(cellsOf(rooms[0])).toEqual(sorted(rect(0, 0, 2, 2)))
  })
})
