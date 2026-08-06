import { describe, it, expect } from 'vitest'
import { cellKey, edgeOfCell } from './cell'
import {
  connectedComponents,
  originalGroupIndex,
  topLeftMost,
  transformCells,
} from './derive/connectivity'
import {
  boundaryEdges,
  computeEdgeRuns,
  computeOuterWalls,
  isInnerWallEdge,
  isWallVertex,
  resizableRuns,
  wallVertices,
} from './derive/walls'
import { areaBoundsOnMap, contentBounds, ownedCellsIn, roomsOverlapping } from './derive/bounds'
import { createRoom } from './factory'
import { WORLD_AREA_ID } from './ids'
import type { RoomId } from './ids'
import { grid, makeRoom, rect, setup, sorted } from './testUtils'

describe('connectivity', () => {
  it('finds one group for an orthogonally connected shape', () => {
    expect(
      connectedComponents(
        grid(`
      ##.
      ##.
      ###
    `),
      ),
    ).toHaveLength(1)
  })

  it('treats diagonal-only contact as disconnected: rooms are orthogonal', () => {
    expect(connectedComponents(['0,0', '1,1'])).toHaveLength(2)
  })

  it('picks the top-most then left-most cell', () => {
    expect(topLeftMost(['5,0', '0,3', '1,0'])).toBe('1,0')
  })

  it('gives the original identity to the group holding that cell', () => {
    const groups = [new Set(['9,9']), new Set(['0,0', '0,1'])]
    expect(originalGroupIndex(groups)).toBe(1)
  })
})

describe('transforms', () => {
  it('rotates a 2x1 domino a quarter turn to exact cells', () => {
    // Asserting the exact result, not just "two cells in one column". The
    // whole top-left-bias offset lives in those coordinates, and a weaker
    // assertion here is what let a rotation-drift bug through.
    const mapping = transformCells(['0,0', '1,0'], 'rotateRight')
    expect(sorted(mapping.values())).toEqual(['0,0', '0,1'])
  })

  it('rotates an L to exact cells', () => {
    // #.        ##
    // ##   ->   #.
    const cells = grid(`
      #.
      ##
    `)
    expect(sorted(transformCells(cells, 'rotateRight').values())).toEqual(
      sorted(
        grid(`
          ##
          #.
        `),
      ),
    )
  })

  it('a rotation and its inverse cancel exactly, including mixed-parity boxes', () => {
    for (const cells of [
      rect(0, 0, 3, 2),
      rect(-4, 7, 4, 1),
      rect(0, 0, 2, 2),
      grid(`
      ##.
      .##
    `),
    ]) {
      const right = [...transformCells(cells, 'rotateRight').values()]
      expect(sorted(transformCells(right, 'rotateLeft').values())).toEqual(sorted(cells))

      const left = [...transformCells(cells, 'rotateLeft').values()]
      expect(sorted(transformCells(left, 'rotateRight').values())).toEqual(sorted(cells))
    }
  })

  it('is its own inverse for flips', () => {
    const cells = grid(`
      ##.
      #..
    `)
    const once = transformCells(cells, 'flipH')
    const twice = transformCells(once.values(), 'flipH')
    expect(sorted(twice.values())).toEqual(sorted(cells))
  })

  // The transforms form a group, and rounding towards zero is what makes the
  // implementation respect it.
  describe('composes exactly, at every parity', () => {
    const shapes: [string, string[]][] = [
      ['square', rect(0, 0, 3, 3)],
      ['wide, mixed parity', rect(0, 0, 3, 2)],
      ['tall, mixed parity', rect(0, 0, 2, 5)],
      ['1xN strip', rect(-4, 7, 4, 1)],
      ['single cell', rect(2, 2, 1, 1)],
      [
        'concave',
        grid(`
          ##.
          #..
          ###
        `),
      ],
    ]

    const turn = (cells: Iterable<string>, transform: Parameters<typeof transformCells>[1]) => [
      ...transformCells(cells, transform).values(),
    ]

    for (const [name, cells] of shapes) {
      it(`${name}: four turns in either direction return it exactly`, () => {
        for (const direction of ['rotateRight', 'rotateLeft'] as const) {
          let current: Iterable<string> = cells
          for (let i = 0; i < 4; i++) current = turn(current, direction)
          expect(sorted(current), `4x ${direction}`).toEqual(sorted(cells))
        }
      })

      it(`${name}: two rights, two lefts and flipH+flipV all agree`, () => {
        const twoRights = turn(turn(cells, 'rotateRight'), 'rotateRight')
        expect(sorted(turn(turn(cells, 'rotateLeft'), 'rotateLeft'))).toEqual(sorted(twoRights))
        expect(sorted(turn(turn(cells, 'flipH'), 'flipV'))).toEqual(sorted(twoRights))
      })
    }
  })
})

