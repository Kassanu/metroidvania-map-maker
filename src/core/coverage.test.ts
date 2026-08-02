import { describe, it, expect } from 'vitest'
import { edgeOfCell } from './cell'
import { farEndCount, getFarEnd } from './farEnds'
import { History } from './history'
import { OPEN_LOCK_ID, WORLD_AREA_ID } from './ids'
import { Transaction } from './journal'
import { createFromBox, createTeleport, swapEnds } from './ops/doors'
import { addMap, deleteMap, duplicateMap, reorderMap } from './ops/maps'
import { normalizePath, placeIcon } from './ops/markup'
import { drawInnerWall, moveRooms, paintCells, transformRooms } from './ops/rooms'
import { fromJSON, toJSON } from './serialize'
import {
  checkInvariants,
  cellsOf,
  makeRoom,
  ok,
  rect,
  setup,
  snapshot,
  sorted,
  tx,
  TEST_NAV_LABEL as NAVIGATION_LABEL,
  TEST_ICON_COLORS,
} from './testUtils'

describe('duplicateMap: cloneTransition', () => {
  it('clones same-map doors, elevators and teleports with fresh ids', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 1, 2))
    makeRoom(project, map, rect(1, 0, 1, 2))
    makeRoom(project, map, ['5,0'])

    const seed = tx(map)
    ok(createFromBox(seed, project, map, '0,0', '1,0')) // door
    ok(createFromBox(seed, project, map, '1,0', '5,0')) // elevator across a gap
    ok(
      createTeleport(seed, project, { mapId: map.id, cell: '0,1' }, { mapId: map.id, cell: '5,0' }),
    )
    seed.commit()
    expect(map.transitions.size).toBe(3)

    const transaction = tx()
    const copy = duplicateMap(transaction, project, map.id, 'Map 1 copy')!

    expect(copy.transitions.size).toBe(3)
    const originalIds = new Set(map.transitions.keys())
    for (const transition of copy.transitions.values()) {
      expect(originalIds.has(transition.id)).toBe(false)
    }
    // A cloned teleport's endpoints must point at the *copy*, not the source.
    const teleport = [...copy.transitions.values()].find((t) => t.kind === 'teleport')!
    expect(teleport.kind === 'teleport' && teleport.a.mapId).toBe(copy.id)
    expect(checkInvariants(project)).toEqual([])
  })

  it('drops a cross-tab teleport rather than breaking one-per-cell at the far end', () => {
    const { project, map } = setup()
    const seed = tx()
    const second = addMap(seed, project, 'Map 2')
    seed.commit()

    makeRoom(project, map, ['0,0'])
    makeRoom(project, second, ['9,9'])
    const link = tx(map)
    ok(
      createTeleport(
        link,
        project,
        { mapId: map.id, cell: '0,0' },
        { mapId: second.id, cell: '9,9' },
      ),
    )
    link.commit()

    const transaction = tx()
    const copy = duplicateMap(transaction, project, map.id, 'Map 1 copy')!

    // The copy keeps its local content and loses its link out: the only
    // outcome that leaves the far-end index consistent.
    expect(copy.rooms.size).toBe(1)
    expect(copy.transitions.size).toBe(0)
    expect(farEndCount(project.teleportFarEnds)).toBe(1)
    expect(checkInvariants(project)).toEqual([])
  })

  it('copies inner walls', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 2))
    const edge = edgeOfCell('0,0', 'S')
    const seed = tx(map)
    drawInnerWall(seed, map, room.id, edge, 'dotted')
    seed.commit()

    const transaction = tx()
    const copy = duplicateMap(transaction, project, map.id, 'copy')!
    const copiedRoom = [...copy.rooms.values()][0]
    expect(copiedRoom.innerWalls.get(edge)).toBe('dotted')
  })
})

describe('serialization of every transition kind', () => {
  it('round-trips an elevator', () => {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0'])
    makeRoom(project, map, ['0,4'])
    const seed = tx(map)
    const [elevator] = ok(createFromBox(seed, project, map, '0,0', '0,4'))
    seed.commit()
    expect(elevator.kind).toBe('elevator')

    const { project: reloaded } = fromJSON(toJSON(project))
    expect(toJSON(reloaded)).toEqual(toJSON(project))

    const copy = [...reloaded.mapsById.get(map.id)!.transitions.values()][0]
    expect(copy.kind).toBe('elevator')
    if (copy.kind !== 'elevator') return
    expect(copy.a).toBe('0,0')
    expect(copy.b).toBe('0,4')
    expect(copy.axis).toBe('v')
    expect(checkInvariants(reloaded)).toEqual([])
  })
})

