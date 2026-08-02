import { describe, it, expect } from 'vitest'
import { nearestVertex, verticesAlong } from './vertexPath'

describe('nearestVertex', () => {
  it('snaps to the closest lattice point', () => {
    expect(nearestVertex({ x: 1.1, y: 2.9 })).toEqual({ x: 1, y: 3 })
    expect(nearestVertex({ x: -0.4, y: -1.6 })).toEqual({ x: 0, y: -2 })
  })

  // Measure-zero, but it has to land somewhere rather than nowhere.
  it('breaks an exact tie upward', () => {
    expect(nearestVertex({ x: 1.5, y: 2.5 })).toEqual({ x: 2, y: 3 })
  })
})

describe('verticesAlong', () => {
  it('starts at the vertex nearest the start and ends at the one nearest the end', () => {
    const path = verticesAlong({ x: 1.1, y: 1 }, { x: 3.9, y: 1 })
    expect(path[0]).toEqual({ x: 1, y: 1 })
    expect(path[path.length - 1]).toEqual({ x: 4, y: 1 })
  })

  it('walks a straight run one vertex at a time', () => {
    expect(verticesAlong({ x: 1, y: 1 }, { x: 4, y: 1 })).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
    ])
  })

  // The property the whole file exists for. A Bresenham staircase would emit
  // (1,1), (2,2), (3,3): consecutive pairs with no grid edge between them, so
  // a fast diagonal drag would draw nothing where a slow one drew walls.
  it('is orthogonally connected, so every step has a real edge', () => {
    const path = verticesAlong({ x: 1, y: 1 }, { x: 5, y: 4 })
    for (let i = 1; i < path.length; i++) {
      const dx = Math.abs(path[i].x - path[i - 1].x)
      const dy = Math.abs(path[i].y - path[i - 1].y)
      expect(dx + dy).toBe(1)
    }
    expect(path[path.length - 1]).toEqual({ x: 5, y: 4 })
  })

  // The other half of the same property: what a drag draws must not depend on
  // how often the pointer happened to be sampled.
  it('gives the same path however finely the drag is sampled', () => {
    const direct = verticesAlong({ x: 0, y: 0 }, { x: 6, y: 4 })

    const stepped: { x: number; y: number }[] = []
    const samples = 24
    let previous = { x: 0, y: 0 }
    for (let i = 1; i <= samples; i++) {
      const next = { x: (6 * i) / samples, y: (4 * i) / samples }
      const leg = verticesAlong(previous, next)
      for (const vertex of leg) {
        const last = stepped[stepped.length - 1]
        if (!last || last.x !== vertex.x || last.y !== vertex.y) stepped.push(vertex)
      }
      previous = next
    }

    expect(stepped).toEqual(direct)
  })

  it('returns the single vertex when the segment does not leave it', () => {
    expect(verticesAlong({ x: 2.1, y: 2.1 }, { x: 1.9, y: 1.9 })).toEqual([{ x: 2, y: 2 }])
  })

  it('walks negative coordinates the same way', () => {
    expect(verticesAlong({ x: 0, y: 0 }, { x: -2, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: -2, y: 0 },
    ])
  })
})
