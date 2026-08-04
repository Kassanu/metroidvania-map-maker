import { describe, it, expect } from 'vitest'
import { edgeOfCell } from '../cell'
import { getFarEnd } from '../farEnds'
import { OPEN_LOCK_ID } from '../ids'
import type { LockTypeId } from '../ids'
import { makeRoom, ok, refusal, rect, setup, tx } from '../testUtils'
import {
  classifyBox,
  createFromBox,
  createTeleport,
  canCompleteTeleport,
  setDirection,
} from './doors'
import { deleteRooms, eraseCells, moveRooms, paintCells } from './rooms'
import { addMap } from './maps'
import { WORLD_AREA_ID } from '../ids'

// Two rooms sharing a vertical boundary at x=1|2, three rows tall:
//   1 1 | 2 2
function twoRooms() {
  const context = setup()
  const a = makeRoom(context.project, context.map, rect(0, 0, 2, 3))
  const b = makeRoom(context.project, context.map, rect(2, 0, 2, 3))
  return { ...context, a, b }
}

describe('box classification', () => {
  it('reads a 1x2 box across a seam as a single-segment edge door', () => {
    const { map } = twoRooms()
    const result = classifyBox(map, '1,1', '2,1')
    expect(result.kind).toBe('edge')
    if (result.kind !== 'edge') return
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toHaveLength(1)
    expect(result.groups[0][0].edge).toBe(edgeOfCell('1,1', 'E'))
  })

  it('reads a 2xN box as one N-wide door along the shared run', () => {
    const { map } = twoRooms()
    const result = classifyBox(map, '1,0', '2,2')
    expect(result.kind).toBe('edge')
    if (result.kind !== 'edge') return
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toHaveLength(3)
  })

  it('splits one drag across two different room pairs into separate objects', () => {
    const { project, map } = setup()
    // A on the left, B and C stacked on the right, so a 2x2 box touches both.
    makeRoom(project, map, rect(0, 0, 1, 2))
    makeRoom(project, map, rect(1, 0, 1, 1))
    makeRoom(project, map, rect(1, 1, 1, 1))

    const result = classifyBox(map, '0,0', '1,1')
    expect(result.kind).toBe('edge')
    if (result.kind !== 'edge') return
    // A|B, A|C and B|C are three distinct room pairs, so exactly three objects.
    // A `>= 2` assertion would pass even if two pairs were wrongly merged into
    // one door, which is the failure this test exists to catch.
    expect(result.groups).toHaveLength(3)
    for (const group of result.groups) expect(group).toHaveLength(1)
  })

  it('rejects a box thicker than 2 across the boundary', () => {
    const { map } = twoRooms()
    expect(classifyBox(map, '0,0', '3,2').kind).toBe('invalid')
  })

  it('reads a 1-thick box across a gap as an elevator, snapping to the facing edges', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 1, 2))
    makeRoom(project, map, rect(0, 5, 1, 2))

    const result = classifyBox(map, '0,0', '0,6')
    expect(result.kind).toBe('elevator')
    if (result.kind !== 'elevator') return
    // Endpoint A snapped from the pressed cell (0,0) to the facing edge (0,1).
    expect(result.a).toBe('0,1')
    expect(result.b).toBe('0,5')
    expect(result.axis).toBe('v')
  })

  it('rejects a 1-thick box between adjacent rooms: that is a door, not an elevator', () => {
    const { map } = twoRooms()
    // A 1-thick horizontal box from room A into room B, no gap between them.
    expect(classifyBox(map, '0,0', '3,0').kind).toBe('invalid')
  })
})