describe('outer walls', () => {
  it('walls every boundary edge and no internal one', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 1))
    const walls = computeOuterWalls(room)

    // A 2x1 room has 6 boundary edges; the shared edge between its two cells
    // is internal and must not be walled.
    expect(walls.size).toBe(6)
    expect(walls.has(edgeOfCell('0,0', 'E'))).toBe(false)
    expect(walls.has(edgeOfCell('0,0', 'W'))).toBe(true)
  })

  it('has no wall on the seam once two rooms merge into one', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 1, 1))
    makeRoom(project, map, rect(1, 0, 1, 1), room.id)
    expect(computeOuterWalls(room).has(edgeOfCell('0,0', 'E'))).toBe(false)
  })
})

// The same walk over a set nobody owns: what a cell selection is outlined by.
describe('boundary edges', () => {
  it('answers a room its own outer walls', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 1))
    expect(boundaryEdges(room.cells)).toEqual(computeOuterWalls(room))
  })

  it('drops the seam between two cells that touch', () => {
    const edges = boundaryEdges(new Set(rect(0, 0, 2, 1)))

    expect(edges.size).toBe(6)
    expect(edges.has(edgeOfCell('0,0', 'E'))).toBe(false)
  })

  // Two clumps that touch nothing come back as both their boundaries in one
  // set, which is what lets the renderer draw a scattered selection as several
  // outlines without walking connectivity itself.
  it('keeps the boundary of every disjoint clump', () => {
    const edges = boundaryEdges(new Set(grid(`##.##`)))

    expect(edges.size).toBe(12)
    expect(edges.has(edgeOfCell('1,0', 'E'))).toBe(true)
    expect(edges.has(edgeOfCell('3,0', 'W'))).toBe(true)
  })

  // A diagonal touch is not a touch: the two cells share a corner and no edge,
  // so nothing is dropped between them.
  it('treats a diagonal contact as two separate shapes', () => {
    const edges = boundaryEdges(new Set(grid(`#.\n.#`)))
    expect(edges.size).toBe(8)
  })

  it('has no edges for an empty set', () => {
    expect(boundaryEdges(new Set()).size).toBe(0)
  })
})

describe('owned cells in a box', () => {
  // A band covering more than the map, to prove the answer is bounded by what
  // is drawn rather than by the rectangle.
  it('takes the cells inside the box and no bare grid', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 2, 1))

    expect(sorted(ownedCellsIn(map, { minCol: -5, minRow: -5, maxCol: 5, maxRow: 5 }))).toEqual(
      sorted(['0,0', '1,0']),
    )
  })

  it('takes part of a room, where the room query takes all of it', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 1))
    const box = { minCol: 0, minRow: 0, maxCol: 1, maxRow: 0 }

    expect(sorted(ownedCellsIn(map, box))).toEqual(sorted(['0,0', '1,0']))
    expect(roomsOverlapping(map, box)).toEqual([room.id])
  })

  it('crosses room boundaries', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 1, 1))
    makeRoom(project, map, rect(1, 0, 1, 1))

    expect(sorted(ownedCellsIn(map, { minCol: 0, minRow: 0, maxCol: 1, maxRow: 0 }))).toEqual(
      sorted(['0,0', '1,0']),
    )
  })

  it('is empty for a box over nothing', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 2, 1))

    expect(ownedCellsIn(map, { minCol: 8, minRow: 8, maxCol: 9, maxRow: 9 })).toEqual([])
  })
})

