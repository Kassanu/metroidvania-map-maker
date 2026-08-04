import { describe, it, expect } from 'vitest'
import { DOOR_JAMB, doorOpening, doorRuns, wallGaps, type DoorRun, type OpenSpan } from './doorRuns'
import { createProject } from '@/core/factory'
import { Transaction } from '@/core/journal'
import { createFromBox } from '@/core/ops/doors'
import { paintCells } from '@/core/ops/rooms'
import { putTransition } from '@/core/primitives'
import { edgeKey } from '@/core/cell'
import { OPEN_LOCK_ID, WORLD_AREA_ID, newTransitionId } from '@/core/ids'
import type { MapModel, ProjectModel } from '@/core/types'

// Built through the real ops, like every other canvas suite: the geometry under
// test has to be the geometry `classifyBox` produces, not a literal that agrees
// with this file's idea of a door.
function withMap(build: (tx: Transaction, project: ProjectModel, map: MapModel) => void) {
  const project = createProject({
    projectName: 'Fixture',
    firstMapName: 'Map 1',
    worldAreaName: 'World',
    openLockName: 'Open',
    lockedLockName: 'Locked',
  })
  const map = project.mapsById.get(project.maps[0])!
  const tx = new Transaction('build', { kind: 'map', mapId: map.id })
  build(tx, project, map)
  tx.commit()
  return { project, map }
}

// Two rooms side by side, sharing the vertical seam at x = 2: room A is the
// 2x3 block to its west, room B the 2x3 block to its east.
function twoRooms(build?: (tx: Transaction, project: ProjectModel, map: MapModel) => void) {
  return withMap((tx, project, map) => {
    paintCells(tx, project, map, ['0,0', '1,0', '0,1', '1,1', '0,2', '1,2'], {
      areaId: WORLD_AREA_ID,
    })
    paintCells(tx, project, map, ['2,0', '3,0', '2,1', '3,1', '2,2', '3,2'], {
      areaId: WORLD_AREA_ID,
    })
    build?.(tx, project, map)
  })
}

describe('doorRuns', () => {
  it('is empty for a map with no transitions', () => {
    const { map } = twoRooms()
    expect(doorRuns(map)).toEqual([])
  })

  it('reports a single-segment door as a one-edge run on its seam', () => {
    const { map } = twoRooms((tx, project, map) => {
      createFromBox(tx, project, map, '1,1', '2,1')
    })

    const runs = doorRuns(map)
    expect(runs).toHaveLength(1)
    expect(runs[0].axis).toBe('V')
    expect(runs[0].edges).toEqual([edgeKey(2, 1, 'V')])
    // The seam is at x = 2, and the run covers the one cell row y = 1..2.
    expect([runs[0].fixed, runs[0].start, runs[0].end]).toEqual([2, 1, 2])
  })

  it('spans an N-wide door as one run', () => {
    const { map } = twoRooms((tx, project, map) => {
      createFromBox(tx, project, map, '1,0', '2,2')
    })

    const runs = doorRuns(map)
    expect(runs).toHaveLength(1)
    expect(runs[0].edges).toHaveLength(3)
    expect([runs[0].start, runs[0].end]).toEqual([0, 3])
  })

  // `contiguousRuns` grows a run by scanning, so its order follows the order the
  // segments were stored in rather than the geometry, and the run's two ends
  // would come from whichever segment happened to be listed first.
  //
  // Reached by storing the door directly, because `classifyBox` cannot produce
  // it: it walks the box in ascending order whichever way the drag went, so a
  // created door is always already sorted. A file is where an out-of-order
  // segment list comes from: nothing in the format or the type forbids one, and
  // the loader preserves array order.
  it('orders a run along the seam whatever order the segments are stored in', () => {
    const { map } = twoRooms((tx, project, map) => {
      putTransition(tx, project, map, {
        kind: 'edge',
        id: newTransitionId(),
        segments: [
          { edge: edgeKey(2, 2, 'V'), aSide: 'lo' },
          { edge: edgeKey(2, 0, 'V'), aSide: 'lo' },
          { edge: edgeKey(2, 1, 'V'), aSide: 'lo' },
        ],
        locks: { a: OPEN_LOCK_ID, b: OPEN_LOCK_ID },
        direction: 'both',
        notes: '',
      })
    })

    const runs = doorRuns(map)
    expect(runs).toHaveLength(1)
    expect(runs[0].edges).toEqual([edgeKey(2, 0, 'V'), edgeKey(2, 1, 'V'), edgeKey(2, 2, 'V')])
    expect([runs[0].start, runs[0].end]).toEqual([0, 3])
  })

  // A 2x2 corner box yields a horizontal door plus a vertical one, since doors
  // can never be diagonal: that is two objects, and so two runs whose axes
  // differ. The L-shaped room is what puts one cross-room edge on each axis
  // inside a single 2x2 box.
  it('reports a corner box as one run per axis', () => {
    const { map } = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['1,0', '1,1', '0,1'], { areaId: WORLD_AREA_ID })
      createFromBox(tx, project, map, '0,0', '1,1')
    })

    const runs = doorRuns(map)
    expect(runs).toHaveLength(2)
    expect(runs.map((run) => run.axis).sort()).toEqual(['H', 'V'])
    expect(runs.every((run) => run.edges.length === 1)).toBe(true)
  })

  // Elevators are anchored to cell edges too (`transitionsAtEdge` holds both),
  // but an elevator does not sit on a shared wall and must never break one.
  it('ignores elevators and teleports', () => {
    const { map } = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['3,0'], { areaId: WORLD_AREA_ID })
      createFromBox(tx, project, map, '0,0', '3,0')
    })

    expect(map.transitions.size).toBe(1)
    expect(doorRuns(map)).toEqual([])
  })

  it('carries the per-end locks through', () => {
    const { map } = twoRooms((tx, project, map) => {
      createFromBox(tx, project, map, '1,1', '2,1')
    })

    expect(doorRuns(map)[0].locks).toEqual({ a: OPEN_LOCK_ID, b: OPEN_LOCK_ID })
  })
})

