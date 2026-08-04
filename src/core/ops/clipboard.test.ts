import { describe, it, expect } from 'vitest'
import { edgeOfCell } from '../cell'
import { createNewArea } from './project'
import {
  copyCells,
  copyLines,
  copyRooms,
  copySelection,
  cutCells,
  cutSelection,
  defaultPasteAt,
  duplicateCells,
  duplicateRooms,
  isClipboardEmpty,
  paste,
} from './clipboard'
import { createFromBox } from './doors'
import { createLine, placeIcon } from './markup'
import { drawInnerWall, moveRooms, paintCells, renameRoom } from './rooms'
import { cellsOf, checkInvariants, grid, makeRoom, ok, rect, setup, sorted, tx } from '../testUtils'

const LINE_DEFAULTS = { color: '#ffcc00', arrowStart: false, arrowEnd: true }

describe('copy and paste: whole rooms', () => {
  it('pastes a new room carrying inner walls and icons, with a new id', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 2))
    const seed = tx(map)
    drawInnerWall(seed, map, room.id, edgeOfCell('0,0', 'S'), 'dotted')
    ok(placeIcon(seed, map, '1,1', 'save', { plateColor: '#3b7dd8', glyphColor: '#f5f7fa' }))
    seed.commit()

    const payload = copyRooms(map, [room.id])
    const transaction = tx(map)
    const { rooms } = paste(transaction, project, map, payload, { at: { x: 10, y: 10 } })

    expect(rooms).toHaveLength(1)
    expect(rooms[0].id).not.toBe(room.id)
    expect(cellsOf(rooms[0])).toEqual(sorted(rect(10, 10, 2, 2)))
    expect(rooms[0].innerWalls.get(edgeOfCell('10,10', 'S'))).toBe('dotted')

    // The copy keeps the original's badge colours: paste rebuilds the icon
    // from the payload, so anything the payload drops is lost silently.
    const pasted = map.icons.get(map.iconAtCell.get('11,11')!)!
    expect(pasted.plateColor).toBe('#3b7dd8')
    expect(pasted.glyphColor).toBe('#f5f7fa')
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

  // The cell granularity's duplicate: a fragment of a room, landing clear of it
  // as a room of its own while the source keeps every cell it had.
  describe('of a cell fragment', () => {
    it('lands the fragment clear of the room it came from', () => {
      const { project, map } = setup()
      const room = makeRoom(project, map, rect(0, 0, 3, 1))

      const transaction = tx(map)
      const created = duplicateCells(transaction, project, map, ['0,0', '1,0'])

      expect(created).toHaveLength(1)
      // Its own width plus a one-cell gap, measured from the fragment's origin
      // rather than the room's: what it clears is what was copied.
      expect(cellsOf(created[0])).toEqual(sorted(rect(3, 0, 2, 1)))
      expect(cellsOf(room)).toEqual(sorted(rect(0, 0, 3, 1)))
      expect(checkInvariants(project)).toEqual([])
    })

    it('carries no identity from the room the cells were in', () => {
      const { project, map } = setup()
      const room = makeRoom(project, map, rect(0, 0, 2, 1))
      const name = tx(map)
      renameRoom(name, map, room.id, 'Engine Room')
      name.commit()

      const transaction = tx(map)
      const [created] = duplicateCells(transaction, project, map, ['0,0'])

      expect(created.name).toBe('')
      expect(created.notes).toBe('')
      expect(created.id).not.toBe(room.id)
    })

    it('makes one room per connected group of the fragment', () => {
      const { project, map } = setup()
      makeRoom(project, map, rect(0, 0, 5, 1))

      const transaction = tx(map)
      const created = duplicateCells(transaction, project, map, ['0,0', '2,0'])

      expect(created).toHaveLength(2)
      expect(checkInvariants(project)).toEqual([])
    })

    it('makes nothing from cells no room owns', () => {
      const { project, map } = setup()
      makeRoom(project, map, rect(0, 0, 1, 1))

      const transaction = tx(map)
      expect(duplicateCells(transaction, project, map, ['9,9'])).toEqual([])
      expect(checkInvariants(project)).toEqual([])
    })
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

describe('a mixed room and line selection', () => {
  // Two payloads merged after the fact would each be relative to their own
  // top-left, and the line would paste somewhere it never was relative to the
  // room. One origin over the union is what keeps the pair rigid.
  it('keeps the geometry between a room and a line, through a paste', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(4, 4, 2, 2))
    const seed = tx(map)
    const line = ok(createLine(seed, map, ['4,7', '5,7'], LINE_DEFAULTS))
    seed.commit()

    const payload = copySelection(map, { rooms: [room.id], lines: [line.id] })
    const transaction = tx(map)
    const pasted = paste(transaction, project, map, payload, { at: { x: 10, y: 20 } })

    // The room's top-left is the union's, so it lands on the anchor; the line
    // stays three rows below it, exactly as it was.
    expect(cellsOf(pasted.rooms[0])).toEqual(sorted(rect(10, 20, 2, 2)))
    expect(pasted.lines[0].points).toEqual(['10,23', '11,23'])
    expect(checkInvariants(project)).toEqual([])
  })

  // The union's top-left can belong to the line rather than the room, and the
  // rule does not care which: it is one anchor for both.
  it('anchors on the line when the line is the top-left of the pair', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(4, 8, 2, 2))
    const seed = tx(map)
    const line = ok(createLine(seed, map, ['2,4', '3,4'], LINE_DEFAULTS))
    seed.commit()

    const payload = copySelection(map, { rooms: [room.id], lines: [line.id] })
    expect(payload.sourceOrigin).toEqual({ x: 2, y: 4 })

    const transaction = tx(map)
    const pasted = paste(transaction, project, map, payload, { at: { x: 0, y: 0 } })
    expect(pasted.lines[0].points).toEqual(['0,0', '1,0'])
    expect(cellsOf(pasted.rooms[0])).toEqual(sorted(rect(2, 4, 2, 2)))
  })

  it('keeps whole-room boundaries when the payload holds both kinds', () => {
    const { project, map } = setup()
    const a = makeRoom(project, map, rect(0, 0, 1, 1))
    const b = makeRoom(project, map, rect(1, 0, 1, 1))
    const seed = tx(map)
    const line = ok(createLine(seed, map, ['0,3', '1,3'], LINE_DEFAULTS))
    seed.commit()

    const payload = copySelection(map, { rooms: [a.id, b.id], lines: [line.id] })
    const transaction = tx(map)
    const pasted = paste(transaction, project, map, payload, { at: { x: 10, y: 10 } })

    // Two rooms in, two rooms out: touching cells do not fuse into one, which
    // is what `fromRooms` decides and what a line in the payload must not undo.
    expect(pasted.rooms).toHaveLength(2)
  })

  it('is empty for a selection holding neither kind', () => {
    const { map } = setup()
    expect(isClipboardEmpty(copySelection(map, {}))).toBe(true)
  })
})

