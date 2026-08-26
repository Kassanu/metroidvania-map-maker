// What a room's liquid region is filled with: a checkerboard alternating the
// room's own fill against a darkened version of its area's colour.
//
// Four things here are load-bearing:
//
//   * This file decides pattern or flat blend, and no caller asks. The square
//     size and the legibility floor are then read in one place and cannot come
//     to disagree about which cell size is which.
//   * The tile is two squares on a side. One square repeats to a solid colour.
//   * The tile's pixels are device pixels, so a caller fills with the transform
//     reset to identity. A pattern's source maps 1:1 onto user space and the
//     renderer's context is pre-scaled by the device pixel ratio, so filling
//     under that scale draws every square ratio times too big.
//   * The cache key is the colour pair and the square size, not the ratio. Two
//     ratios that round to the same square want the same tile, byte for byte,
//     and keying on the ratio would hold two copies of it.
//
// Sixty-four squares per cell is what makes the cache worth having: a flooded
// map fills each room's region once with a pattern, never a rect per square.

import { blend } from './color'
import { checkerSquarePx, flattensToBlend } from './devicePixels'

// A `fillStyle` the caller can assign without knowing which it got.
export type DitherFill = string | CanvasPattern

export interface DitherRequest {
  // The room's resolved fill, heat already applied.
  light: string
  // The area's colour darkened. Never derived from `light`: heat does not reach
  // the dark half.
  dark: string
  // One cell's size in device pixels, from `cellDevicePx`.
  cell: number
  dpr: number
}

// Square size changes with zoom, so a continuous zoom mints an entry per
// rounded size. Bounded for that reason, and evicted oldest-first rather than
// least-recently-used: a zoom walks sizes in order and never revisits them, so
// recency carries no information here.
const CACHE_LIMIT = 32
const cache = new Map<string, CanvasPattern>()

export function ditherFill(
  ctx: CanvasRenderingContext2D,
  { light, dark, cell, dpr }: DitherRequest,
): DitherFill {
  if (flattensToBlend(cell, dpr)) return blend(light, dark)

  const square = checkerSquarePx(cell)
  const key = `${light}|${dark}|${square}`

  const hit = cache.get(key)
  if (hit) return hit

  const pattern = buildPattern(ctx, light, dark, square)
  if (pattern === null) return blend(light, dark)

  cache.set(key, pattern)
  // A hit above never reinserts, so the map's own order is age and the first
  // key is the oldest.
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }

  return pattern
}

// Empties the cache. Nothing in the app calls it; a test that asserts on
// eviction or on identity needs to start from empty.
export function resetDitherCache() {
  cache.clear()
}

// Dark in the top-left, which puts a dark square at the pattern's origin and so
// at the world origin the caller anchors it to.
//
// Null only where the platform gives no 2D context, or where the tile has no
// area. `checkerSquarePx` clamps to one device pixel, which is what keeps the
// second out of reach.
function buildPattern(
  ctx: CanvasRenderingContext2D,
  light: string,
  dark: string,
  square: number,
): CanvasPattern | null {
  const tile = document.createElement('canvas')
  tile.width = square * 2
  tile.height = square * 2

  const into = tile.getContext('2d')
  if (into === null) return null

  into.fillStyle = light
  into.fillRect(0, 0, square * 2, square * 2)
  into.fillStyle = dark
  into.fillRect(0, 0, square, square)
  into.fillRect(square, square, square, square)

  return ctx.createPattern(tile, 'repeat')
}
