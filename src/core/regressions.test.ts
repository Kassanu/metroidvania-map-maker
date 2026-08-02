// One test per defect an adversarial review confirmed.
//
// Each of these fails against the code before that review. They are not general
// behaviour tests but pinned reproductions kept so a future refactor cannot
// quietly reintroduce them.

import { describe, it, expect } from 'vitest'
import { edgeCells, edgeOfCell } from './cell'
import { getFarEnd, farEndCount } from './farEnds'
import { isTouchSetEmpty } from './journal'
import { WORLD_AREA_ID } from './ids'
import { Transaction } from './journal'
import { History } from './history'
import { connectedComponents, transformCells } from './derive/connectivity'
import { resizableRuns } from './derive/walls'
import {
  canCompleteTeleport,
  classifyBox,
  createFromBox,
  createTeleport,
  deleteTransition,
  setDirection,
  setLock,
} from './ops/doors'
import { addMap, renameMap, setMapNotes } from './ops/maps'
import { placeIcon } from './ops/markup'
import {
  assignRoomArea,
  deleteRooms,
  drawInnerWall,
  eraseCells,
  isAdjacentToRoom,
  moveCellFragment,
  moveRooms,
  paintCells,
  renameRoom,
  resizeRun,
  setRoomNotes,
  transformRooms,
} from './ops/rooms'
import { copyCells, copyRooms, paste } from './ops/clipboard'
import { createNewArea, createNewLockType, transitionsUsingLockType } from './ops/project'
import {
  FILE_FORMAT,
  FILE_VERSION,
  InvalidFileError,
  fromJSON,
  openProject,
  toJSON,
} from './serialize'
import type { LoadEvent, LoadEventKind, LoadReport } from './serialize'
import type { JsonFile } from './serialize/schema'
import type { MapModel } from './types'
import {
  checkInvariants,
  grid,
  makeRoom,
  ok,
  refusal,
  rect,
  setup,
  snapshot,
  sorted,
  tx,
  TEST_NAV_LABEL,
} from './testUtils'

// Filter to one repair type so a test about one discard is not disturbed by
// unrelated events.
function eventsOf<K extends LoadEventKind>(
  report: LoadReport,
  kind: K,
): Extract<LoadEvent, { kind: K }>[] {
  return report.events.filter((event): event is Extract<LoadEvent, { kind: K }> => {
    return event.kind === kind
  })
}

// Reasons a load discarded transitions, in order: enough to tell a malformed
// one from a geometrically invalid one.
function droppedTransitions(report: LoadReport): string[] {
  return report.events.flatMap((event) =>
    event.kind === 'transition-dropped' ? [event.reason] : [],
  )
}