describe('cutSelection', () => {
  it('takes the payload and removes both kinds in the one transaction', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 1))
    const seed = tx(map)
    const line = ok(createLine(seed, map, ['0,3', '1,3'], LINE_DEFAULTS))
    seed.commit()

    const transaction = tx(map)
    const payload = cutSelection(transaction, project, map, { rooms: [room.id], lines: [line.id] })
    transaction.commit()

    expect(map.rooms.has(room.id)).toBe(false)
    expect(map.lines.has(line.id)).toBe(false)
    // The room's two cells. A line carries points rather than cells, so it
    // adds none.
    expect(payload.cells).toHaveLength(2)
    expect(payload.lines).toHaveLength(1)
    expect(checkInvariants(project)).toEqual([])
  })

  // The payload is what was there before the cut, so pasting it back restores
  // the pair, still rigid.
  it('round-trips what it took', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(4, 4, 2, 2))
    const seed = tx(map)
    const line = ok(createLine(seed, map, ['4,7', '5,7'], LINE_DEFAULTS))
    seed.commit()

    const cut = tx(map)
    const payload = cutSelection(cut, project, map, { rooms: [room.id], lines: [line.id] })
    cut.commit()

    const back = tx(map)
    const pasted = paste(back, project, map, payload, { at: payload.sourceOrigin })
    back.commit()

    expect(cellsOf(pasted.rooms[0])).toEqual(sorted(rect(4, 4, 2, 2)))
    expect(pasted.lines[0].points).toEqual(['4,7', '5,7'])
  })
})

describe('the default paste anchor', () => {
  it('clears the source by its own width plus a gap', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(3, 2, 4, 1))

    expect(defaultPasteAt(copyRooms(map, [room.id]))).toEqual({ x: 3 + 4 + 1, y: 2 })
  })

  // The point of recording the origin at copy time: by paste time there may be
  // no source left to measure from.
  it('still answers after the source has been cut', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(3, 2, 2, 2))

    const transaction = tx(map)
    const payload = cutSelection(transaction, project, map, { rooms: [room.id] })
    transaction.commit()

    expect(map.rooms.size).toBe(0)
    expect(defaultPasteAt(payload)).toEqual({ x: 6, y: 2 })
  })

  it('answers where the copy was taken from, not where the source has since moved', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(3, 2, 2, 2))
    const payload = copyRooms(map, [room.id])

    const transaction = tx(map)
    moveRooms(transaction, project, map, [room.id], 10, 10)
    transaction.commit()

    expect(defaultPasteAt(payload)).toEqual({ x: 6, y: 2 })
  })

  // Duplicate and a pointerless paste are the same offset by construction, so
  // the two routes cannot drift apart.
  it('is where duplicate puts its copy', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 1))

    const transaction = tx(map)
    const [copy] = duplicateRooms(transaction, project, map, [room.id])
    transaction.commit()

    const at = defaultPasteAt(copyRooms(map, [room.id]))
    expect(cellsOf(copy)).toEqual(sorted(rect(at.x, at.y, 3, 1)))
  })
})

describe('sourceOrigin', () => {
  it('records the top-left each kind of copy normalised against', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(2, 3, 2, 2))
    const room = makeRoom(project, map, rect(7, 1, 1, 1))
    const seed = tx(map)
    const line = ok(createLine(seed, map, ['9,9', '10,9'], LINE_DEFAULTS))
    seed.commit()

    expect(copyRooms(map, [room.id]).sourceOrigin).toEqual({ x: 7, y: 1 })
    expect(copyCells(map, ['2,4', '3,3']).sourceOrigin).toEqual({ x: 3, y: 3 })
    expect(copyLines(map, [line.id]).sourceOrigin).toEqual({ x: 9, y: 9 })
  })

  it('is the top-left of an empty payload, not a stale coordinate', () => {
    const { map } = setup()
    expect(copyRooms(map, []).sourceOrigin).toEqual({ x: 0, y: 0 })
  })
})
