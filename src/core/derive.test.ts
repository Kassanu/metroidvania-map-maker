import { describe, it, expect } from 'vitest'
import { edgeOfCell } from './cell'
import {
  connectedComponents,
  originalGroupIndex,
  topLeftMost,
  transformCells,
} from './derive/connectivity'
import { computeEdgeRuns, computeOuterWalls, interiorVertices, resizableRuns } from './derive/walls'
import { contentBounds, areaBoundsOnMap } from './derive/bounds'
import { WORLD_AREA_ID } from './ids'
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

describe('interior vertices', () => {
  it('finds the vertices where four of the room’s cells meet', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 3))
    // A 3x3 has exactly four fully-surrounded interior vertices.
    expect(interiorVertices(room)).toHaveLength(4)
  })

  it('finds none in a single-cell room', () => {
    const { project, map } = setup()
    expect(interiorVertices(makeRoom(project, map, rect(0, 0, 1, 1)))).toHaveLength(0)
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
