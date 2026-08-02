// Tests for the invariant checker itself, the oracle used to verify nearly
// every other test. Each check is demonstrated: build a valid project, corrupt
// it directly (bypassing the ops), and assert the checker names the problem.

import { describe, expect, it } from 'vitest'
import { cellKey, edgeOfCell } from './cell'
import type { CellKey } from './cell'
import { createMap } from './factory'
import { setFarEnd } from './farEnds'
import { newAreaId, newLockTypeId, WORLD_AREA_ID } from './ids'
import type { AreaId, LockTypeId } from './ids'
import { addMap } from './ops/maps'
import { createFromBox, createTeleport } from './ops/doors'
import { createLine } from './ops/markup'
import { paintCells } from './ops/rooms'
import { addCell, removeCell } from './primitives'
import type { ElevatorTransition, TeleportTransition } from './types'
import { checkInvariants, makeRoom, ok, rect, setup, snapshot, tx } from './testUtils'

// Asserts the checker is silent on a good project, then names the problem on a
// corrupted one. Both halves matter: a check that fires on healthy state is as
// useless as one that never fires.
function catches(build: () => { project: ReturnType<typeof setup>['project'] }, match: RegExp) {
  const { project } = build()
  const problems = checkInvariants(project)
  expect(problems.join('\n')).toMatch(match)
}

describe('project scope', () => {
  it('catches a map left in mapsById but not in the tab list', () => {
    catches(() => {
      const { project } = setup()
      const orphan = createMap('Leaked')
      project.mapsById.set(orphan.id, orphan)
      return { project }
    }, /mapsById holds orphan map/)
  })

  it('catches a duplicate id in the tab list', () => {
    catches(() => {
      const { project, map } = setup()
      project.maps.push(map.id)
      return { project }
    }, /maps contains a duplicate id/)
  })

  it('catches a mapsById key that disagrees with the map it holds', () => {
    catches(() => {
      const { project, map } = setup()
      const other = createMap('Other')
      project.mapsById.set(map.id, other)
      return { project }
    }, /mapsById key .* holds map/)
  })
})

describe('rooms', () => {
  it('catches a room naming an area that does not exist', () => {
    catches(() => {
      const { project, map } = setup()
      const room = makeRoom(project, map, rect(0, 0, 2, 2))
      room.areaId = newAreaId() as AreaId
      return { project }
    }, /names missing area/)
  })

  it('catches a rooms key that disagrees with the room it holds', () => {
    catches(() => {
      const { project, map } = setup()
      const a = makeRoom(project, map, rect(0, 0, 2, 2))
      const b = makeRoom(project, map, rect(5, 5, 2, 2))
      map.rooms.set(a.id, b)
      return { project }
    }, /rooms key .* holds room/)
  })
})

describe('lines', () => {
  it('catches a line left with a single point', () => {
    catches(() => {
      const { project, map } = setup()
      const seed = tx(map)
      const line = ok(
        createLine(seed, map, [cellKey(0, 0), cellKey(1, 1)], {
          color: '#f00',
          arrowStart: false,
          arrowEnd: true,
        }),
      )
      seed.commit()
      line.points = [cellKey(0, 0)]
      return { project }
    }, /needs at least 2/)
  })

  it('catches a line that jumps between non-adjacent cells', () => {
    catches(() => {
      const { project, map } = setup()
      const seed = tx(map)
      const line = ok(
        createLine(seed, map, [cellKey(0, 0), cellKey(1, 1)], {
          color: '#f00',
          arrowStart: false,
          arrowEnd: true,
        }),
      )
      seed.commit()
      line.points = [cellKey(0, 0), cellKey(9, 9)]
      return { project }
    }, /jumps from/)
  })
})

