// Turning a sampled pointer path into the grid vertices it ran along, and
// the edges between them.
//
// The cell-stroke companion to `stroke.ts`, and deliberately built on it: the
// vertex lattice is the cell lattice shifted half a cell in both axes, so
// "which vertices did this segment run past" is "which cells did it cross" on a
// grid offset by (0.5, 0.5). That is an identity, not a trick, and it means the
// wall path inherits the two properties `cellsAlong` was chosen for:
//
//   - Orthogonally connected, so consecutive vertices always have a real
//     grid edge between them. A Bresenham staircase would emit (0,0), (1,1),
//     (2,2): pairs with no edge between them, so a fast diagonal drag would
//     draw nothing where a slow one drew a staircase of walls.
//   - Frame-rate independent, for the same reason: the path is a function of
//     where the pointer went, not of how often it was sampled.
//
// Pure grid geometry: no camera, no tile size, no store, and no notion of which
// vertices are interior. That is the gesture's business.

import { cellsAlong, type WorldPoint } from './stroke'
import { parseCell } from '@/core/cell'

export interface Vertex {
  x: number
  y: number
}

// The lattice point a world position is closest to. Ties go to the larger
// coordinate, which is `Math.round`'s own rule and matters only on a measure-
// zero set.
//
// The `+ 0` collapses negative zero, which `Math.round` returns for anything in
// [-0.5, 0). Nothing downstream can currently tell the difference: cell keys
// go through string interpolation, where `${-0}` is "0", and `-0 === 0`. But
// two vertices for the same lattice point that are not `Object.is`-equal is
// exactly the kind of thing that works until the first Set of them.
export function nearestVertex(point: WorldPoint): Vertex {
  return { x: Math.round(point.x) + 0, y: Math.round(point.y) + 0 }
}

// Every vertex the segment from `from` to `to` runs past, in order, starting
// with the vertex nearest `from` and ending with the one nearest `to`.
// Consecutive entries are always one unit apart on exactly one axis.
export function verticesAlong(from: WorldPoint, to: WorldPoint): Vertex[] {
  // The half-cell shift that turns vertex coordinates into cell coordinates:
  // `cellsAlong` floors, and floor(p + 0.5) is round(p).
  return cellsAlong({ x: from.x + 0.5, y: from.y + 0.5 }, { x: to.x + 0.5, y: to.y + 0.5 }).map(
    (cell) => parseCell(cell),
  )
}
