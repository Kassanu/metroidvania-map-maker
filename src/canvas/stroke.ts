// Turning a sampled pointer path into the cells it crossed.
//
// A pointer stream is a few dozen positions per second, not a path: at speed,
// consecutive `pointermove` events land cells apart. So a free-form stroke is
// the union of the cells each segment passed through, never the union of the
// cells the samples happened to land in.
//
// A supercover, not Bresenham. Bresenham picks one cell per major-axis step,
// so it returns a diagonal as a staircase: (0,0), (1,1), (2,2), which is not
// orthogonally connected. Core settles a disconnected paint into separate
// rooms (`paintStaysConnected` in ops/rooms.ts is explicit about the staircase
// case), so a fast diagonal drag would produce three rooms where a slow drag
// over the same path produces one, with the difference decided by frame rate. A supercover emits every cell the segment
// actually crosses, which is always an orthogonally connected chain, so what a
// stroke paints does not depend on how fast it was drawn.
//
// Pure grid geometry: no camera, no tile size, no store. The gesture converts
// to world coordinates before calling in.

import { cellKey } from '@/core/cell'
import type { CellKey } from '@/core/cell'

// A point in world-cell coordinates, where (1.5, 0.5) is the centre of cell
// (1,0). Fractional and freely negative: the grid is unbounded.
export interface WorldPoint {
  x: number
  y: number
}

// Every cell the segment from `from` to `to` passes through, in order, starting
// with the cell containing `from` and ending with the cell containing `to`.
// Consecutive entries are always orthogonally adjacent.
//
// Amanatides–Woo grid traversal: walk to whichever axis boundary the segment
// reaches first, step across it, repeat. `tMax` is how far along the segment
// the next crossing on that axis is, as a fraction of the whole segment, so the
// walk ends when both are past 1.
export function cellsAlong(from: WorldPoint, to: WorldPoint): CellKey[] {
  let x = Math.floor(from.x)
  let y = Math.floor(from.y)
  const endX = Math.floor(to.x)
  const endY = Math.floor(to.y)

  const cells: CellKey[] = [cellKey(x, y)]
  if (x === endX && y === endY) return cells

  const dx = to.x - from.x
  const dy = to.y - from.y
  const stepX = Math.sign(dx)
  const stepY = Math.sign(dy)

  // An axis the segment does not move along never produces a crossing, which
  // Infinity expresses without a special case in the loop.
  const deltaX = dx === 0 ? Infinity : Math.abs(1 / dx)
  const deltaY = dy === 0 ? Infinity : Math.abs(1 / dy)
  let nextX = dx === 0 ? Infinity : (dx > 0 ? x + 1 - from.x : from.x - x) / Math.abs(dx)
  let nextY = dy === 0 ? Infinity : (dy > 0 ? y + 1 - from.y : from.y - y) / Math.abs(dy)

  while (nextX <= 1 || nextY <= 1) {
    // The tie is an exact corner crossing (measure zero), broken toward x
    // deterministically. Either adjacent cell is an honest answer; taking
    // neither would be the diagonal jump this function exists to avoid.
    if (nextX <= nextY) {
      x += stepX
      nextX += deltaX
    } else {
      y += stepY
      nextY += deltaY
    }
    cells.push(cellKey(x, y))
    if (x === endX && y === endY) break
  }

  return cells
}