describe('transitions', () => {
  function twoRoomsWithADoor() {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 1, 2))
    makeRoom(project, map, rect(1, 0, 1, 2))
    const seed = tx(map)
    const door = ok(createFromBox(seed, project, map, cellKey(0, 0), cellKey(1, 1)))[0]
    seed.commit()
    return { project, map, door }
  }

  it('is silent on a healthy door', () => {
    const { project } = twoRoomsWithADoor()
    expect(checkInvariants(project)).toEqual([])
  })

  it('catches an end naming a lock type that does not exist', () => {
    catches(() => {
      const { project, door } = twoRoomsWithADoor()
      door.locks = { ...door.locks, b: newLockTypeId() as LockTypeId }
      return { project }
    }, /names missing lock type/)
  })

  it('catches one edge door spanning two different room pairs', () => {
    catches(() => {
      const { project, map } = setup()
      // A and B side by side, joined by a 2-segment door. Then a third room D
      // takes B's lower cell (cells only, which is what a resize does), so
      // the door's two segments come to describe A|B and A|D.
      makeRoom(project, map, rect(0, 0, 1, 2))
      const b = makeRoom(project, map, rect(1, 0, 1, 2))
      const d = makeRoom(project, map, [cellKey(2, 1)])
      const seed = tx(map)
      const door = ok(createFromBox(seed, project, map, cellKey(0, 0), cellKey(1, 1)))[0]
      seed.commit()
      expect(door.kind === 'edge' && door.segments.length).toBe(2)

      const carve = tx(map)
      removeCell(carve, map, b, cellKey(1, 1))
      addCell(carve, map, d, cellKey(1, 1))
      carve.commit()
      return { project }
    }, /spans 2 room pairs/)
  })

  it('catches an elevator whose stored axis disagrees with its endpoints', () => {
    catches(() => {
      const { project, map } = setup()
      makeRoom(project, map, [cellKey(0, 0)])
      makeRoom(project, map, [cellKey(2, 0)])
      const seed = tx(map)
      const made = ok(createFromBox(seed, project, map, cellKey(0, 0), cellKey(2, 0)))[0]
      seed.commit()
      expect(made.kind).toBe('elevator')
      ;(made as ElevatorTransition).axis = 'v'
      return { project }
    }, /says axis v but runs h/)
  })

  it('catches a transition indexed at a cell it is not anchored to', () => {
    // The gap that let a relocated endpoint stay indexed at its old cell. The
    // old check only asked "does this id still exist?", which it does.
    catches(() => {
      const { project, map } = setup()
      makeRoom(project, map, [cellKey(0, 0)])
      makeRoom(project, map, [cellKey(3, 0)])
      const seed = tx(map)
      const teleport = ok(
        createTeleport(
          seed,
          project,
          { mapId: map.id, cell: cellKey(0, 0) },
          { mapId: map.id, cell: cellKey(3, 0) },
        ),
      )
      seed.commit()
      map.transitionsAtCell.set(cellKey(9, 9), new Set([teleport.id]))
      return { project }
    }, /indexed at cell 9,9 but not anchored there/)
  })

  it('catches two teleport endpoints on one cell (C6)', () => {
    catches(() => {
      const { project, map } = setup()
      makeRoom(project, map, [cellKey(0, 0)])
      makeRoom(project, map, [cellKey(3, 0)])
      makeRoom(project, map, [cellKey(6, 0)])
      makeRoom(project, map, [cellKey(9, 0)])
      const seed = tx(map)
      // `createTeleport` refuses a second endpoint on an occupied cell, which
      // is the rule working. So the second one is created legally elsewhere
      // and then relocated, which is exactly what the cascade does.
      ok(
        createTeleport(
          seed,
          project,
          { mapId: map.id, cell: cellKey(0, 0) },
          { mapId: map.id, cell: cellKey(3, 0) },
        ),
      )
      const second = ok(
        createTeleport(
          seed,
          project,
          { mapId: map.id, cell: cellKey(6, 0) },
          { mapId: map.id, cell: cellKey(9, 0) },
        ),
      )
      seed.commit()

      // Both now claim cell 3,0: the same-map twin of the cascade collision,
      // which the old checker reported entirely clean.
      map.transitionsAtCell.get(cellKey(9, 0))!.delete(second.id)
      ;(second as TeleportTransition).b = { mapId: map.id, cell: cellKey(3, 0) }
      map.transitionsAtCell.get(cellKey(3, 0))!.add(second.id)
      return { project }
    }, /carries 2 teleport endpoints/)
  })

  it('catches an empty index bucket', () => {
    catches(() => {
      const { project, map } = setup()
      map.transitionsAtEdge.set(edgeOfCell(cellKey(0, 0), 'N'), new Set())
      return { project }
    }, /empty bucket/)
  })
})

