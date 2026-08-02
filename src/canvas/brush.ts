// The brush footprint: where an N×N block sits relative to the pointer.
// Pure geometry, a function of a world point and a size. The stroke owns
// accumulation; the ops own the model; this file slots between them.
//
// Anchoring logic:
//
// Odd sizes centre on the pointer's cell (there is a middle cell to choose).
//
// Even sizes centre on the nearest grid vertex, so a 2×2 straddles the cursor
// as closely as the grid allows. A pointer exactly on a midline breaks toward
// the smaller index (up and left).
//
// The tie-break must be consistent across the app. `Math.round` rounds halves
// up and would reverse it, so use `ceil(v - 0.5)` instead.

import { cellKey, parseCell } from '@/core/cell'
import { clamp } from '@/lib/math'
import type { CellKey } from '@/core/cell'
import type { WorldPoint } from './stroke'

// Size 1 is the default. The ceiling is a tuning constant: 10 keeps a single
// stamp under 100 cells, far larger than any room worth painting by hand.
export const MIN_BRUSH_SIZE = 1
export const MAX_BRUSH_SIZE = 10
export const DEFAULT_BRUSH_SIZE = MIN_BRUSH_SIZE

export function clampBrushSize(size: number): number {
  return clamp(Math.round(size), MIN_BRUSH_SIZE, MAX_BRUSH_SIZE)
}

// How far the footprint's top-left cell sits from the anchor cell, on one
// axis. Same maths for both, so it is written once.
//
// The whole even/odd split lives here, which is what lets the rest of the
// brush be a plain rectangle.
function offsetAlong(coordinate: number, size: number): number {
  // Odd: the block has a middle cell, and it is the one under the pointer.
  if (size % 2 === 1) return -(size - 1) / 2

  // Even: centre on the nearest vertex. `ceil(v - 0.5)` rounds halves down, so
  // a pointer on a midline resolves up and left. `Math.round` would reverse that.
  const cell = Math.floor(coordinate)
  const nearestVertex = Math.ceil(coordinate - 0.5)
  return nearestVertex - cell - size / 2
}

// The footprint's offset from the cell under the pointer.
//
// Returned separately so a stroke can compute it once per sample and stamp it
// over every cell the sample's segment crossed. Interpolated cells in between
// have no sub-cell position to derive it from.
export interface BrushOffset {
  dc: number
  dr: number
}

export function brushOffset(point: WorldPoint, size: number): BrushOffset {
  return {
    dc: offsetAlong(point.x, size),
    dr: offsetAlong(point.y, size),
  }
}

// Every cell of the N×N block anchored at `cell` by `offset`.
export function brushCellsAt(cell: CellKey, size: number, offset: BrushOffset): CellKey[] {
  if (size === 1) return [cell]

  const { x, y } = parseCell(cell)
  const cells: CellKey[] = []
  for (let dr = 0; dr < size; dr++) {
    for (let dc = 0; dc < size; dc++) {
      cells.push(cellKey(x + offset.dc + dc, y + offset.dr + dr))
    }
  }
  return cells
}

// The footprint under a pointer, straight from a world point. The hover
// preview's whole implementation, and the readable form for tests.
export function brushCells(point: WorldPoint, size: number): CellKey[] {
  const cell = cellKey(Math.floor(point.x), Math.floor(point.y))
  return brushCellsAt(cell, size, brushOffset(point, size))
}
