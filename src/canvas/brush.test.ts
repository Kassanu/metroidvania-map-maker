import { describe, it, expect } from 'vitest'
import { brushCells, brushOffset, clampBrushSize, MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from './brush'

// The anchoring rule, pinned row by row rather than left to whatever the
// arithmetic happens to do.
//
// World coordinates: cell (3,5) spans x ∈ [3,4), y ∈ [5,6), so (3.2, 5.2) is
// its upper-left quarter and (3.8, 5.8) its lower-right.
describe('brush footprint', () => {
  const sorted = (cells: string[]) => [...cells].sort()

  describe('size 1', () => {
    it('is the pointer cell, wherever in it you are', () => {
      expect(brushCells({ x: 3.01, y: 5.99 }, 1)).toEqual(['3,5'])
      expect(brushCells({ x: 3.5, y: 5.5 }, 1)).toEqual(['3,5'])
    })
  })

  // Odd sizes have a middle cell, so there is nothing to decide: it is the
  // one under the pointer.
  describe('odd sizes centre on the pointer cell', () => {
    it('puts a 3×3 symmetrically around it', () => {
      expect(sorted(brushCells({ x: 3.2, y: 5.2 }, 3))).toEqual(
        sorted(['2,4', '3,4', '4,4', '2,5', '3,5', '4,5', '2,6', '3,6', '4,6']),
      )
    })

    it('does not move as the pointer crosses the cell midlines', () => {
      const upperLeft = sorted(brushCells({ x: 3.01, y: 5.01 }, 3))
      const lowerRight = sorted(brushCells({ x: 3.99, y: 5.99 }, 3))
      expect(lowerRight).toEqual(upperLeft)
    })

    it('scales symmetrically at 5×5', () => {
      const cells = brushCells({ x: 3.5, y: 5.5 }, 5)
      expect(cells).toHaveLength(25)
      expect(cells).toContain('1,3')
      expect(cells).toContain('5,7')
    })
  })

  // Even sizes centre on the nearest vertex, so the block straddles the
  // cursor as closely as the grid allows.
  describe('even sizes centre on the nearest vertex', () => {
    it('sits up-left from the upper-left quarter of the cell', () => {
      expect(sorted(brushCells({ x: 3.2, y: 5.2 }, 2))).toEqual(
        sorted(['2,4', '3,4', '2,5', '3,5']),
      )
    })

    it('sits down-right from the lower-right quarter', () => {
      expect(sorted(brushCells({ x: 3.8, y: 5.8 }, 2))).toEqual(
        sorted(['3,5', '4,5', '3,6', '4,6']),
      )
    })

    // The two axes are decided independently: it is a quadrant, not a corner.
    it('mixes the axes independently', () => {
      expect(sorted(brushCells({ x: 3.2, y: 5.8 }, 2))).toEqual(
        sorted(['2,5', '3,5', '2,6', '3,6']),
      )
    })

    it('keeps a 4×4 straddling the pointer, weighted to its quadrant', () => {
      // Left half of the cell: two columns left of the pointer cell, one right.
      expect(brushOffset({ x: 3.2, y: 3.2 }, 4)).toEqual({ dc: -2, dr: -2 })
      // Right half: one left, two right.
      expect(brushOffset({ x: 3.8, y: 3.8 }, 4)).toEqual({ dc: -1, dr: -1 })
    })
  })

  // Ties break top-left, matching the split rule's tiebreaker and Rotate &
  // Flip's pivot snapping elsewhere in the app. `Math.round` rounds halves up
  // and would reverse this.
  describe('exact ties break top-left', () => {
    it('resolves a pointer on the cell midline up and left', () => {
      expect(sorted(brushCells({ x: 3.5, y: 5.5 }, 2))).toEqual(
        sorted(['2,4', '3,4', '2,5', '3,5']),
      )
    })

    it('resolves a pointer exactly on a cell corner up and left', () => {
      expect(sorted(brushCells({ x: 3.0, y: 5.0 }, 2))).toEqual(
        sorted(['2,4', '3,4', '2,5', '3,5']),
      )
    })
  })

  // The grid is unbounded and signed, so the maths has to survive the origin.
  // `Math.floor`/`Math.ceil` do; a truncating `| 0` would not, and negative
  // zero must not leak into a cell key.
  describe('negative coordinates', () => {
    it('anchors an odd brush the same way left of the origin', () => {
      expect(sorted(brushCells({ x: -3.5, y: -3.5 }, 3))).toEqual(
        sorted(['-5,-5', '-4,-5', '-3,-5', '-5,-4', '-4,-4', '-3,-4', '-5,-3', '-4,-3', '-3,-3']),
      )
    })

    it('picks the quadrant correctly either side of the origin', () => {
      // Cell (-1,-1) spans [-1,0); -0.2 is its right/lower half.
      expect(sorted(brushCells({ x: -0.2, y: -0.2 }, 2))).toEqual(
        sorted(['-1,-1', '0,-1', '-1,0', '0,0']),
      )
      // -0.8 is its left/upper half.
      expect(sorted(brushCells({ x: -0.8, y: -0.8 }, 2))).toEqual(
        sorted(['-2,-2', '-1,-2', '-2,-1', '-1,-1']),
      )
    })
  })

  describe('the footprint is always N×N', () => {
    it.each([1, 2, 3, 4, 5, 8, MAX_BRUSH_SIZE])('has %i² distinct cells', (size) => {
      const cells = brushCells({ x: 3.3, y: 7.7 }, size)
      expect(new Set(cells).size).toBe(size * size)
    })
  })

  describe('clampBrushSize', () => {
    it('holds the range', () => {
      expect(clampBrushSize(0)).toBe(MIN_BRUSH_SIZE)
      expect(clampBrushSize(-5)).toBe(MIN_BRUSH_SIZE)
      expect(clampBrushSize(MAX_BRUSH_SIZE + 1)).toBe(MAX_BRUSH_SIZE)
    })

    it('rounds a fractional size rather than admitting one', () => {
      expect(clampBrushSize(2.4)).toBe(2)
      expect(clampBrushSize(2.6)).toBe(3)
    })
  })
})
