import { describe, it, expect } from 'vitest'
import { Transaction, emptyTouchSet, isTouchSetEmpty } from './journal'
import { WORLD_AREA_ID } from './ids'
import { paintCells, eraseCells } from './ops/rooms'
import { setup, rect, sorted, tx } from './testUtils'

describe('Transaction', () => {
  it('applies a change when it is recorded', () => {
    const transaction = new Transaction('test')
    let value = 0
    transaction.record({
      redo: () => {
        value = 1
      },
      undo: () => {
        value = 0
      },
    })
    expect(value).toBe(1)
  })

  it('replays undo in reverse order', () => {
    const transaction = new Transaction('test')
    const log: string[] = []
    for (const name of ['a', 'b', 'c']) {
      transaction.record({
        redo: () => log.push(`+${name}`),
        undo: () => log.push(`-${name}`),
      })
    }
    transaction.replayUndo()
    expect(log).toEqual(['+a', '+b', '+c', '-c', '-b', '-a'])
  })

  it('refuses to record after commit or rollback', () => {
    const committed = new Transaction('test')
    committed.commit()
    expect(() => committed.record({ redo: () => {}, undo: () => {} })).toThrow()

    const rolled = new Transaction('test')
    rolled.rollback()
    expect(() => rolled.record({ redo: () => {}, undo: () => {} })).toThrow()
  })

  it('refuses to roll back a committed transaction', () => {
    const transaction = new Transaction('test')
    transaction.commit()
    expect(() => transaction.rollback()).toThrow(/undo it instead/)
  })

  it('reports emptiness, which is how no-op gestures avoid the undo stack', () => {
    const transaction = new Transaction('test')
    expect(transaction.isEmpty).toBe(true)
    transaction.record({ redo: () => {}, undo: () => {} })
    expect(transaction.isEmpty).toBe(false)
  })
})

describe('touch sets', () => {
  it('starts empty', () => {
    expect(isTouchSetEmpty(emptyTouchSet())).toBe(true)
  })

  it('records the rooms an operation destroyed, which is what the ghost highlights', () => {
    const { project, map } = setup()

    const victim = new Transaction('seed', { kind: 'map', mapId: map.id })
    const absorbed = paintCells(victim, project, map, rect(2, 0, 2, 1), {
      areaId: WORLD_AREA_ID,
    })!
    victim.commit()

    const merge = tx(map)
    paintCells(merge, project, map, rect(0, 0, 3, 1), { areaId: WORLD_AREA_ID })
    expect(merge.touched.removedRooms.has(absorbed.id)).toBe(true)
  })
})

describe('speculative apply: the ghost', () => {
  // The load-bearing property: a transaction that is applied and then reset
  // leaves the model bit-for-bit as it was, so a drag can re-apply on every
  // pointer move and Esc can abort with nothing left behind.
  it('reset restores the model exactly, and the transaction stays reusable', () => {
    const { project, map } = setup()
    const seed = tx(map)
    paintCells(seed, project, map, rect(0, 0, 2, 2), { areaId: WORLD_AREA_ID })
    seed.commit()

    const before = snapshot(map)

    const drag = tx(map)
    paintCells(drag, project, map, rect(2, 0, 2, 2), { areaId: WORLD_AREA_ID })
    expect(snapshot(map)).not.toEqual(before)

    drag.reset()
    expect(snapshot(map)).toEqual(before)
    expect(isTouchSetEmpty(drag.touched)).toBe(true)

    // Still open: re-apply with different cells, as a pointer move would.
    paintCells(drag, project, map, rect(2, 0, 1, 1), { areaId: WORLD_AREA_ID })
    expect(map.cellOwner.has('2,0')).toBe(true)
    expect(map.cellOwner.has('3,0')).toBe(false)

    drag.rollback()
    expect(snapshot(map)).toEqual(before)
  })

  it('rolls back a destructive merge completely, including the absorbed room', () => {
    const { project, map } = setup()
    const a = makeRoomAt(project, map, rect(0, 0, 2, 1))
    const b = makeRoomAt(project, map, rect(3, 0, 2, 1))
    const before = snapshot(map)

    const drag = tx(map)
    // The stroke crosses the gap and lands on one of B's cells, which absorbs
    // B whole. The origin room always wins.
    paintCells(drag, project, map, ['2,0', '3,0'], { areaId: WORLD_AREA_ID, intoRoomId: a })
    expect(map.rooms.size).toBe(1)

    drag.rollback()
    expect(map.rooms.size).toBe(2)
    expect(map.rooms.has(b)).toBe(true)
    expect(snapshot(map)).toEqual(before)
  })

  it('rolls back an erase that split a room into three', () => {
    const { project, map } = setup()
    makeRoomAt(project, map, rect(0, 0, 5, 1))
    const before = snapshot(map)

    const drag = tx(map)
    eraseCells(drag, project, map, ['1,0', '3,0'])
    expect(map.rooms.size).toBe(3)

    drag.rollback()
    expect(map.rooms.size).toBe(1)
    expect(snapshot(map)).toEqual(before)
  })
})

function makeRoomAt(
  project: ReturnType<typeof setup>['project'],
  map: ReturnType<typeof setup>['map'],
  cells: string[],
) {
  const transaction = tx(map)
  const room = paintCells(transaction, project, map, cells, { areaId: WORLD_AREA_ID })!
  transaction.commit()
  return room.id
}

// A structural fingerprint of the map: everything a rollback has to restore,
// including the indices, which is the part a naive "re-run the inverse
// mutation" scheme tends to get subtly wrong.
function snapshot(map: ReturnType<typeof setup>['map']) {
  return {
    rooms: [...map.rooms.values()]
      .map((room) => ({
        id: room.id,
        areaId: room.areaId,
        name: room.name,
        cells: sorted(room.cells),
        walls: [...room.innerWalls.entries()].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    roomOrder: [...map.roomOrder],
    cellOwner: [...map.cellOwner.entries()].sort(),
    icons: [...map.iconAtCell.entries()].sort(),
    transitions: [...map.transitions.keys()].sort(),
  }
}