describe('edge runs', () => {
  it('splits a side into maximal straight runs', () => {
    const { project, map } = setup()
    // An L: the east side has a run of 2 (rows 0-1 at x=1) and a separate
    // single at x=2, row 2.
    const room = makeRoom(
      project,
      map,
      grid(`
      ##
      ##
      ###
    `),
    )
    const east = computeEdgeRuns(room).filter((run) => run.side === 'E')
    expect(east.map((run) => run.cells.length).sort()).toEqual([1, 2])
  })

  it('offers handles only on runs of two or more', () => {
    const { project, map } = setup()
    const single = makeRoom(project, map, rect(0, 0, 1, 1))
    // Every side of a 1x1 is a length-1 face: no handles at all.
    expect(resizableRuns(single)).toHaveLength(0)

    const wide = makeRoom(project, map, rect(5, 5, 3, 1))
    expect(
      resizableRuns(wide)
        .map((run) => run.side)
        .sort(),
    ).toEqual(['N', 'S'])
  })

  it('recomputes after the room changes, via the revision counter', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 1))
    expect(resizableRuns(room)).toHaveLength(2)
    makeRoom(project, map, rect(0, 1, 2, 1), room.id)
    // Now 2x2: all four sides have a run of 2.
    expect(resizableRuns(room)).toHaveLength(4)
  })
})

describe('inner-wall edges', () => {
  it('accepts an edge whose two cells are both in the room', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 3))
    expect(isInnerWallEdge(room, edgeOfCell('1,1', 'E'))).toBe(true)
  })

  // The whole ring of edges next to the outer wall. Each has both its cells in
  // the room while one of its endpoints sits on the boundary, which is the
  // distinction the vertex predicate cannot make.
  it('accepts an edge with an endpoint on the outer boundary', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 3))
    expect(isInnerWallEdge(room, edgeOfCell('0,0', 'E'))).toBe(true)
  })

  it('accepts the only interior edge of a two-cell room', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 1, 2))
    expect(isInnerWallEdge(room, edgeOfCell('0,0', 'S'))).toBe(true)
  })

  it('refuses an outer boundary edge', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 3))
    expect(isInnerWallEdge(room, edgeOfCell('1,0', 'N'))).toBe(false)
  })

  it('refuses an edge belonging to no cell of the room', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 3))
    expect(isInnerWallEdge(room, edgeOfCell('9,9', 'E'))).toBe(false)
  })

  // The edge across the waist of an hourglass: both its cells are in the room,
  // and neither endpoint is anywhere near interior.
  it('accepts across a one-cell waist', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, ['0,0', '0,1'])
    expect(isInnerWallEdge(room, edgeOfCell('0,0', 'S'))).toBe(true)
  })
})

