import { describe, it, expect } from 'vitest'
import {
  cellKey,
  edgeBetween,
  edgeCells,
  edgeFromSegment,
  edgeKey,
  edgeOfCell,
  isAdjacent8,
  neighbors,
  neighbors8,
  parseCell,
  parseEdge,
  segmentFromEdge,
  sideOfEdge,
  translate,
  translateEdge,
} from './cell'

describe('cell keys', () => {
  it('round-trips signed coordinates', () => {
    expect(parseCell(cellKey(-12, 7))).toEqual({ x: -12, y: 7 })
    expect(parseCell(cellKey(0, 0))).toEqual({ x: 0, y: 0 })
  })

  it('gives four orthogonal neighbours and eight including diagonals', () => {
    expect(neighbors(cellKey(0, 0))).toEqual(['0,-1', '1,0', '0,1', '-1,0'])
    expect(neighbors8(cellKey(0, 0))).toHaveLength(8)
  })

  it('treats diagonals as adjacent only for the 8-way test', () => {
    expect(isAdjacent8('0,0', '1,1')).toBe(true)
    expect(isAdjacent8('0,0', '2,0')).toBe(false)
    expect(isAdjacent8('0,0', '0,0')).toBe(false)
  })

  it('translates', () => {
    expect(translate('3,4', -1, 2)).toBe('2,6')
  })
})

describe('edge canonicalisation', () => {
  // The whole reason edges are canonical: one edge, one name, whichever cell
  // you approach it from.
  it('names a shared edge identically from both cells', () => {
    expect(edgeOfCell('3,7', 'E')).toBe(edgeOfCell('4,7', 'W'))
    expect(edgeOfCell('3,7', 'S')).toBe(edgeOfCell('3,8', 'N'))
  })

  it('maps a canonical edge back to the cells it separates, in a fixed order', () => {
    expect(edgeCells(edgeKey(4, 7, 'V'))).toEqual({ lo: '3,7', hi: '4,7' })
    expect(edgeCells(edgeKey(3, 8, 'H'))).toEqual({ lo: '3,7', hi: '3,8' })
  })

  it('reports which side of a given cell an edge is', () => {
    const edge = edgeOfCell('3,7', 'E')
    expect(sideOfEdge(edge, '3,7')).toBe('E')
    expect(sideOfEdge(edge, '4,7')).toBe('W')
    expect(sideOfEdge(edge, '9,9')).toBeNull()
  })

  it('round-trips through parse and translate', () => {
    const edge = edgeKey(-2, 5, 'V')
    expect(parseEdge(edge)).toEqual({ x: -2, y: 5, axis: 'V' })
    expect(translateEdge(edge, 1, -1)).toBe(edgeKey(-1, 4, 'V'))
  })
})

describe('stored vertex segments', () => {
  // Inner walls persist as vertex pairs; the runtime speaks canonical edges.
  // This conversion is the entire serialisation boundary for wall geometry.
  it('round-trips a horizontal segment', () => {
    const edge = edgeFromSegment([
      [3, 7],
      [4, 7],
    ])
    expect(edge).toBe(edgeKey(3, 7, 'H'))
    expect(segmentFromEdge(edge!)).toEqual([
      [3, 7],
      [4, 7],
    ])
  })

  it('round-trips a vertical segment', () => {
    const edge = edgeFromSegment([
      [3, 7],
      [3, 8],
    ])
    expect(edge).toBe(edgeKey(3, 7, 'V'))
    expect(segmentFromEdge(edge!)).toEqual([
      [3, 7],
      [3, 8],
    ])
  })

  it('normalises a segment drawn backwards to the same edge', () => {
    const forward = edgeFromSegment([
      [3, 7],
      [4, 7],
    ])
    const backward = edgeFromSegment([
      [4, 7],
      [3, 7],
    ])
    expect(backward).toBe(forward)
  })

  it('rejects a non-unit segment rather than inventing an edge', () => {
    expect(
      edgeFromSegment([
        [0, 0],
        [3, 0],
      ]),
    ).toBeNull()
    expect(
      edgeFromSegment([
        [0, 0],
        [1, 1],
      ]),
    ).toBeNull()
  })
})

describe('edgeBetween', () => {
  it('names the shared edge from either side, canonically', () => {
    // The same physical edge whichever cell you ask from. That is what makes
    // it usable as an index key.
    expect(edgeBetween('0,0', '1,0')).toBe('1,0,V')
    expect(edgeBetween('1,0', '0,0')).toBe('1,0,V')
    expect(edgeBetween('0,0', '0,1')).toBe('0,1,H')
    expect(edgeBetween('0,1', '0,0')).toBe('0,1,H')
  })

  it('agrees with edgeCells for every edge', () => {
    for (const edge of ['0,0,V', '3,2,V', '-1,4,H', '0,0,H', '7,-3,V']) {
      const { lo, hi } = edgeCells(edge)
      expect(edgeBetween(lo, hi)).toBe(edge)
    }
  })

  it('returns null for cells that are not orthogonal neighbours', () => {
    expect(edgeBetween('0,0', '0,0')).toBeNull()
    expect(edgeBetween('0,0', '1,1')).toBeNull()
    expect(edgeBetween('0,0', '2,0')).toBeNull()
  })
})