describe('far-end index', () => {
  function crossTabTeleport() {
    const { project, map } = setup()
    const seed = tx()
    const second = addMap(seed, project, 'Map 2')
    seed.commit()
    const paint = tx()
    paintCells(paint, project, map, [cellKey(0, 0)], { areaId: WORLD_AREA_ID })
    paintCells(paint, project, second, [cellKey(5, 5)], { areaId: WORLD_AREA_ID })
    paint.commit()
    const link = tx()
    const teleport = ok(
      createTeleport(
        link,
        project,
        { mapId: map.id, cell: cellKey(0, 0) },
        { mapId: second.id, cell: cellKey(5, 5) },
      ),
    )
    link.commit()
    return { project, map, second, teleport }
  }

  it('is silent on a healthy cross-tab teleport', () => {
    const { project } = crossTabTeleport()
    expect(checkInvariants(project)).toEqual([])
  })

  it('catches a ref whose originMapId is not where the teleport starts', () => {
    // The shape a re-homed teleport leaves behind: the ref resolves, and the
    // endpoints match, so both directional checks pass. But the transition is
    // filed under a map that is not its origin, and the cascade resolves
    // through `originMapId`, so it can no longer reach it.
    catches(() => {
      const { project, second, teleport } = crossTabTeleport()
      second.transitions.set(teleport.id, teleport)
      setFarEnd(project.teleportFarEnds, second.id, cellKey(5, 5), {
        transitionId: teleport.id,
        originMapId: second.id,
      })
      return { project }
    }, /says origin .* but the teleport starts on/)
  })

  it('catches a far-end entry for a same-map teleport', () => {
    catches(() => {
      const { project, map } = setup()
      makeRoom(project, map, [cellKey(0, 0)])
      makeRoom(project, map, [cellKey(3, 0)])
      const seed = tx(map)
      const teleport = ok(
        createTeleport(
          seed,
          project,
          { mapId: map.id, cell: cellKey(0, 0) },
          { mapId: map.id, cell: cellKey(3, 0) },
        ),
      )
      seed.commit()
      setFarEnd(project.teleportFarEnds, map.id, cellKey(3, 0), {
        transitionId: teleport.id,
        originMapId: map.id,
      })
      return { project }
    }, /names same-map teleport/)
  })

  it('catches a count mismatch that both directional checks miss', () => {
    catches(() => {
      const { project, second, teleport } = crossTabTeleport()
      // A spurious extra entry: every live teleport still has its entry, and
      // every entry still resolves. Only the totals disagree.
      setFarEnd(project.teleportFarEnds, second.id, cellKey(7, 7), {
        transitionId: teleport.id,
        originMapId: teleport.a.mapId,
      })
      return { project }
    }, /holds 2 entries for 1 cross-map teleports/)
  })
})

describe('snapshot', () => {
  it('sees a map leaked into mapsById', () => {
    // Keyed off `project.maps`, a leaked map appears in neither snapshot, so
    // every "rolls back exactly" comparison passes while it is still there.
    const { project } = setup()
    const before = JSON.stringify(snapshot(project))
    const orphan = createMap('Leaked')
    project.mapsById.set(orphan.id, orphan)
    expect(JSON.stringify(snapshot(project))).not.toBe(before)
  })

  it('still fingerprints transition geometry and every index', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 1, 2))
    makeRoom(project, map, rect(1, 0, 1, 2))
    const seed = tx(map)
    const door = ok(createFromBox(seed, project, map, cellKey(0, 0), cellKey(1, 1)))[0]
    seed.commit()

    const before = JSON.stringify(snapshot(project))
    if (door.kind === 'edge') door.segments = [door.segments[0]]
    expect(JSON.stringify(snapshot(project))).not.toBe(before)
  })
})

describe('the checker stays silent on healthy projects', () => {
  it('reports nothing for a project exercising every construct', () => {
    const { project, map } = setup()
    const seed = tx()
    const second = addMap(seed, project, 'Map 2')
    seed.commit()

    const build = tx()
    paintCells(build, project, map, rect(0, 0, 1, 2), { areaId: WORLD_AREA_ID })
    paintCells(build, project, map, rect(1, 0, 1, 2), { areaId: WORLD_AREA_ID })
    paintCells(build, project, map, [cellKey(5, 5)], { areaId: WORLD_AREA_ID })
    paintCells(build, project, second, [cellKey(9, 9)], { areaId: WORLD_AREA_ID })
    build.commit()

    const decorate = tx()
    ok(createFromBox(decorate, project, map, cellKey(0, 0), cellKey(1, 1)))
    ok(
      createTeleport(
        decorate,
        project,
        { mapId: map.id, cell: cellKey(5, 5) },
        { mapId: second.id, cell: cellKey(9, 9) },
      ),
    )
    const path: CellKey[] = [cellKey(20, 20), cellKey(21, 21), cellKey(22, 21)]
    ok(createLine(decorate, map, path, { color: '#0af', arrowStart: false, arrowEnd: false }))
    decorate.commit()

    expect(checkInvariants(project)).toEqual([])
  })
})