describe('wall vertices', () => {
  // A 3x3 has 16 lattice points in its box; the four corners of the room touch
  // one cell each and so have no drawable edge. Everything else is a target,
  // including the whole boundary ring.
  it('finds every vertex with a drawable edge, boundary ring included', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 3))
    expect(wallVertices(room)).toHaveLength(12)
  })

  it('excludes the corners of a rectangular room', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 3))
    for (const corner of [
      [0, 0],
      [3, 0],
      [0, 3],
      [3, 3],
    ]) {
      expect(isWallVertex(room, corner[0], corner[1])).toBe(false)
    }
  })

  it('finds none in a single-cell room', () => {
    const { project, map } = setup()
    expect(wallVertices(makeRoom(project, map, rect(0, 0, 1, 1)))).toHaveLength(0)
  })

  // The case the old predicate could not express: no vertex here has four
  // cells around it, but the two across the waist each have a drawable edge.
  it('finds the pair spanning a room one cell thick', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, ['0,0', '0,1'])
    expect(wallVertices(room)).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ])
  })

  it('reports them in row-major order', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 2))
    expect(wallVertices(room)).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
    ])
  })

  // The list and the predicate are one rule, so the list is exactly the
  // predicate over every lattice point the room can reach. Sweeping the box
  // here is affordable because the shapes are small; the enumeration itself
  // must not, which is the next test.
  it('agrees with the predicate over an awkward shape', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, [
      '0,0',
      '0,1',
      '0,2',
      '1,2',
      '2,2',
      '3,2',
      '3,1',
      '2,1',
      '3,0',
    ])
    const expected: { x: number; y: number }[] = []
    for (let y = -1; y <= 4; y++) {
      for (let x = -1; x <= 5; x++) if (isWallVertex(room, x, y)) expected.push({ x, y })
    }
    expect(wallVertices(room)).toEqual(expected)
  })

  // A staircase's bounding box grows as the square of its cell count, so a
  // sweep of the box rather than the cells is unbounded work for a room a
  // user can actually draw. The budget is generous: it separates a walk of
  // 40,000 cells from one of 4x10^8 grid positions, not two similar numbers.
  //
  // The room is assembled directly rather than painted, because painting it
  // is the slow part and it is not what this measures.
  it('costs the cells rather than the bounding box', () => {
    const room = createRoom(WORLD_AREA_ID, 'staircase' as RoomId)
    for (let i = 0; i < 20_000; i++) {
      room.cells.add(cellKey(i, i))
      room.cells.add(cellKey(i + 1, i))
    }

    const started = performance.now()
    const vertices = wallVertices(room)
    expect(performance.now() - started).toBeLessThan(5_000)
    // Every step of the staircase is two cells side by side, so the two ends
    // of the edge between them are targets: 3 per step, sharing one with the
    // step below.
    expect(vertices.length).toBeGreaterThan(20_000)
  })
})

describe('bounds', () => {
  it('is null for an empty map and covers the content otherwise', () => {
    const { project, map } = setup()
    expect(contentBounds(map)).toBeNull()
    makeRoom(project, map, rect(-3, 2, 2, 2))
    expect(contentBounds(map)).toEqual({ minCol: -3, minRow: 2, maxCol: -2, maxRow: 3 })
  })

  it('scopes an area’s bounding box to the rooms it has on this map', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 1, 1))
    makeRoom(project, map, rect(4, 3, 1, 1))
    expect(areaBoundsOnMap(map, WORLD_AREA_ID)).toEqual({
      minCol: 0,
      minRow: 0,
      maxCol: 4,
      maxRow: 3,
    })
  })
})

describe('rooms overlapping a box', () => {
  const box = (minCol: number, minRow: number, maxCol: number, maxRow: number) => ({
    minCol,
    minRow,
    maxCol,
    maxRow,
  })

  it('takes a room the box merely touches, and leaves the ones it misses', () => {
    const { project, map } = setup()
    const touched = makeRoom(project, map, rect(0, 0, 3, 3))
    makeRoom(project, map, rect(9, 9, 2, 2))

    // One cell of the 3x3 inside the box is the whole room.
    expect(roomsOverlapping(map, box(2, 2, 4, 4))).toEqual([touched.id])
  })

  it('is empty for a box over bare grid', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 2, 2))

    expect(roomsOverlapping(map, box(5, 5, 8, 8))).toEqual([])
  })

  // The bounding box only rejects. An L has a square box, and a marquee in the
  // notch overlaps that box while touching none of the room's cells.
  it('rejects a box inside the notch of an L, whose bounding box it overlaps', () => {
    const { project, map } = setup()
    const shape = makeRoom(
      project,
      map,
      grid(`
      #..
      #..
      ###
    `),
    )

    expect(roomsOverlapping(map, box(1, 0, 2, 1))).toEqual([])
    expect(roomsOverlapping(map, box(1, 2, 2, 2))).toEqual([shape.id])
  })

  it('answers in map order, whichever corner the box was dragged from', () => {
    const { project, map } = setup()
    const first = makeRoom(project, map, rect(0, 0, 1, 1))
    const second = makeRoom(project, map, rect(2, 0, 1, 1))

    expect(roomsOverlapping(map, box(0, 0, 2, 0))).toEqual([first.id, second.id])
  })
})