describe('cross-map teleport ride-along', () => {
  it('does not relocate an endpoint because another map has content at the same cell', () => {
    const { project, map: mapA } = setup()
    const seed = tx()
    const mapB = addMap(seed, project, 'Map 2')
    seed.commit()

    // Both maps have rooms at the same coordinates. Every map shares one
    // unbounded coordinate space, which makes cell-key-only matching unsafe.
    makeRoom(project, mapA, ['0,0'])
    makeRoom(project, mapA, ['10,10'])
    const bNear = makeRoom(project, mapB, ['0,0'])
    makeRoom(project, mapB, ['10,10'])

    const link = tx(mapA)
    const teleport = ok(
      createTeleport(
        link,
        project,
        { mapId: mapA.id, cell: '0,0' },
        { mapId: mapB.id, cell: '0,0' },
      ),
    )
    link.commit()

    // Move a room on map B. Map A is not touched by the user at all.
    const move = tx(mapB)
    moveRooms(move, project, mapB, [bNear.id], 10, 10)

    const after = mapA.transitions.get(teleport.id)!
    expect(after.kind === 'teleport' && after.a.cell).toBe('0,0')
    expect(after.kind === 'teleport' && after.a.mapId).toBe(mapA.id)
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('far-end index', () => {
  function twoMapsWithRooms() {
    const { project, map } = setup()
    const seed = tx()
    const second = addMap(seed, project, 'Map 2')
    seed.commit()
    makeRoom(project, map, ['0,0'])
    makeRoom(project, map, ['5,5'])
    makeRoom(project, second, ['2,2'])
    return { project, map, second }
  }

  it('refuses a second teleport onto an occupied destination cell', () => {
    const { project, map, second } = twoMapsWithRooms()
    const transaction = tx(map)
    ok(
      createTeleport(
        transaction,
        project,
        { mapId: map.id, cell: '0,0' },
        { mapId: second.id, cell: '2,2' },
      ),
    )
    // Different origin, same destination: previously accepted, and the index
    // kept only one of the two.
    expect(
      refusal(
        createTeleport(
          transaction,
          project,
          { mapId: map.id, cell: '5,5' },
          { mapId: second.id, cell: '2,2' },
        ),
      ),
    ).toBe('teleport-exists')
    expect(farEndCount(project.teleportFarEnds)).toBe(1)
  })

  it('reset() restores the index exactly, so a ghost cannot corrupt it', () => {
    const { project, map, second } = twoMapsWithRooms()
    const seed = tx(map)
    ok(
      createTeleport(
        seed,
        project,
        { mapId: map.id, cell: '0,0' },
        { mapId: second.id, cell: '2,2' },
      ),
    )
    seed.commit()

    const before = snapshot(project)

    // A drag that re-applies, exactly as a pointer move does. The op refuses
    // (the far cell is taken), but the transaction must still restore exactly.
    const drag = tx(map)
    createTeleport(drag, project, { mapId: map.id, cell: '5,5' }, { mapId: second.id, cell: '2,2' })
    drag.reset()

    expect(snapshot(project)).toEqual(before)
    expect(getFarEnd(project.teleportFarEnds, second.id, '2,2')).toBeDefined()
    expect(checkInvariants(project)).toEqual([])
  })

  it('deleting one teleport leaves another’s far-end entry intact', () => {
    const { project, map, second } = twoMapsWithRooms()
    makeRoom(project, second, ['7,7'])

    const seed = tx(map)
    const first = ok(
      createTeleport(
        seed,
        project,
        { mapId: map.id, cell: '0,0' },
        { mapId: second.id, cell: '2,2' },
      ),
    )
    const other = ok(
      createTeleport(
        seed,
        project,
        { mapId: map.id, cell: '5,5' },
        { mapId: second.id, cell: '7,7' },
      ),
    )
    seed.commit()
    expect(farEndCount(project.teleportFarEnds)).toBe(2)

    const erase = tx(map)
    eraseCells(erase, project, map, ['0,0'])
    expect(map.transitions.has(first.id)).toBe(false)
    // The survivor keeps its entry.
    expect(getFarEnd(project.teleportFarEnds, second.id, '7,7')?.transitionId).toBe(other.id)
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('resize shrink', () => {
  it('never deletes a room outright, even on a concave shape', () => {
    const { project, map } = setup()
    // C-shape: the N-side run of 2 has depths 1 and 3, so a budget computed
    // from the shallower ray under-counted what an unguarded removal took.
    const room = makeRoom(
      project,
      map,
      grid(`
        ##
        .#
        ##
      `),
    )
    const run = resizableRuns(room).find((candidate) => candidate.side === 'N')

    const transaction = tx(map)
    if (run) resizeRun(transaction, project, map, room.id, run, -3)

    expect(map.rooms.has(room.id)).toBe(true)
    expect(room.cells.size).toBeGreaterThanOrEqual(1)
    expect(checkInvariants(project)).toEqual([])
  })

  it('does not reach cells on the far side of a hole', () => {
    const { project, map } = setup()
    const room = makeRoom(
      project,
      map,
      grid(`
        ##
        .#
        ##
      `),
    )
    const run = resizableRuns(room).find((candidate) => candidate.side === 'N')!

    const transaction = tx(map)
    resizeRun(transaction, project, map, room.id, run, -3)

    // (0,2) sits beyond the gap at (0,1) and was never part of the grabbed
    // run's extrusion, so it must survive.
    expect(map.cellOwner.has('0,2')).toBe(true)
  })
})

describe('Transaction.absorb', () => {
  it('refuses to drain a committed transaction', () => {
    const { project, map, history } = setup()
    const committed = history.begin('Paint room', { kind: 'map', mapId: map.id })
    paintCells(committed, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
    history.commit(committed)

    const later = new Transaction('later', { kind: 'map', mapId: map.id })
    expect(() => later.absorb(committed)).toThrow(/committed/)

    // The undo entry still works, which is the thing the silent drain broke.
    history.undo()
    expect(map.rooms.size).toBe(0)
  })

  it('refuses to drain a rolled-back transaction', () => {
    const rolled = new Transaction('rolled')
    rolled.rollback()
    expect(() => new Transaction('later').absorb(rolled)).toThrow(/rolledBack/)
  })
})

describe('zombie edge doors', () => {
  it('deletes a door whose segments all rode apart, rather than emptying it', () => {
    const { project, map } = setup()
    const a = makeRoom(project, map, rect(0, 0, 1, 2))
    makeRoom(project, map, rect(1, 0, 1, 2))

    const seed = tx(map)
    ok(createFromBox(seed, project, map, '0,0', '1,1'))
    seed.commit()
    expect(map.transitions.size).toBe(1)

    const move = tx(map)
    moveRooms(move, project, map, [a.id], -5, 0)

    expect(map.transitions.size).toBe(0)
    expect(checkInvariants(project)).toEqual([])
  })

  it('survives a save/reload unchanged after such a move', () => {
    const { project, map } = setup()
    const a = makeRoom(project, map, rect(0, 0, 1, 2))
    makeRoom(project, map, rect(1, 0, 1, 2))
    const seed = tx(map)
    ok(createFromBox(seed, project, map, '0,0', '1,1'))
    seed.commit()

    const move = tx(map)
    moveRooms(move, project, map, [a.id], -5, 0)
    move.commit()

    // A zombie serialized and was then dropped by the loader, so a round trip
    // silently changed the model.
    expect(toJSON(fromJSON(toJSON(project)).project)).toEqual(toJSON(project))
  })
})

describe('box thickness', () => {
  it('rejects a box 4 thick across a horizontal boundary', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 2, 2))
    makeRoom(project, map, rect(0, 2, 2, 2))
    // 2 wide, 4 tall: the seam is horizontal, so the thickness across it is 4.
    expect(classifyBox(map, '0,0', '1,3').kind).toBe('invalid')
  })

  it('still accepts the N=1 door and the 2x2 corner', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 1, 2))
    makeRoom(project, map, rect(1, 0, 1, 2))
    expect(classifyBox(map, '0,0', '1,0').kind).toBe('edge')

    const corner = setup()
    makeRoom(corner.project, corner.map, rect(0, 0, 1, 2))
    makeRoom(corner.project, corner.map, rect(1, 0, 1, 1))
    makeRoom(corner.project, corner.map, rect(1, 1, 1, 1))
    const result = classifyBox(corner.map, '0,0', '1,1')
    expect(result.kind).toBe('edge')
  })
})

describe('elevator across an occupied gap', () => {
  it('connects the released room, not an intervening one', () => {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0'])
    makeRoom(project, map, ['3,0'])
    makeRoom(project, map, ['6,0'])

    const result = classifyBox(map, '0,0', '6,0')
    expect(result.kind).toBe('elevator')
    if (result.kind !== 'elevator') return
    expect(result.a).toBe('0,0')
    expect(result.b).toBe('6,0')
  })
})

describe('elevator hit-testing index', () => {
  it('indexes elevator endpoints by edge, so a teleport can share the cell', () => {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0'])
    makeRoom(project, map, ['3,0'])

    const transaction = tx(map)
    const [elevator] = ok(createFromBox(transaction, project, map, '0,0', '3,0'))

    // The facing edge of the origin cell, not its interior.
    expect(map.transitionsAtEdge.get(edgeOfCell('0,0', 'E'))?.has(elevator.id)).toBe(true)
    expect(map.transitionsAtCell.get('0,0')?.has(elevator.id)).toBeFalsy()

    // So a teleport can still take the cell interior.
    expect(
      ok(
        createTeleport(
          transaction,
          project,
          { mapId: map.id, cell: '0,0' },
          { mapId: map.id, cell: '3,0' },
        ),
      ),
    ).not.toBeNull()
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('load-time transition validation', () => {
  function loadWith(mutate: (file: ReturnType<typeof toJSON>) => void) {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 2, 1))
    const file = toJSON(project)
    mutate(file)
    return fromJSON(file)
  }

  it('drops a door whose cells are in the same room', () => {
    const { project, report } = loadWith((file) => {
      file.project.maps[0].transitions.push({
        id: 'tr_bad',
        type: 'edge',
        locks: { a: 'open', b: 'open' },
        geometry: { segments: [{ cell: [1, 0], side: 'W', aSide: 'lo' }] },
      })
    })
    expect(droppedTransitions(report)).toEqual(['invalid-geometry'])
    expect(project.mapsById.get(project.maps[0])!.transitions.size).toBe(0)
    expect(checkInvariants(project)).toEqual([])
  })

  it('drops a self-connecting teleport', () => {
    const { report } = loadWith((file) => {
      file.project.maps[0].transitions.push({
        id: 'tr_self',
        type: 'teleport',
        locks: { a: 'open', b: 'open' },
        geometry: {
          a: { mapId: file.project.maps[0].id, cell: [0, 0] },
          b: { mapId: file.project.maps[0].id, cell: [1, 0] },
        },
      })
    })
    expect(droppedTransitions(report)).toEqual(['invalid-geometry'])
  })
})

describe('duplicate ids on load', () => {
  it('reassigns a colliding room id instead of corrupting roomOrder and cellOwner', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 2, 1))
    const file = toJSON(project)
    const clone = { ...file.project.maps[0].rooms[0], cells: [[5, 5]] as [number, number][] }
    file.project.maps[0].rooms.push(clone)

    const { project: loaded, report } = fromJSON(file)
    const loadedMap = loaded.mapsById.get(loaded.maps[0])!

    expect(report.events.filter((event) => event.kind === 'id-remapped')).toHaveLength(1)
    expect(loadedMap.rooms.size).toBe(2)
    expect(checkInvariants(loaded)).toEqual([])

    // And it does not compound on the next save/load cycle.
    expect(fromJSON(toJSON(loaded)).report.events).toEqual([])
  })
})

describe('rotation symmetry', () => {
  it('rotateRight then rotateLeft is the identity on a mixed-parity box', () => {
    const cells = rect(0, 0, 3, 2)
    const right = [...transformCells(cells, 'rotateRight').values()]
    const back = [...transformCells(right, 'rotateLeft').values()]
    expect(sorted(back)).toEqual(sorted(cells))
  })

  it('holds for the other order, and for a 4x1', () => {
    const cells = rect(0, 0, 3, 2)
    const left = [...transformCells(cells, 'rotateLeft').values()]
    expect(sorted([...transformCells(left, 'rotateRight').values()])).toEqual(sorted(cells))

    const strip = rect(2, 5, 4, 1)
    const rotated = [...transformCells(strip, 'rotateRight').values()]
    expect(sorted([...transformCells(rotated, 'rotateLeft').values()])).toEqual(sorted(strip))
  })

  it('a rotated room returns to its exact cells through the op layer too', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 2))
    const before = sorted(room.cells)

    const transaction = tx(map)
    transformRooms(transaction, project, map, [room.id], 'rotateRight')
    transformRooms(transaction, project, map, [room.id], 'rotateLeft')

    expect(sorted(room.cells)).toEqual(before)
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('dirty state', () => {
  it('is clean again after undoing back to the saved state', () => {
    const { project, map } = setup()
    const history = new History(project)

    const transaction = history.begin('Paint room', { kind: 'map', mapId: map.id })
    paintCells(transaction, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
    history.commit(transaction)
    history.markSaved()
    expect(history.isDirty).toBe(false)

    const second = history.begin('Paint room', { kind: 'map', mapId: map.id })
    paintCells(second, project, map, ['5,5'], { areaId: WORLD_AREA_ID })
    history.commit(second)
    expect(history.isDirty).toBe(true)

    // Back to exactly what is on disk, so the close-without-saving prompt must
    // not fire here.
    history.undo()
    expect(history.isDirty).toBe(false)

    history.redo()
    expect(history.isDirty).toBe(true)
  })
})

describe('ghost id stability', () => {
  it('re-applying a paint keeps the same room id across pointer moves', () => {
    const { project, map } = setup()
    const drag = tx(map)

    const first = paintCells(drag, project, map, ['0,0'], { areaId: WORLD_AREA_ID })!
    const id = first.id

    // A pointer move: reset and re-apply with more cells. The gesture layer
    // passes nothing, the transaction's id source replays the same id, which
    // is a stronger guarantee than the `newRoomId` option this replaced.
    drag.reset()
    const second = paintCells(drag, project, map, ['0,0', '1,0'], { areaId: WORLD_AREA_ID })!

    expect(second.id).toBe(id)
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('paint must not leave a disconnected room', () => {
  it('splits a diagonal stroke, which is what a pointer drag actually samples', () => {
    const { project, map } = setup()
    const drag = tx(map)
    paintCells(drag, project, map, ['0,0', '1,1', '2,2', '3,3'], { areaId: WORLD_AREA_ID })
    drag.commit()

    expect(checkInvariants(project)).toEqual([])
    // Four cells touching only at their corners are four rooms: orthogonal
    // adjacency is the rule, and a staircase has none.
    expect(map.rooms.size).toBe(4)
  })

  it('splits a stroke that adds a cell nowhere near the room it grows', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 2))

    const drag = tx(map)
    paintCells(drag, project, map, ['20,20'], { areaId: WORLD_AREA_ID, intoRoomId: room.id })
    drag.commit()

    expect(checkInvariants(project)).toEqual([])
    expect(map.rooms.size).toBe(2)
  })

  it('keeps an ordinary contiguous stroke as one room', () => {
    const { project, map } = setup()
    const drag = tx(map)
    paintCells(drag, project, map, ['0,0', '1,0', '2,0', '2,1'], { areaId: WORLD_AREA_ID })
    drag.commit()

    expect(map.rooms.size).toBe(1)
    expect(checkInvariants(project)).toEqual([])
  })

  it('still merges a crossed room whole, and still leaves one room', () => {
    const { project, map } = setup()
    const origin = makeRoom(project, map, rect(0, 0, 2, 1))
    makeRoom(project, map, rect(2, 0, 2, 1))

    const drag = tx(map)
    // The stroke crosses one cell of the neighbour; B9 makes all of it join.
    paintCells(drag, project, map, ['2,0'], { areaId: WORLD_AREA_ID, intoRoomId: origin.id })
    drag.commit()

    expect(map.rooms.size).toBe(1)
    expect(sorted(origin.cells)).toEqual(['0,0', '1,0', '2,0', '3,0'])
    expect(checkInvariants(project)).toEqual([])
  })

  it('rolls back exactly when the split fires mid-ghost', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 2, 2))
    const before = snapshot(project)

    const drag = tx(map)
    paintCells(drag, project, map, ['9,9', '9,7'], { areaId: WORLD_AREA_ID })
    drag.reset()

    expect(snapshot(project)).toEqual(before)
    drag.rollback()
    expect(snapshot(project)).toEqual(before)
  })
})

describe('a ride must not drive two teleports onto one cell', () => {
  // Round 1 fixed "enforce one-teleport-per-cell at both ends" in
  // `createTeleport` and nowhere else. The cascade relocates endpoints with no
  // such check, so an ordinary one-cell room drag silently de-indexed one of
  // them: it left the far-end index, survived deletion of the rooms it pointed
  // at, and was dropped on the next load.
  function twoTeleportsLandingSideBySide() {
    const { project, map: m1 } = setup()
    const seed = tx()
    const m2 = addMap(seed, project, 'Map 2')
    seed.commit()

    const paint = tx()
    paintCells(paint, project, m1, ['0,0'], { areaId: WORLD_AREA_ID })
    paintCells(paint, project, m1, ['0,2'], { areaId: WORLD_AREA_ID })
    paintCells(paint, project, m2, ['5,5'], { areaId: WORLD_AREA_ID })
    const mover = paintCells(paint, project, m2, ['6,5'], { areaId: WORLD_AREA_ID })
    paint.commit()

    const link = tx()
    const first = ok(
      createTeleport(link, project, { mapId: m1.id, cell: '0,0' }, { mapId: m2.id, cell: '5,5' }),
    )
    const second = ok(
      createTeleport(link, project, { mapId: m1.id, cell: '0,2' }, { mapId: m2.id, cell: '6,5' }),
    )
    link.commit()
    expect(farEndCount(project.teleportFarEnds)).toBe(2)

    return { project, m1, m2, mover, first, second }
  }

  it('keeps the model consistent when a moved room carries an endpoint onto another', () => {
    const { project, m2, mover } = twoTeleportsLandingSideBySide()

    const drag = tx(m2)
    moveRooms(drag, project, m2, [mover.id], -1, 0)
    drag.commit()

    expect(checkInvariants(project)).toEqual([])
    // C6: the cell cannot hold both, so exactly one teleport survives there.
    expect(farEndCount(project.teleportFarEnds)).toBe(1)
  })

  it('lets the rider win, per B8.2 incoming-wins', () => {
    const { project, m1, m2, mover, first, second } = twoTeleportsLandingSideBySide()

    const drag = tx(m2)
    moveRooms(drag, project, m2, [mover.id], -1, 0)
    drag.commit()

    expect(m1.transitions.has(second.id)).toBe(true)
    expect(m1.transitions.has(first.id)).toBe(false)
    expect(getFarEnd(project.teleportFarEnds, m2.id, '5,5')?.transitionId).toBe(second.id)
  })

  it('rolls back exactly, restoring the displaced teleport', () => {
    const { project, m2, mover } = twoTeleportsLandingSideBySide()
    const before = snapshot(project)

    const drag = tx(m2)
    moveRooms(drag, project, m2, [mover.id], -1, 0)
    drag.reset()
    expect(snapshot(project)).toEqual(before)

    moveRooms(drag, project, m2, [mover.id], -1, 0)
    drag.rollback()
    expect(snapshot(project)).toEqual(before)
  })

  it('does not displace a teleport that is itself riding out of the way', () => {
    // Both endpoints sit in the same moving room and shift together, so the
    // trailing one lands where the leading one just left. Neither may be
    // deleted; a naive "is anything already here?" check would kill one.
    const { project, map: m1 } = setup()
    const seed = tx()
    const m2 = addMap(seed, project, 'Map 2')
    seed.commit()

    const paint = tx()
    paintCells(paint, project, m1, ['0,0'], { areaId: WORLD_AREA_ID })
    paintCells(paint, project, m1, ['0,2'], { areaId: WORLD_AREA_ID })
    const strip = paintCells(paint, project, m2, ['5,5', '6,5'], { areaId: WORLD_AREA_ID })
    paint.commit()

    const link = tx()
    ok(createTeleport(link, project, { mapId: m1.id, cell: '0,0' }, { mapId: m2.id, cell: '5,5' }))
    ok(createTeleport(link, project, { mapId: m1.id, cell: '0,2' }, { mapId: m2.id, cell: '6,5' }))
    link.commit()

    const drag = tx(m2)
    moveRooms(drag, project, m2, [strip.id], -1, 0)
    drag.commit()

    expect(checkInvariants(project)).toEqual([])
    expect(farEndCount(project.teleportFarEnds)).toBe(2)
  })
})

describe('the same-map form of the collision', () => {
  // Worse-hidden than the cross-tab case: there is no far-end entry to lose,
  // so before the checker learned to count teleports per cell this left two
  // ids in `transitionsAtCell` and reported entirely clean.
  it('keeps one teleport per cell when a same-map endpoint rides onto another', () => {
    const { project, map } = setup()

    const paint = tx(map)
    paintCells(paint, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
    paintCells(paint, project, map, ['0,3'], { areaId: WORLD_AREA_ID })
    paintCells(paint, project, map, ['5,5'], { areaId: WORLD_AREA_ID })
    const mover = paintCells(paint, project, map, ['6,5'], { areaId: WORLD_AREA_ID })
    paint.commit()

    const link = tx(map)
    ok(
      createTeleport(link, project, { mapId: map.id, cell: '0,0' }, { mapId: map.id, cell: '5,5' }),
    )
    ok(
      createTeleport(link, project, { mapId: map.id, cell: '0,3' }, { mapId: map.id, cell: '6,5' }),
    )
    link.commit()

    const drag = tx(map)
    moveRooms(drag, project, map, [mover.id], -1, 0)
    drag.commit()

    expect(checkInvariants(project)).toEqual([])
    const atCell = [...(map.transitionsAtCell.get('5,5') ?? [])].filter(
      (id) => map.transitions.get(id)?.kind === 'teleport',
    )
    expect(atCell).toHaveLength(1)
  })
})

describe('inner walls must rotate and mirror with the room', () => {
  // Inner walls rotate and mirror with the room. The old `mapEdge` translated
  // the edge by a delta, which only holds when both cells move together: true
  // for translation, false for rotation, true on one axis under mirror. A
  // rotate used to drop every wall and a flip half of them, silently.
  function roomWithACrossOfWalls() {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 3))
    const draw = tx(map)
    ok(drawInnerWall(draw, map, room.id, edgeOfCell('1,1', 'N'), 'dotted'))
    ok(drawInnerWall(draw, map, room.id, edgeOfCell('1,1', 'W'), 'solid'))
    draw.commit()
    expect(room.innerWalls.size).toBe(2)
    return { project, map, room }
  }

  it('keeps both walls through a rotate, swapping their axes', () => {
    const { project, map, room } = roomWithACrossOfWalls()

    const turn = tx(map)
    transformRooms(turn, project, map, [room.id], 'rotateRight')
    turn.commit()

    expect(room.innerWalls.size).toBe(2)
    // A horizontal wall becomes vertical and vice versa: the axes swap.
    const axes = sorted([...room.innerWalls.keys()].map((edge) => edge.slice(-1)))
    expect(axes).toEqual(['H', 'V'])
    expect(checkInvariants(project)).toEqual([])
  })

  it('keeps both walls through either mirror', () => {
    for (const transform of ['flipH', 'flipV'] as const) {
      const { project, map, room } = roomWithACrossOfWalls()
      const flip = tx(map)
      transformRooms(flip, project, map, [room.id], transform)
      flip.commit()

      expect(room.innerWalls.size, `${transform} dropped a wall`).toBe(2)
      expect(checkInvariants(project)).toEqual([])
    }
  })

  it('preserves each wall style, not just the count', () => {
    const { project, map, room } = roomWithACrossOfWalls()

    const turn = tx(map)
    transformRooms(turn, project, map, [room.id], 'rotateLeft')
    turn.commit()

    expect(sorted([...room.innerWalls.values()])).toEqual(['dotted', 'solid'])
  })

  it('still carries walls through a plain translation', () => {
    const { project, map, room } = roomWithACrossOfWalls()

    const drag = tx(map)
    moveRooms(drag, project, map, [room.id], 4, 4)
    drag.commit()

    expect(sorted([...room.innerWalls.keys()])).toEqual(['5,5,H', '5,5,V'])
    expect(checkInvariants(project)).toEqual([])
  })

  it('rolls a rotate back exactly, walls included', () => {
    const { project, map, room } = roomWithACrossOfWalls()
    const before = snapshot(project)

    const turn = tx(map)
    transformRooms(turn, project, map, [room.id], 'rotateRight')
    turn.rollback()

    expect(snapshot(project)).toEqual(before)
  })
})

describe('setDirection B->A on a cross-tab teleport', () => {
  // Direction is encoded as endpoint order, so B->A swaps the ends, which for
  // a cross-tab teleport swaps which map is the origin. A teleport is stored
  // once under its origin map, so a swap must re-file it to its new origin.
  function crossTabTeleport() {
    const { project, map: m1 } = setup()
    const seed = tx()
    const m2 = addMap(seed, project, 'Map 2')
    seed.commit()

    const paint = tx()
    paintCells(paint, project, m1, ['0,0'], { areaId: WORLD_AREA_ID })
    const far = paintCells(paint, project, m2, ['5,5'], { areaId: WORLD_AREA_ID })
    paint.commit()

    const link = tx()
    const teleport = ok(
      createTeleport(link, project, { mapId: m1.id, cell: '0,0' }, { mapId: m2.id, cell: '5,5' }),
    )
    link.commit()
    return { project, m1, m2, far, teleport }
  }

  it('re-homes the teleport onto its new origin map', () => {
    const { project, m1, m2, teleport } = crossTabTeleport()

    const flip = tx(m1)
    setDirection(flip, project, m1, teleport.id, 'bToA')
    flip.commit()

    expect(checkInvariants(project)).toEqual([])
    // Stored once, under whichever map now holds endpoint A.
    expect(m2.transitions.has(teleport.id)).toBe(true)
    expect(m1.transitions.has(teleport.id)).toBe(false)
    // ...and the far end now points back at the original origin.
    expect(getFarEnd(project.teleportFarEnds, m1.id, '0,0')?.transitionId).toBe(teleport.id)
    expect(farEndCount(project.teleportFarEnds)).toBe(1)
  })

  it('leaves the cascade able to reach it: it dies with the rooms it points at', () => {
    const { project, m1, m2, far, teleport } = crossTabTeleport()

    const flip = tx(m1)
    setDirection(flip, project, m1, teleport.id, 'bToA')
    flip.commit()

    // Deleting the room the (now) origin end sits on must take the teleport
    // with it. Before the fix it survived, pointing at nothing.
    const wipe = tx(m2)
    deleteRooms(wipe, project, m2, [far.id])
    wipe.commit()

    expect(m2.transitions.has(teleport.id)).toBe(false)
    expect(checkInvariants(project)).toEqual([])
  })

  it('rolls back exactly, putting it back on the original map', () => {
    const { project, m1, teleport } = crossTabTeleport()
    const before = snapshot(project)

    const flip = tx(m1)
    setDirection(flip, project, m1, teleport.id, 'bToA')
    flip.rollback()

    expect(snapshot(project)).toEqual(before)
  })

  it('still swaps a same-map teleport in place', () => {
    const { project, map } = setup()
    const paint = tx(map)
    paintCells(paint, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
    paintCells(paint, project, map, ['3,0'], { areaId: WORLD_AREA_ID })
    paint.commit()

    const link = tx(map)
    const teleport = ok(
      createTeleport(link, project, { mapId: map.id, cell: '0,0' }, { mapId: map.id, cell: '3,0' }),
    )
    link.commit()

    const flip = tx(map)
    setDirection(flip, project, map, teleport.id, 'bToA')
    flip.commit()

    const swapped = map.transitions.get(teleport.id)!
    expect(swapped.kind === 'teleport' && swapped.a.cell).toBe('3,0')
    expect(swapped.oneWay).toBe(true)
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('rotation must not drift the room across its neighbours', () => {
  it('leaves a neighbouring room alone across four turns', () => {
    const { project, map } = setup()
    const spinner = makeRoom(project, map, rect(0, 0, 3, 2))
    // Placed clear of the rotation footprint (x 0..2, y 0..2) where a
    // destructive rotate is entitled to eat cells.
    const bystander = makeRoom(project, map, rect(-2, 2, 2, 2))
    const bystanderCells = sorted(bystander.cells)

    for (let i = 0; i < 4; i++) {
      const turn = tx(map)
      transformRooms(turn, project, map, [spinner.id], 'rotateRight')
      turn.commit()
    }

    expect(sorted(spinner.cells)).toEqual(sorted(rect(0, 0, 3, 2)))
    expect(sorted(bystander.cells)).toEqual(bystanderCells)
    expect(map.rooms.size).toBe(2)
    expect(checkInvariants(project)).toEqual([])
  })

  it('still cancels a turn with its opposite, which was the original guarantee', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 2))
    const before = sorted(room.cells)

    const turn = tx(map)
    transformRooms(turn, project, map, [room.id], 'rotateRight')
    transformRooms(turn, project, map, [room.id], 'rotateLeft')
    turn.commit()

    expect(sorted(room.cells)).toEqual(before)
  })
})

describe('a split must assign the same identity every re-apply', () => {
  // Group order decides the Hierarchy positions where split-off rooms are
  // inserted. This order must be stable across re-apply so the keeper stays in
  // the same position and split-off rooms stay ordered the same way.
  function hierarchyShape(map: MapModel): string[] {
    return map.roomOrder.map((id) => sorted(map.rooms.get(id)!.cells).join('|'))
  }

  it('gives the split-off rooms a stable Hierarchy order across re-apply', () => {
    const { project, map } = setup()
    // A plus: erasing the centre leaves four separate arms.
    makeRoom(project, map, ['0,0', '0,-1', '0,1', '-1,0', '1,0'])

    const drag = tx(map)
    eraseCells(drag, project, map, ['0,0'])
    const first = hierarchyShape(map)
    expect(map.rooms.size).toBe(4)

    drag.reset()
    eraseCells(drag, project, map, ['0,0'])

    expect(hierarchyShape(map)).toEqual(first)
  })

  it('holds it across many pointer moves, so the commit does not depend on the drag', () => {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0', '0,-1', '0,1', '-1,0', '1,0'])

    const drag = tx(map)
    eraseCells(drag, project, map, ['0,0'])
    const expected = hierarchyShape(map)

    for (let move = 0; move < 25; move++) {
      drag.reset()
      // A wandering pointer: a different erase, then back to the real one.
      eraseCells(drag, project, map, ['1,0'])
      drag.reset()
      eraseCells(drag, project, map, ['0,0'])
      expect(hierarchyShape(map), `diverged on move ${move}`).toEqual(expected)
    }
    drag.commit()
    expect(checkInvariants(project)).toEqual([])
  })

  it('orders groups by content, so the keeper is the top-left-most group', () => {
    // Origin-independent: no (0,0) to measure from on an unbounded grid.
    const groups = connectedComponents(['5,5', '9,1', '0,3'])
    expect([...groups[0]]).toEqual(['9,1'])
    expect([...groups[1]]).toEqual(['0,3'])
    expect([...groups[2]]).toEqual(['5,5'])
  })
})

describe('objects created inside a re-applied op keep their ids', () => {
  // `PaintOptions.newRoomId` fixed this for one case by hand; every other
  // creation inside a gesture still minted fresh ids per pointer move, so a
  // selection or an inspector binding dangled after a single frame. Ids now
  // come from the transaction, which is the thing `reset()` rewinds.
  it('a split-off room keeps its id, and which group keeps it is deterministic', () => {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0', '0,-1', '0,1', '-1,0', '1,0'])

    const drag = tx(map)
    eraseCells(drag, project, map, ['0,0'])
    const first = sorted(map.rooms.keys())

    for (let move = 0; move < 10; move++) {
      drag.reset()
      eraseCells(drag, project, map, ['1,0'])
      drag.reset()
      eraseCells(drag, project, map, ['0,0'])
      expect(sorted(map.rooms.keys()), `diverged on move ${move}`).toEqual(first)
    }
    drag.commit()
    expect(checkInvariants(project)).toEqual([])
  })

  it('a door from a box drag keeps its id', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 1, 3))
    makeRoom(project, map, rect(1, 0, 1, 3))

    const drag = tx(map)
    const id = ok(createFromBox(drag, project, map, '0,0', '1,0'))[0].id

    // The pointer sweeps down the seam and back.
    drag.reset()
    ok(createFromBox(drag, project, map, '0,0', '1,2'))
    drag.reset()
    const again = ok(createFromBox(drag, project, map, '0,0', '1,0'))[0]

    expect(again.id).toBe(id)
    drag.commit()
    expect(map.transitions.has(id)).toBe(true)
    expect(checkInvariants(project)).toEqual([])
  })

  it('a fragment move keeps the new room’s id', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 3, 1))

    const drag = tx(map)
    moveCellFragment(drag, project, map, ['0,0'], 0, 5)
    const first = sorted(map.rooms.keys())

    drag.reset()
    moveCellFragment(drag, project, map, ['0,0'], 0, 7)
    drag.reset()
    moveCellFragment(drag, project, map, ['0,0'], 0, 5)

    expect(sorted(map.rooms.keys())).toEqual(first)
    expect(checkInvariants(project)).toEqual([])
  })

  it('mints genuinely new ids when a re-apply creates more than before', () => {
    // The pool is positional, so a longer run must extend it rather than
    // recycle an id that is already in use.
    const { project, map } = setup()
    makeRoom(project, map, ['0,0', '0,-1', '0,1', '-1,0', '1,0'])

    const drag = tx(map)
    eraseCells(drag, project, map, ['0,1'])
    const fewer = map.rooms.size

    drag.reset()
    eraseCells(drag, project, map, ['0,0'])
    expect(map.rooms.size).toBeGreaterThan(fewer)
    expect(new Set(map.rooms.keys()).size).toBe(map.rooms.size)
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('a stale room id is a bug, not a no-op', () => {
  // The return convention says a bad id throws so a stale selection surfaces
  // as a stack trace where it happened. The convention sweep left the room ops
  // on the old silent behaviour, and `paintCells` was the worst of them: a
  // stale `intoRoomId` quietly started a *new room*, and since the ghost
  // re-applies on every pointer move, a grow stroke became a new room per
  // frame while handing the gesture layer a plausible-looking Room back.
  function deadRoomId(project: ReturnType<typeof setup>['project'], map: MapModel) {
    const room = makeRoom(project, map, ['9,9'])
    const kill = tx(map)
    deleteRooms(kill, project, map, [room.id])
    kill.commit()
    return room.id
  }

  it('paintCells throws rather than silently starting a new room', () => {
    const { project, map } = setup()
    const stale = deadRoomId(project, map)

    const drag = tx(map)
    expect(() =>
      paintCells(drag, project, map, ['0,0'], { areaId: WORLD_AREA_ID, intoRoomId: stale }),
    ).toThrow(/no room with id/)
  })

  it('still treats an absent intoRoomId as "start a new room"', () => {
    // The empty-cell case, which is explicit rather than a stale id.
    const { project, map } = setup()
    const drag = tx(map)
    const room = paintCells(drag, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
    expect(room.cells.size).toBe(1)
  })

  it('resizeRun, moveRooms, transformRooms and deleteRooms all throw', () => {
    const { project, map } = setup()
    const live = makeRoom(project, map, rect(0, 0, 2, 2))
    const stale = deadRoomId(project, map)
    const run = resizableRuns(live).find((candidate) => candidate.side === 'N')!

    const drag = tx(map)
    expect(() => resizeRun(drag, project, map, stale, run, 1)).toThrow(/no room with id/)
    expect(() => moveRooms(drag, project, map, [stale], 1, 0)).toThrow(/no room with id/)
    expect(() => transformRooms(drag, project, map, [stale], 'rotateRight')).toThrow(
      /no room with id/,
    )
    expect(() => deleteRooms(drag, project, map, [stale])).toThrow(/no room with id/)
  })

  it('isAdjacentToRoom stays tolerant: a predicate may be asked anything', () => {
    const { project, map } = setup()
    const stale = deadRoomId(project, map)
    expect(isAdjacentToRoom(map, stale, '0,0')).toBe(false)
  })
})

describe('move, merge and resize now agree on destination icons', () => {
  // Destruction by replacement: a carried icon overwrites the destination, but
  // an empty-handed move has no licence to clear an icon it doesn't replace.

  // Two rooms side by side, the right-hand one holding an icon at '1,0'. Each
  // op below takes that cell for the left-hand room; the icon must survive all
  // three and simply change owner.
  function neighbours() {
    const { project, map } = setup()
    const left = makeRoom(project, map, rect(0, 0, 1, 2))
    const right = makeRoom(project, map, rect(1, 0, 1, 2))
    const place = tx(map)
    const icon = ok(placeIcon(place, map, '1,0', 'save'))
    place.commit()
    return { project, map, left, right, icon }
  }

  it('a move onto an icon leaves it standing', () => {
    const { project, map, left, icon } = neighbours()

    const drag = tx(map)
    moveRooms(drag, project, map, [left.id], 1, 0)
    drag.commit()

    expect(map.icons.has(icon.id)).toBe(true)
    expect(icon.cell).toBe('1,0')
    expect(map.cellOwner.get('1,0')).toBe(left.id)
    expect(checkInvariants(project)).toEqual([])
  })

  it('a paint-merge over an icon leaves it standing', () => {
    const { project, map, left, icon } = neighbours()

    const stroke = tx(map)
    paintCells(stroke, project, map, ['1,0'], { areaId: WORLD_AREA_ID, intoRoomId: left.id })
    stroke.commit()

    expect(map.icons.has(icon.id)).toBe(true)
    expect(map.cellOwner.get('1,0')).toBe(left.id)
    expect(checkInvariants(project)).toEqual([])
  })

  it('a resize-expand over an icon leaves it standing', () => {
    const { project, map, left, icon } = neighbours()
    const run = resizableRuns(left).find((candidate) => candidate.side === 'E')!

    const drag = tx(map)
    resizeRun(drag, project, map, left.id, run, 1)
    drag.commit()

    expect(map.icons.has(icon.id)).toBe(true)
    expect(map.cellOwner.get('1,0')).toBe(left.id)
    expect(checkInvariants(project)).toEqual([])
  })

  it('a rotation spares the icons it lands on', () => {
    // The same rule has to hold for the transform path, which shares
    // `relocateRooms` but reaches it with a non-translation mapping.
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 1))
    const bystander = makeRoom(project, map, ['1,1'])
    const place = tx(map)
    const icon = ok(placeIcon(place, map, '1,1', 'save'))
    place.commit()

    const drag = tx(map)
    transformRooms(drag, project, map, [room.id], 'rotateRight')
    drag.commit()

    // The 3x1 strip becomes a 1x3 column through '1,1', taking the cell.
    expect(map.cellOwner.get('1,1')).toBe(room.id)
    expect(map.rooms.has(bystander.id)).toBe(false)
    expect(map.icons.has(icon.id)).toBe(true)
    expect(icon.cell).toBe('1,1')
    expect(checkInvariants(project)).toEqual([])
  })

  it('a carried icon still replaces the one it lands on', () => {
    // The destruction B8.2 does authorise, and the reason one-per-cell holds.
    const { project, map, left, right, icon } = neighbours()
    const place = tx(map)
    const carried = ok(placeIcon(place, map, '0,0', 'star'))
    place.commit()

    const drag = tx(map)
    moveRooms(drag, project, map, [left.id], 1, 0)
    drag.commit()

    expect(map.icons.has(icon.id)).toBe(false)
    expect(map.iconAtCell.get('1,0')).toBe(carried.id)
    expect(carried.cell).toBe('1,0')
    expect(map.rooms.has(right.id)).toBe(false)
    expect(checkInvariants(project)).toEqual([])
  })

  it('undo puts a replaced icon back', () => {
    const { project, map, left, icon } = neighbours()
    const place = tx(map)
    ok(placeIcon(place, map, '0,0', 'star'))
    place.commit()
    const before = snapshot(project)

    const drag = tx(map)
    moveRooms(drag, project, map, [left.id], 1, 0)
    drag.replayUndo()

    expect(map.icons.has(icon.id)).toBe(true)
    expect(map.iconAtCell.get('1,0')).toBe(icon.id)
    expect(snapshot(project)).toEqual(before)
  })
})

describe('a teleport endpoint on bare grid is not "same-room"', () => {
  // Each refusal reason maps to one translated message, so the reasons must be
  // distinct. `not-in-a-room` and `same-room` cannot both apply to the same
  // condition.
  function oneRoomMap() {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 1))
    return { project, map, room }
  }

  it('reports not-in-a-room when the destination is empty grid', () => {
    const { project, map } = oneRoomMap()
    const link = tx(map)
    expect(
      refusal(
        createTeleport(
          link,
          project,
          { mapId: map.id, cell: '0,0' },
          { mapId: map.id, cell: '9,9' },
        ),
      ),
    ).toBe('not-in-a-room')
  })

  it('reports not-in-a-room when the origin is empty grid', () => {
    const { project, map } = oneRoomMap()
    const link = tx(map)
    expect(
      refusal(
        createTeleport(
          link,
          project,
          { mapId: map.id, cell: '9,9' },
          { mapId: map.id, cell: '0,0' },
        ),
      ),
    ).toBe('not-in-a-room')
  })

  it('still reports same-room when both ends really are in one room', () => {
    const { project, map } = oneRoomMap()
    const link = tx(map)
    expect(
      refusal(
        createTeleport(
          link,
          project,
          { mapId: map.id, cell: '0,0' },
          { mapId: map.id, cell: '1,0' },
        ),
      ),
    ).toBe('same-room')
  })

  it('the gesture-layer predicate still refuses both, so a misclick stays pending', () => {
    // The split is about the *message*, not about which clicks are accepted.
    const { project, map } = oneRoomMap()
    const onGrid = { mapId: map.id, cell: '9,9' as const }
    const inRoom = { mapId: map.id, cell: '0,0' as const }
    const sameRoom = { mapId: map.id, cell: '1,0' as const }

    expect(canCompleteTeleport(project, inRoom, onGrid)).toBe(false)
    expect(canCompleteTeleport(project, inRoom, sameRoom)).toBe(false)
  })

  it('two cells in different rooms of the same map are still allowed', () => {
    const { project, map } = oneRoomMap()
    makeRoom(project, map, ['0,3'])
    const link = tx(map)
    const teleport = ok(
      createTeleport(link, project, { mapId: map.id, cell: '0,0' }, { mapId: map.id, cell: '0,3' }),
    )
    expect(teleport.kind).toBe('teleport')
    expect(checkInvariants(project)).toEqual([])
  })
})