describe('swapEnds for every kind', () => {
  it('swaps an edge door’s per-segment sides', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 1, 2))
    makeRoom(project, map, rect(1, 0, 1, 2))
    const transaction = tx(map)
    const [door] = ok(createFromBox(transaction, project, map, '0,0', '1,1'))
    if (door.kind !== 'edge') throw new Error('expected an edge door')

    const before = door.segments.map((segment) => segment.aSide)
    const swapped = swapEnds(door)
    if (swapped.kind !== 'edge') throw new Error('expected an edge door')
    expect(swapped.segments.map((segment) => segment.aSide)).toEqual(
      before.map((side) => (side === 'lo' ? 'hi' : 'lo')),
    )
  })

  it('swaps an elevator’s endpoints and locks', () => {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0'])
    makeRoom(project, map, ['0,4'])
    const transaction = tx(map)
    const [elevator] = ok(createFromBox(transaction, project, map, '0,0', '0,4'))
    if (elevator.kind !== 'elevator') throw new Error('expected an elevator')

    const swapped = swapEnds(elevator)
    if (swapped.kind !== 'elevator') throw new Error('expected an elevator')
    expect(swapped.a).toBe(elevator.b)
    expect(swapped.b).toBe(elevator.a)
    expect(swapped.locks).toEqual({ a: OPEN_LOCK_ID, b: OPEN_LOCK_ID })
  })
})

describe('multi-object operations', () => {
  it('moves several rooms as one group, preserving their relative positions', () => {
    const { project, map } = setup()
    const a = makeRoom(project, map, rect(0, 0, 2, 1))
    const b = makeRoom(project, map, rect(5, 3, 1, 2))

    const transaction = tx(map)
    moveRooms(transaction, project, map, [a.id, b.id], 10, 10)

    expect(cellsOf(a)).toEqual(sorted(rect(10, 10, 2, 1)))
    expect(cellsOf(b)).toEqual(sorted(rect(15, 13, 1, 2)))
    expect(checkInvariants(project)).toEqual([])
  })

  it('preserves a door between two rooms moved together', () => {
    const { project, map } = setup()
    const a = makeRoom(project, map, rect(0, 0, 1, 2))
    const b = makeRoom(project, map, rect(1, 0, 1, 2))
    const seed = tx(map)
    ok(createFromBox(seed, project, map, '0,0', '1,1'))
    seed.commit()
    expect(map.transitions.size).toBe(1)

    // Both endpoints translate by the same delta, so the geometry stays valid.
    const transaction = tx(map)
    moveRooms(transaction, project, map, [a.id, b.id], 4, 4)
    expect(map.transitions.size).toBe(1)
    expect(checkInvariants(project)).toEqual([])
  })

  it('transforms a multi-room selection as a rigid group', () => {
    const { project, map } = setup()
    const a = makeRoom(project, map, ['0,0'])
    const b = makeRoom(project, map, ['2,0'])

    const transaction = tx(map)
    transformRooms(transaction, project, map, [a.id, b.id], 'rotateRight')

    // The two rooms keep their separation, now along the other axis.
    const aCell = [...a.cells][0]
    const bCell = [...b.cells][0]
    expect(aCell.split(',')[0]).toBe(bCell.split(',')[0])
    expect(Math.abs(Number(aCell.split(',')[1]) - Number(bCell.split(',')[1]))).toBe(2)
    expect(checkInvariants(project)).toEqual([])
  })

  it('commits a batch as one undoable step', () => {
    const { project, map, history } = setup()
    const a = makeRoom(project, map, ['0,0'])
    const b = makeRoom(project, map, ['5,5'])
    const before = snapshot(project)

    const transaction = history.begin('Move selection', { kind: 'map', mapId: map.id })
    moveRooms(transaction, project, map, [a.id, b.id], 1, 1)
    history.commit(transaction)

    history.undo()
    expect(snapshot(project)).toEqual(before)
  })
})

describe('Transaction.absorb', () => {
  it('folds another open transaction’s changes in, and its touched set', () => {
    const { project, map } = setup()
    const first = tx(map)
    const room = paintCells(first, project, map, ['0,0'], { areaId: WORLD_AREA_ID })!

    const second = tx(map)
    paintCells(second, project, map, ['1,0'], { areaId: WORLD_AREA_ID, intoRoomId: room.id })

    first.absorb(second)
    expect(second.size).toBe(0)
    expect(first.touched.rooms.has(room.id)).toBe(true)

    // Undoing the merged transaction reverts both halves.
    first.replayUndo()
    expect(map.rooms.size).toBe(0)
  })
})