describe('creation', () => {
  it('defaults new transitions to Open on both ends', () => {
    const { project, map } = twoRooms()
    const transaction = tx(map)
    const [door] = ok(createFromBox(transaction, project, map, '1,1', '2,1'))
    expect(door.locks).toEqual({ a: OPEN_LOCK_ID, b: OPEN_LOCK_ID })
    expect(door.direction).toBe('both')
  })

  it('indexes an edge door by edge, so four can share one cell', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(1, 1, 1, 1))
    makeRoom(project, map, rect(0, 1, 1, 1))
    makeRoom(project, map, rect(2, 1, 1, 1))

    const transaction = tx(map)
    ok(createFromBox(transaction, project, map, '1,1', '0,1'))
    ok(createFromBox(transaction, project, map, '1,1', '2,1'))

    expect(map.transitions.size).toBe(2)
    expect(map.transitionsAtEdge.get(edgeOfCell('1,1', 'W'))?.size).toBe(1)
    expect(map.transitionsAtEdge.get(edgeOfCell('1,1', 'E'))?.size).toBe(1)
  })

  it('allows at most one teleport per cell', () => {
    const { project, map } = twoRooms()
    const transaction = tx(map)
    ok(
      createTeleport(
        transaction,
        project,
        { mapId: map.id, cell: '0,0' },
        { mapId: map.id, cell: '3,0' },
      ),
    )

    // Same origin cell again. Refused with the reason, not a bare null.
    expect(
      refusal(
        createTeleport(
          transaction,
          project,
          { mapId: map.id, cell: '0,0' },
          { mapId: map.id, cell: '3,2' },
        ),
      ),
    ).toBe('teleport-exists')
  })

  it('refuses a teleport whose ends are in the same room, without cancelling', () => {
    const { project, map } = twoRooms()
    expect(
      canCompleteTeleport(project, { mapId: map.id, cell: '0,0' }, { mapId: map.id, cell: '1,0' }),
    ).toBe(false)
  })

  it('stores a cross-tab teleport once, under its origin map, and indexes the far end', () => {
    const { project, map } = twoRooms()
    const seed = tx()
    const second = addMap(seed, project, 'Map 2')
    seed.commit()

    const paint = tx(second)
    paintCells(paint, project, second, ['9,9'], { areaId: WORLD_AREA_ID })
    paint.commit()

    const transaction = tx(map)
    const teleport = ok(
      createTeleport(
        transaction,
        project,
        { mapId: map.id, cell: '0,0' },
        { mapId: second.id, cell: '9,9' },
      ),
    )

    expect(map.transitions.size).toBe(1)
    expect(second.transitions.size).toBe(0)
    expect(getFarEnd(project.teleportFarEnds, second.id, '9,9')?.transitionId).toBe(teleport.id)
  })
})