// The load path. Every one of these is a silent fault: the file opens, the
// report says nothing was repaired, and the damage surfaces later or never
// because the next Save writes it back out as truth.
describe('splitting a room on load keeps every group’s inner walls', () => {
  // Build two walled rooms, then fuse them into one room entry in the JSON so
  // the loader has to split them apart again. Hand-writing vertex segments
  // would be its own source of error, so they come from a real project.
  function fusedRooms() {
    const { project, map } = setup()
    const left = makeRoom(project, map, ['0,0', '1,0'])
    const right = makeRoom(project, map, ['5,0', '6,0'])

    const walls = tx(map)
    ok(drawInnerWall(walls, map, left.id, edgeOfCell('1,0', 'W'), 'solid'))
    ok(drawInnerWall(walls, map, right.id, edgeOfCell('6,0', 'W'), 'solid'))
    walls.commit()

    const file = toJSON(project)
    const rooms = file.project.maps[0].rooms
    rooms[0].cells = [...rooms[0].cells, ...rooms[1].cells]
    rooms[0].innerWalls = [...(rooms[0].innerWalls ?? []), ...(rooms[1].innerWalls ?? [])]
    rooms.length = 1
    return file
  }

  it('gives every split group its walls, not just the one that kept the id', () => {
    const { project, report } = fromJSON(fusedRooms())
    const map = project.mapsById.get(project.maps[0])!

    expect(map.rooms.size).toBe(2)
    // The bug was order-dependent: the keep group was written first and
    // overwrote the source every later group filtered against, so the second
    // room came back with nothing.
    expect([...map.rooms.values()].map((room) => room.innerWalls.size)).toEqual([1, 1])
    expect(eventsOf(report, 'inner-wall-dropped')).toEqual([])
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('transitions follow their own map', () => {
  // Two maps, each with a door of its own.
  function twoMapsWithDoors() {
    const { project, map } = setup()
    const seed = tx()
    const second = addMap(seed, project, 'Map 2')
    seed.commit()

    for (const target of [map, second]) {
      makeRoom(project, target, ['0,0'])
      makeRoom(project, target, ['1,0'])
      const door = tx(target)
      ok(createFromBox(door, project, target, '0,0', '1,0'))
      door.commit()
    }
    return { project, file: toJSON(project) }
  }

  it('does not attach one map’s transitions to another when ids collide', () => {
    const { file } = twoMapsWithDoors()
    file.project.maps[1].id = file.project.maps[0].id

    const { project } = fromJSON(file)
    expect(project.maps).toHaveLength(2)
    expect(project.maps.map((id) => project.mapsById.get(id)!.transitions.size)).toEqual([1, 1])
    expect(checkInvariants(project)).toEqual([])
  })

  it('does not discard every transition on a map whose id was reissued', () => {
    const { file } = twoMapsWithDoors()
    // A blank id is reissued, so the old lookup missed entirely and the map
    // lost every door it had. The skip was `if (map)`, so nothing was counted:
    // `droppedTransitions` stayed 0 and the file opened looking clean.
    file.project.maps[0].id = ''

    const { project, report } = fromJSON(file)
    expect(project.maps.map((id) => project.mapsById.get(id)!.transitions.size)).toEqual([1, 1])
    expect(eventsOf(report, 'transition-dropped')).toEqual([])
    expect(eventsOf(report, 'id-remapped')).toHaveLength(1)
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('every discard is reported', () => {
  // The repair-then-confirm gate is only as strong as the report. These two
  // paths threw data away with no counter at all, so `needsConfirmation` said
  // false and the repaired project landed with no prompt.
  it('reports a line dropped for being too short', () => {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0'])
    const file = toJSON(project)
    file.project.maps[0].lines.push({ id: 'ln_stub', color: '#fff', points: [[0, 0]] })

    const pending = openProject(file)
    expect(eventsOf(pending.report, 'line-dropped')).toEqual([
      expect.objectContaining({ reason: 'too-short' }),
    ])
    expect(pending.requiresConfirmation).toBe(true)
  })

  it('reports a room dropped for having no cells', () => {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0'])
    const file = toJSON(project)
    file.project.maps[0].rooms.push({
      id: 'room_ghost',
      areaId: WORLD_AREA_ID,
      name: 'Somewhere',
      notes: 'had notes, had a name',
      cells: [],
    })

    const pending = openProject(file)
    expect(eventsOf(pending.report, 'room-dropped')).toEqual([
      expect.objectContaining({ room: 'Somewhere', reason: 'no-cells' }),
    ])
    expect(pending.requiresConfirmation).toBe(true)
  })
})

describe('a damaged project is refused, not silently emptied', () => {
  // `typeof [] === 'object'`, so an array passed the project check, every field
  // read as undefined, and the file opened as a *clean* blank project. The user
  // is told it worked and the next Save destroys what was left.
  function fileWithProject(project: unknown): unknown {
    return { format: FILE_FORMAT, version: FILE_VERSION, project }
  }

  it('refuses an array where the project should be', () => {
    expect(() => fromJSON(fileWithProject([]))).toThrow(InvalidFileError)
    expect(() => fromJSON(fileWithProject([1, 2, 3]))).toThrow(InvalidFileError)
  })

  it('refuses a project with no maps at all', () => {
    // A project must have at least one map.
    expect(() => fromJSON(fileWithProject({}))).toThrow(InvalidFileError)
    expect(() => fromJSON(fileWithProject({ name: 'x', maps: [] }))).toThrow(InvalidFileError)
  })

  it('does not choke on a list that is not a list', () => {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0'])
    const file = toJSON(project) as unknown as { project: { maps: { icons: unknown }[] } }
    file.project.maps[0].icons = { nope: true }
    // A bare TypeError out of the loader is not a load failure the UI can
    // explain, and this loader's whole job is surviving damaged files.
    expect(() => fromJSON(file)).not.toThrow()
  })
})

// The load path's second pass: shape damage, and the repairs that were being
// made silently.
describe('shape damage is repaired, not thrown', () => {
  // The module header promises a forgiving loader, but forgiveness was only
  // implemented for *semantic* damage. One null in one array reached a raw
  // TypeError, so the file was simply unopenable and the UI had nothing typed
  // to catch.
  function twoRoomFile() {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0'])
    makeRoom(project, map, ['1,0'])
    return toJSON(project) as unknown as { project: { maps: Record<string, unknown>[] } }
  }

  const damage: [string, (file: { project: { maps: Record<string, unknown>[] } }) => void][] = [
    ['rooms is an object', (f) => (f.project.maps[0].rooms = { nope: 1 })],
    ['a null room', (f) => (f.project.maps[0].rooms as unknown[]).push(null)],
    [
      'a null cell',
      (f) => ((f.project.maps[0].rooms as { cells: unknown[] }[])[0].cells = [[0, 0], null]),
    ],
    [
      'a cell that is not numbers',
      (f) => ((f.project.maps[0].rooms as { cells: unknown[] }[])[0].cells = [['a', 'b']]),
    ],
    ['an icon with no cell', (f) => (f.project.maps[0].icons as unknown[]).push({ id: 'ic_x' })],
    [
      'a malformed inner wall',
      (f) => ((f.project.maps[0].rooms as { innerWalls: unknown }[])[0].innerWalls = [{ seg: 3 }]),
    ],
    [
      'a transition with null geometry',
      (f) =>
        (f.project.maps[0].transitions as unknown[]).push({
          id: 'tr_x',
          type: 'edge',
          locks: { a: 'open', b: 'open' },
          geometry: null,
        }),
    ],
    [
      'segments that are not an array',
      (f) =>
        (f.project.maps[0].transitions as unknown[]).push({
          id: 'tr_y',
          type: 'edge',
          locks: { a: 'open', b: 'open' },
          geometry: { segments: 'no' },
        }),
    ],
    ['a null line', (f) => (f.project.maps[0].lines as unknown[]).push(null)],
  ]

  for (const [name, corrupt] of damage) {
    it(`survives ${name}`, () => {
      const file = twoRoomFile()
      corrupt(file)
      expect(() => fromJSON(file)).not.toThrow()
      // And the project it produces is still a legal one.
      const { project } = fromJSON(file)
      expect(checkInvariants(project)).toEqual([])
    })
  }

  it('does not let a non-numeric cell become a real cell key', () => {
    const file = twoRoomFile()
    ;(file.project.maps[0].rooms as { cells: unknown[] }[])[0].cells = [['a', 'b']]

    const { project, report } = fromJSON(file as unknown as JsonFile)
    const map = project.mapsById.get(project.maps[0])!
    // This one never threw, which is why it is the worst of the set:
    // `cellKey('a', 'b')` produces the perfectly usable key "a,b", which then
    // owns a cell, indexes transitions and round-trips for ever.
    expect([...map.cellOwner.keys()]).not.toContain('a,b')
    expect(eventsOf(report, 'cell-dropped')).toEqual([
      expect.objectContaining({ reason: 'malformed' }),
    ])
  })

  it('reports the damage rather than swallowing it', () => {
    const file = twoRoomFile()
    ;(file.project.maps[0].rooms as { cells: unknown[] }[])[0].cells = [[0, 0], null]
    const { report } = fromJSON(file as unknown as JsonFile)
    expect(eventsOf(report, 'cell-dropped')).toEqual([
      expect.objectContaining({ cell: null, reason: 'malformed' }),
    ])
  })
})

describe('an edge door loads under the same two rules an edit enforces', () => {
  // A three-segment door between two 1x3 rooms.
  function doorFile() {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0', '0,1', '0,2'])
    makeRoom(project, map, ['1,0', '1,1', '1,2'])
    const door = tx(map)
    ok(createFromBox(door, project, map, '0,0', '1,2'))
    door.commit()
    expect([...map.transitions.values()][0]).toMatchObject({ kind: 'edge' })
    return toJSON(project)
  }

  function dropCell(file: ReturnType<typeof toJSON>, cell: [number, number]) {
    const rooms = file.project.maps[0].rooms
    for (const room of rooms) {
      room.cells = room.cells.filter(([x, y]) => x !== cell[0] || y !== cell[1])
    }
  }

  it('drops segments that no longer separate two rooms', () => {
    const file = doorFile()
    dropCell(file, [1, 2])

    const { project, report } = fromJSON(file)
    const map = project.mapsById.get(project.maps[0])!
    const door = [...map.transitions.values()][0]

    expect(door.kind === 'edge' && door.segments).toHaveLength(2)
    expect(eventsOf(report, 'door-trimmed')).toEqual([
      expect.objectContaining({ droppedSegments: 1, splitInto: 1 }),
    ])
    expect(checkInvariants(project)).toEqual([])
  })

  it('splits a door whose segments are no longer contiguous', () => {
    const file = doorFile()
    dropCell(file, [1, 1])

    const { project, report } = fromJSON(file)
    const map = project.mapsById.get(project.maps[0])!

    // An edit could never have produced one door spanning two disjoint runs.
    expect(map.transitions.size).toBe(2)
    expect(eventsOf(report, 'door-trimmed')).toEqual([
      expect.objectContaining({ droppedSegments: 1, splitInto: 2 }),
    ])
    expect(checkInvariants(project)).toEqual([])
  })

  it('leaves an intact door alone', () => {
    const { project, report } = fromJSON(doorFile())
    const map = project.mapsById.get(project.maps[0])!
    expect(map.transitions.size).toBe(1)
    expect(report.events).toEqual([])
  })
})

describe('a teleport must be stored under a map that owns an end', () => {
  it('drops one filed under a map owning neither endpoint', () => {
    const { project, map } = setup()
    const seed = tx()
    const second = addMap(seed, project, 'Map 2')
    const third = addMap(seed, project, 'Map 3')
    seed.commit()
    makeRoom(project, map, ['0,0'])
    makeRoom(project, second, ['0,0'])
    makeRoom(project, third, ['0,0'])

    const link = tx(map)
    ok(
      createTeleport(
        link,
        project,
        { mapId: map.id, cell: '0,0' },
        { mapId: second.id, cell: '0,0' },
      ),
    )
    link.commit()

    // File it under the one map that owns neither end.
    const file = toJSON(project)
    const orphan = file.project.maps[0].transitions.pop()!
    file.project.maps[2].transitions.push(orphan)

    const { project: loaded, report } = fromJSON(file)
    expect(eventsOf(report, 'transition-dropped')).toEqual([
      expect.objectContaining({ reason: 'not-its-map' }),
    ])
    for (const id of loaded.maps) expect(loaded.mapsById.get(id)!.transitions.size).toBe(0)
    expect(checkInvariants(loaded)).toEqual([])
  })
})

describe('settings are validated, not trusted', () => {
  it('resets values that cannot mean anything and says so', () => {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0'])
    const file = toJSON(project)
    file.project.settings = {
      tileSize: 'huge',
      gridInExports: 'no',
      backgroundColor: 42,
    } as unknown as typeof file.project.settings

    const { project: loaded, report } = fromJSON(file)
    // tileSize drives all canvas geometry; a string there is a blank editor.
    expect(loaded.settings.tileSize).toBeGreaterThan(0)
    expect(loaded.settings.gridInExports).toBe(true)
    expect(loaded.settings.backgroundColor).toBeNull()
    expect(
      eventsOf(report, 'setting-reset')
        .map((event) => event.setting)
        .sort(),
    ).toEqual(['backgroundColor', 'gridInExports', 'tileSize'])
  })

  it('rejects a tile size of zero as firmly as a string', () => {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0'])
    const file = toJSON(project)
    file.project.settings.tileSize = 0

    const { project: loaded, report } = fromJSON(file)
    expect(loaded.settings.tileSize).toBeGreaterThan(0)
    expect(eventsOf(report, 'setting-reset')).toHaveLength(1)
  })

  it('keeps settings that are fine', () => {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0'])
    const file = toJSON(project)
    file.project.settings.tileSize = 48
    file.project.settings.gridInExports = false

    const { project: loaded, report } = fromJSON(file)
    expect(loaded.settings.tileSize).toBe(48)
    expect(loaded.settings.gridInExports).toBe(false)
    expect(report.events).toEqual([])
  })
})

describe('the loader stops guessing load-bearing values', () => {
  it('reports the aSide it had to assume', () => {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0'])
    makeRoom(project, map, ['1,0'])
    const door = tx(map)
    ok(createFromBox(door, project, map, '0,0', '1,0'))
    door.commit()

    const file = toJSON(project)
    const geometry = file.project.maps[0].transitions[0].geometry as {
      segments: { aSide?: string }[]
    }
    delete geometry.segments[0].aSide

    const { report } = fromJSON(file)
    // `aSide` decides which room owns `locks.a`. A guess moves a lock between
    // rooms, so guesses are now reported rather than silent.
    expect(eventsOf(report, 'assumed-default')).toEqual([
      expect.objectContaining({ field: 'door aSide' }),
    ])
  })

  it('refuses a teleport endpoint that does not say which map it is on', () => {
    const { project, map } = setup()
    const seed = tx()
    const second = addMap(seed, project, 'Map 2')
    seed.commit()
    makeRoom(project, map, ['0,0'])
    makeRoom(project, second, ['0,0'])

    const link = tx(map)
    ok(
      createTeleport(
        link,
        project,
        { mapId: map.id, cell: '0,0' },
        { mapId: second.id, cell: '0,0' },
      ),
    )
    link.commit()

    const file = toJSON(project)
    const geometry = file.project.maps[0].transitions[0].geometry as {
      b: { mapId?: string }
    }
    delete geometry.b.mapId

    const { project: loaded, report } = fromJSON(file)
    // Assuming "local" turned a cross-tab teleport into a same-map one: the
    // link still existed, still looked fine, and now went somewhere else.
    // There is no honest default for "which map".
    expect(eventsOf(report, 'transition-dropped')).toEqual([
      expect.objectContaining({ reason: 'malformed' }),
    ])
    expect(loaded.mapsById.get(loaded.maps[0])!.transitions.size).toBe(0)
    expect(checkInvariants(loaded)).toEqual([])
  })
})

describe('pasting two whole rooms produces two rooms', () => {
  // Pasting copied rooms must produce new rooms, not merge touching rooms.
  // Paste applies connectivity to the flattened cells of every payload, which
  // used to merge rooms that happened to touch.
  function twoTouchingRooms() {
    const { project, map } = setup()
    const area = tx()
    const brinstar = createNewArea(area, project, 'Brinstar', '#2b6', '#efe')
    area.commit()

    const left = makeRoom(project, map, rect(0, 0, 2, 2))
    const right = makeRoom(project, map, rect(2, 0, 2, 2))
    const label = tx(map)
    ok(renameRoom(label, map, left.id, 'Landing Site'))
    ok(setRoomNotes(label, map, left.id, 'the ship'))
    ok(renameRoom(label, map, right.id, 'Parking Garage'))
    ok(setRoomNotes(label, map, right.id, 'the bikes'))
    assignRoomArea(label, map, right.id, brinstar.id)
    label.commit()

    return { project, map, left, right, brinstar }
  }

  it('keeps them apart, with their own names, notes and areas', () => {
    const { project, map, brinstar } = twoTouchingRooms()
    const payload = copyRooms(map, [...map.rooms.keys()])
    expect(payload.rooms).toHaveLength(2)

    const drop = tx(map)
    const { rooms } = paste(drop, project, map, payload, {
      at: { x: 10, y: 10 },
      nameFor: ({ name }) => name,
    })
    drop.commit()

    expect(rooms).toHaveLength(2)
    expect(sorted(rooms.map((room) => room.name))).toEqual(['Landing Site', 'Parking Garage'])
    expect(sorted(rooms.map((room) => room.notes))).toEqual(['the bikes', 'the ship'])
    // Areas are per-room, so fusing them silently recoloured half the paste.
    expect(rooms.find((room) => room.name === 'Parking Garage')!.areaId).toBe(brinstar.id)
    expect(rooms.every((room) => room.cells.size === 4)).toBe(true)
    expect(checkInvariants(project)).toEqual([])
  })

  it('still flood-fills a cell fragment, which carries no identity', () => {
    // The connectivity rule is the answer for fragments, which carry no room
    // identity of their own. It must stay for this case.
    const { project, map } = twoTouchingRooms()
    const payload = copyCells(map, rect(0, 0, 4, 2))
    expect(payload.fromRooms).toBe(false)

    const drop = tx(map)
    const { rooms } = paste(drop, project, map, payload, { at: { x: 10, y: 10 } })
    drop.commit()

    expect(rooms).toHaveLength(1)
    expect(rooms[0].cells.size).toBe(8)
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('a cell drag moves cells, it does not create them', () => {
  it('ignores marquee cells that were never in a room', () => {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0'])

    const drag = tx(map)
    // A marquee is a rectangle over the grid, so it routinely covers empty
    // space. Taking that at face value materialised a 9-cell room out of one
    // painted cell and eight empty ones.
    const moved = moveCellFragment(drag, project, map, rect(0, 0, 3, 3), 0, 10)
    drag.commit()

    expect(moved).toHaveLength(1)
    expect(moved[0].cells.size).toBe(1)
    expect(map.cellOwner.get('0,10')).toBe(moved[0].id)
    expect(map.cellOwner.size).toBe(1)
    expect(checkInvariants(project)).toEqual([])
  })

  it('agrees with copyCells about which cells a marquee holds', () => {
    // Copy-then-paste and move of the same marquee must produce the same
    // geometry; disagreeing is the sharpest form of the bug.
    const { project, map } = setup()
    makeRoom(project, map, ['0,0', '1,0'])
    const marquee = rect(0, 0, 3, 3)

    const payload = copyCells(map, marquee)
    const drag = tx(map)
    const moved = moveCellFragment(drag, project, map, marquee, 0, 10)
    drag.commit()

    expect(moved.reduce((total, room) => total + room.cells.size, 0)).toBe(payload.cells.length)
  })
})

describe('one door never spans two room pairs', () => {
  it('re-splits when a resize changes the room on the far side', () => {
    const { project, map } = setup()
    const a = makeRoom(project, map, ['0,0', '0,1'])
    makeRoom(project, map, ['1,0', '1,1'])
    const d = makeRoom(project, map, ['2,1', '2,2'])

    const door = tx(map)
    ok(createFromBox(door, project, map, '0,0', '1,1'))
    door.commit()
    expect(map.transitions.size).toBe(1)

    // D takes cell 1,1 from B. When the far room changes, a door that spanned
    // two room pairs must re-split so each pair has its own door.
    const run = resizableRuns(d).find((candidate) => candidate.side === 'W')!
    const grow = tx(map)
    resizeRun(grow, project, map, d.id, run, 1)
    grow.commit()

    expect(map.cellOwner.get('1,1')).toBe(d.id)
    expect(map.transitions.size).toBe(2)

    // One door per room pair, exactly as a fresh box-drag would have made.
    const pairs = [...map.transitions.values()].map((transition) => {
      if (transition.kind !== 'edge') return ''
      const { lo, hi } = edgeCells(transition.segments[0].edge)
      return sorted([map.cellOwner.get(lo)!, map.cellOwner.get(hi)!]).join('|')
    })
    expect(new Set(pairs).size).toBe(2)
    expect(pairs.every((pair) => pair.includes(a.id))).toBe(true)
    expect(checkInvariants(project)).toEqual([])
  })

  it('leaves an untouched door alone, id and all', () => {
    const { project, map } = setup()
    makeRoom(project, map, ['0,0', '0,1'])
    makeRoom(project, map, ['1,0', '1,1'])
    makeRoom(project, map, ['5,5'])

    const door = tx(map)
    const [made] = ok(createFromBox(door, project, map, '0,0', '1,1'))
    door.commit()

    // An unrelated edit still runs the cascade over this door.
    const other = tx(map)
    paintCells(other, project, map, ['5,6'], { areaId: WORLD_AREA_ID, intoRoomId: undefined })
    other.commit()

    expect(map.transitions.size).toBe(1)
    expect(map.transitions.has(made.id)).toBe(true)
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('revisions say what actually changed', () => {
  it('a tab rename bumps structureRev, a notes edit does not', () => {
    const { project, map } = setup()
    const before = project.structureRev

    const rename = tx(map)
    renameMap(rename, project, map.id, 'Crateria')
    rename.commit()
    // The tab bar renders {id, name} per map, so it must re-render when the
    // name changes, not when unrelated edits touch the map.
    expect(project.structureRev).toBeGreaterThan(before)

    const after = project.structureRev
    const note = tx(map)
    setMapNotes(note, project, map.id, 'notes are content, not structure')
    note.commit()
    expect(project.structureRev).toBe(after)
  })

  it('renaming a room leaves its geometry revision alone', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 3))
    const geometry = room.rev
    const meta = room.metaRev

    const rename = tx(map)
    ok(renameRoom(rename, map, room.id, 'Landing Site'))
    rename.commit()

    // `derive/walls.ts` memoises on `room.rev`, so bumping it here threw away
    // the room's outer walls and edge runs on every keystroke of a rename.
    expect(room.rev).toBe(geometry)
    expect(room.metaRev).toBeGreaterThan(meta)
  })

  it('still bumps the geometry revision for an actual geometry change', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 2))
    const geometry = room.rev

    const grow = tx(map)
    paintCells(grow, project, map, ['2,0'], { areaId: WORLD_AREA_ID, intoRoomId: room.id })
    grow.commit()
    expect(room.rev).toBeGreaterThan(geometry)
  })
})

describe('an undo says what it touched', () => {
  it('names only the objects that step changed', () => {
    const { project, map, history } = setup()
    const first = history.begin('Paint', { kind: 'map', mapId: map.id })
    const kept = paintCells(first, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
    history.commit(first)

    const second = history.begin('Paint', { kind: 'map', mapId: map.id })
    const undone = paintCells(second, project, map, ['9,9'], { areaId: WORLD_AREA_ID })
    history.commit(second)

    const effect = history.undo()!
    // The information was always on the transaction; it just was not handed
    // over, so every undo looked like a full invalidation to the UI.
    expect(effect.touched.rooms.has(undone.id)).toBe(true)
    expect(effect.touched.rooms.has(kept.id)).toBe(false)
  })

  it('reports nothing touched for a tab switch', () => {
    const { project, map, history } = setup()
    const seed = history.begin('Add map', { kind: 'project' })
    const second = addMap(seed, project, 'Map 2')
    history.commit(seed)

    history.pushNavigation(map.id, second.id, TEST_NAV_LABEL)
    expect(isTouchSetEmpty(history.undo()!.touched)).toBe(true)
  })
})

describe('the lock-delete dialog counts transitions', () => {
  it('counts a symmetric door once, not once per end', () => {
    const { project, map } = setup()
    const create = tx()
    const missile = createNewLockType(create, project, 'Missile', '#e23b3b', '▲')
    create.commit()

    makeRoom(project, map, ['0,0'])
    makeRoom(project, map, ['1,0'])
    const door = tx(map)
    const [made] = ok(createFromBox(door, project, map, '0,0', '1,0'))
    door.commit()

    const lock = tx(map)
    setLock(lock, project, map, made.id, 'both', missile.id)
    lock.commit()

    // The panel defaults to synced locks, so a symmetric door is the common
    // case. A count must return 1 for one door, not 2 for its two ends.
    expect(transitionsUsingLockType(project, missile.id)).toBe(1)
  })
})

describe('a cross-tab teleport is editable from either tab', () => {
  function linkedMaps() {
    const { project, map } = setup()
    const seed = tx()
    const second = addMap(seed, project, 'Map 2')
    seed.commit()
    makeRoom(project, map, ['0,0'])
    makeRoom(project, second, ['5,5'])

    const link = tx(map)
    const teleport = ok(
      createTeleport(
        link,
        project,
        { mapId: map.id, cell: '0,0' },
        { mapId: second.id, cell: '5,5' },
      ),
    )
    link.commit()
    return { project, map, second, teleport }
  }

  it('sets a lock from the destination tab', () => {
    const { project, map, second, teleport } = linkedMaps()
    const create = tx()
    const missile = createNewLockType(create, project, 'Missile', '#e23b3b', '▲')
    create.commit()

    // The far-end marker on Map 2 is hit-testable and selectable, so this is
    // a normal user path. Setting a lock from the destination tab must work.
    const lock = tx(second)
    setLock(lock, project, second, teleport.id, 'both', missile.id)
    lock.commit()

    expect(map.transitions.get(teleport.id)!.locks).toEqual({ a: missile.id, b: missile.id })
    expect(checkInvariants(project)).toEqual([])
  })

  it('deletes from the destination tab, and the far end goes with it', () => {
    const { project, map, second, teleport } = linkedMaps()

    const remove = tx(second)
    deleteTransition(remove, project, second, teleport.id)
    remove.commit()

    expect(map.transitions.has(teleport.id)).toBe(false)
    expect(getFarEnd(project.teleportFarEnds, second.id, '5,5')).toBeUndefined()
    expect(checkInvariants(project)).toEqual([])
  })

  it('sets direction from the destination tab', () => {
    const { project, map, second, teleport } = linkedMaps()

    const flip = tx(second)
    setDirection(flip, project, second, teleport.id, 'aToB')
    flip.commit()

    expect(map.transitions.get(teleport.id)!.oneWay).toBe(true)
    expect(checkInvariants(project)).toEqual([])
  })

  it('still refuses an id that is on neither tab', () => {
    const { project, second } = linkedMaps()
    const bad = tx(second)
    expect(() => deleteTransition(bad, project, second, 'tr_nope' as never)).toThrow(
      /no transition/,
    )
  })
})