describe('History edges', () => {
  it('trims the oldest entry past the limit', () => {
    const { project, map } = setup()
    const history = new History(project, 2)
    for (let i = 0; i < 4; i++) {
      const transaction = history.begin(`Paint ${i}`, { kind: 'map', mapId: map.id })
      paintCells(transaction, project, map, [`${i * 2},0`], { areaId: WORLD_AREA_ID })
      history.commit(transaction)
    }
    expect(history.undoLabel).toBe('Paint 3')
    history.undo()
    history.undo()
    expect(history.canUndo).toBe(false)
  })

  it('clear() drops both stacks', () => {
    const { project, map, history } = setup()
    const transaction = history.begin('Paint', { kind: 'map', mapId: map.id })
    paintCells(transaction, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
    history.commit(transaction)
    history.undo()

    history.clear()
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    expect(history.redoLabel).toBeNull()
  })

  it('ignores a navigation to the tab already active', () => {
    const { map, history } = setup()
    history.pushNavigation(map.id, map.id, NAVIGATION_LABEL)
    expect(history.canUndo).toBe(false)
  })

  it('reports redoLabel after an undo', () => {
    const { project, map, history } = setup()
    const transaction = history.begin('Paint room', { kind: 'map', mapId: map.id })
    paintCells(transaction, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
    history.commit(transaction)
    history.undo()
    expect(history.redoLabel).toBe('Paint room')
  })

  it('an empty commit leaves the revision untouched', () => {
    const { project, map, history } = setup()
    const before = project.rev
    const transaction = history.begin('Nothing', { kind: 'map', mapId: map.id })
    expect(history.commit(transaction)).toBeNull()
    expect(project.rev).toBe(before)
  })

  it('coalescing a navigation clears the redo branch', () => {
    const { project, map, history } = setup()
    const seed = history.begin('Add map', { kind: 'project' })
    const second = addMap(seed, project, 'Map 2')
    history.commit(seed)
    history.undo()
    expect(history.canRedo).toBe(true)

    history.pushNavigation(map.id, second.id, NAVIGATION_LABEL)
    history.pushNavigation(second.id, map.id, NAVIGATION_LABEL)
    expect(history.canRedo).toBe(false)
    expect(history.undoLabel).toBe(NAVIGATION_LABEL)
  })
})

describe('map ops undo', () => {
  it('undoes a reorder', () => {
    const { project, history } = setup()
    const seed = history.begin('Add maps', { kind: 'project' })
    const b = addMap(seed, project, 'Map 2')
    addMap(seed, project, 'Map 3')
    history.commit(seed)
    const before = [...project.maps]

    const transaction = history.begin('Reorder tab', { kind: 'project' })
    reorderMap(transaction, project, b.id, 0)
    history.commit(transaction)
    expect(project.maps[0]).toBe(b.id)

    history.undo()
    expect(project.maps).toEqual(before)
  })

  it('deleting a middle tab leaves the rest in order', () => {
    const { project } = setup()
    const seed = tx()
    const b = addMap(seed, project, 'Map 2')
    const c = addMap(seed, project, 'Map 3')
    seed.commit()
    const first = project.maps[0]

    const transaction = tx()
    deleteMap(transaction, project, b.id, 'Map 4')
    expect(project.maps).toEqual([first, c.id])
  })
})

describe('structure revision', () => {
  it('moves for project-scope edits that touch no map content', () => {
    const { project } = setup()
    const before = project.structureRev

    const transaction = tx()
    addMap(transaction, project, 'Map 2')
    expect(project.structureRev).toBeGreaterThan(before)
  })

  it('moves for a tab reorder', () => {
    const { project } = setup()
    const seed = tx()
    const second = addMap(seed, project, 'Map 2')
    seed.commit()
    const before = project.structureRev

    const transaction = tx()
    reorderMap(transaction, project, second.id, 0)
    expect(project.structureRev).toBeGreaterThan(before)
  })
})

describe('normalizePath', () => {
  it('truncates at a gap rather than accepting a jump', () => {
    // Documented v1 behaviour: the gesture layer is responsible for
    // interpolating a fast pointer, and the model refuses to invent a path it
    // was not given. The trailing points after the break are dropped.
    expect(normalizePath(['0,0', '1,0', '9,9', '9,8'])).toEqual(['0,0', '1,0'])
  })
})

describe('icons across a cross-map boundary', () => {
  it('keeps each map’s icon index independent', () => {
    const { project, map } = setup()
    const seed = tx()
    const second = addMap(seed, project, 'Map 2')
    seed.commit()
    makeRoom(project, map, ['0,0'])
    makeRoom(project, second, ['0,0'])

    const transaction = tx(map)
    ok(placeIcon(transaction, map, '0,0', 'save', TEST_ICON_COLORS))
    ok(placeIcon(transaction, second, '0,0', 'boss', TEST_ICON_COLORS))

    expect(map.icons.size).toBe(1)
    expect(second.icons.size).toBe(1)
    expect(getFarEnd(project.teleportFarEnds, second.id, '0,0')).toBeUndefined()
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('the invariant checker itself', () => {
  it('passes on a freshly created project', () => {
    const { project } = setup()
    expect(checkInvariants(project)).toEqual([])
  })

  it('catches a deliberately corrupted index', () => {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0'])
    map.cellOwner.set('9,9', [...map.rooms.keys()][0])
    expect(checkInvariants(project).length).toBeGreaterThan(0)
  })
})

describe('unused-transaction guards', () => {
  it('refuses to reset a committed transaction', () => {
    const transaction = new Transaction('t')
    transaction.commit()
    expect(() => transaction.reset()).toThrow()
  })
})