describe('attachment lifecycle', () => {
  it('trims an N-wide door to its surviving segments', () => {
    const { project, map, b } = twoRooms()
    const seed = tx(map)
    const [door] = ok(createFromBox(seed, project, map, '1,0', '2,2'))
    seed.commit()
    if (door.kind !== 'edge') throw new Error('expected an edge door')
    expect(door.segments).toHaveLength(3)

    // Erase the middle of room B's edge column; the door loses that segment.
    const transaction = tx(map)
    eraseCells(transaction, project, map, ['2,1'])

    const survivors = [...map.transitions.values()]
    // The remaining segments are disjoint runs, so they became two doors.
    expect(survivors).toHaveLength(2)
    expect(survivors.flatMap((t) => (t.kind === 'edge' ? t.segments : []))).toHaveLength(2)
    expect(map.rooms.has(b.id)).toBe(true)
  })

  it('deletes a door whose rooms merge: no impossible self-connect', () => {
    const { project, map, a } = twoRooms()
    const seed = tx(map)
    ok(createFromBox(seed, project, map, '1,1', '2,1'))
    seed.commit()
    expect(map.transitions.size).toBe(1)

    // Painting from A into B absorbs B; the door would now connect A to A.
    const transaction = tx(map)
    paintCells(transaction, project, map, ['2,1'], { areaId: WORLD_AREA_ID, intoRoomId: a.id })
    expect(map.transitions.size).toBe(0)
  })

  it('rides a teleport along with a moved room and keeps it valid', () => {
    const { project, map, a } = twoRooms()
    const seed = tx(map)
    const teleport = ok(
      createTeleport(seed, project, { mapId: map.id, cell: '0,0' }, { mapId: map.id, cell: '3,0' }),
    )
    seed.commit()

    const transaction = tx(map)
    moveRooms(transaction, project, map, [a.id], 0, 10)

    const moved = map.transitions.get(teleport.id)
    expect(moved).toBeDefined()
    expect(moved!.kind === 'teleport' && moved!.a.cell).toBe('0,10')
  })

  it('deletes an elevator when a room grows across its gap', () => {
    const { project, map } = setup()
    const top = makeRoom(project, map, rect(0, 0, 1, 1))
    makeRoom(project, map, rect(0, 3, 1, 1))

    const seed = tx(map)
    ok(createFromBox(seed, project, map, '0,0', '0,3'))
    seed.commit()
    expect(map.transitions.size).toBe(1)

    // Grow the top room down until the two are adjacent. The gap closes.
    const transaction = tx(map)
    paintCells(transaction, project, map, ['0,1', '0,2'], {
      areaId: WORLD_AREA_ID,
      intoRoomId: top.id,
    })
    expect(map.transitions.size).toBe(0)
  })

  it('deletes every transition on a deleted room, including a still-valid teleport end', () => {
    const { project, map, a, b } = twoRooms()
    const seed = tx(map)
    ok(
      createTeleport(seed, project, { mapId: map.id, cell: '0,0' }, { mapId: map.id, cell: '3,0' }),
    )
    ok(createFromBox(seed, project, map, '1,1', '2,1'))
    seed.commit()
    expect(map.transitions.size).toBe(2)

    const transaction = tx(map)
    deleteRooms(transaction, project, map, [a.id])
    expect(map.transitions.size).toBe(0)
    expect(map.rooms.has(b.id)).toBe(true)
  })

  it('restores the whole cascade on rollback', () => {
    const { project, map, a } = twoRooms()
    const seed = tx(map)
    ok(createFromBox(seed, project, map, '1,0', '2,2'))
    seed.commit()

    const drag = tx(map)
    deleteRooms(drag, project, map, [a.id])
    expect(map.transitions.size).toBe(0)

    drag.rollback()
    expect(map.transitions.size).toBe(1)
    expect(map.rooms.size).toBe(2)
  })
})

describe('direction', () => {
  it('stores all three values, leaving the endpoints and per-end locks alone', () => {
    const { project, map } = twoRooms()
    const transaction = tx(map)
    const teleport = ok(
      createTeleport(
        transaction,
        project,
        { mapId: map.id, cell: '0,0' },
        { mapId: map.id, cell: '3,0' },
      ),
    )
    teleport.locks = { a: OPEN_LOCK_ID, b: 'locked' as LockTypeId }

    // The whole point of a stored direction: A stays A. Reversing used to swap
    // the endpoints and the locks with them, which relabelled both ends of a
    // transition the user had only asked to point the other way.
    setDirection(transaction, project, map, teleport.id, 'bToA')
    expect(teleport.direction).toBe('bToA')
    expect(teleport.kind === 'teleport' && teleport.a.cell).toBe('0,0')
    expect(teleport.locks).toEqual({ a: OPEN_LOCK_ID, b: 'locked' })

    setDirection(transaction, project, map, teleport.id, 'aToB')
    expect(teleport.direction).toBe('aToB')
    expect(teleport.kind === 'teleport' && teleport.a.cell).toBe('0,0')

    setDirection(transaction, project, map, teleport.id, 'both')
    expect(teleport.direction).toBe('both')
  })

  it('undoes a direction change on its own', () => {
    const { project, map } = twoRooms()
    const transaction = tx(map)
    const [door] = ok(createFromBox(transaction, project, map, '1,1', '2,1'))

    setDirection(transaction, project, map, door.id, 'bToA')
    expect(door.direction).toBe('bToA')
    transaction.rollback()
    expect(door.direction).toBe('both')
  })
})