describe('doorOpening', () => {
  it('insets the run by a jamb at each end', () => {
    const run: DoorRun = {
      id: newTransitionId(),
      axis: 'V',
      fixed: 2,
      start: 0,
      end: 3,
      edges: [],
      locks: { a: OPEN_LOCK_ID, b: OPEN_LOCK_ID },
      aSide: 'lo',
      direction: 'both',
    }

    expect(doorOpening(run)).toEqual({
      from: [2, DOOR_JAMB],
      to: [2, 3 - DOOR_JAMB],
    })
  })

  it('runs along x for a horizontal seam', () => {
    const run: DoorRun = {
      id: newTransitionId(),
      axis: 'H',
      fixed: 4,
      start: 1,
      end: 2,
      edges: [],
      locks: { a: OPEN_LOCK_ID, b: OPEN_LOCK_ID },
      aSide: 'lo',
      direction: 'both',
    }

    expect(doorOpening(run)).toEqual({
      from: [1 + DOOR_JAMB, 4],
      to: [2 - DOOR_JAMB, 4],
    })
  })
})

describe('wallGaps', () => {
  // Closeness rather than equality: an edge's span is the opening measured
  // against that edge's own origin, so the far end of a 3-long run arrives as
  // `(3 - 1/6) - 2` and is one ulp off the `1 - 1/6` this file would write.
  function expectSpan(actual: OpenSpan | undefined, from: number, to: number) {
    expect(actual).toBeDefined()
    expect(actual!.from).toBeCloseTo(from)
    expect(actual!.to).toBeCloseTo(to)
  }

  it('opens the middle of a single-segment door, leaving both jambs', () => {
    const { map } = twoRooms((tx, project, map) => {
      createFromBox(tx, project, map, '1,1', '2,1')
    })

    const gaps = wallGaps(doorRuns(map))
    expect([...gaps.keys()]).toEqual([edgeKey(2, 1, 'V')])
    expectSpan(gaps.get(edgeKey(2, 1, 'V')), DOOR_JAMB, 1 - DOOR_JAMB)
  })

  // The reason the gap is per-edge rather than per-run: an N-wide door is one
  // opening, so only its two outermost edges keep a jamb and everything between
  // them is open end to end. Per-segment jambs would draw an N-wide door as N
  // separate ones.
  it('keeps a jamb only at the two ends of an N-wide door', () => {
    const { map } = twoRooms((tx, project, map) => {
      createFromBox(tx, project, map, '1,0', '2,2')
    })

    const gaps = wallGaps(doorRuns(map))
    expectSpan(gaps.get(edgeKey(2, 0, 'V')), DOOR_JAMB, 1)
    expectSpan(gaps.get(edgeKey(2, 1, 'V')), 0, 1)
    expectSpan(gaps.get(edgeKey(2, 2, 'V')), 0, 1 - DOOR_JAMB)
  })

  // A drag from any room cell always creates a new door, even where one
  // already exists, so two doors can share an edge. The wall is broken
  // wherever either of them breaks it: a last-writer-wins map would re-close
  // part of one door with the other's jamb.
  it('unions the gaps of two doors sharing an edge', () => {
    const { map } = twoRooms((tx, project, map) => {
      createFromBox(tx, project, map, '1,0', '2,1')
      createFromBox(tx, project, map, '1,1', '2,2')
    })

    const gaps = wallGaps(doorRuns(map))
    // The shared middle edge is the last edge of one door and the first of
    // the other, so each leaves one jamb on it and together they leave none.
    expect(gaps.get(edgeKey(2, 1, 'V'))).toEqual({ from: 0, to: 1 })
  })
})
