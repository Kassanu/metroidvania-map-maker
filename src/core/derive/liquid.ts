// Where a room's liquid surface sits.
//
// Three things are load-bearing here:
//
//   * The result is an EDGE coordinate; `bounds` holds cell indices, and the
//     two are one apart. Cell (x, y) occupies y to y + 1, so a room spanning
//     rows 0..2 has maxRow = 2 and a bottom edge at y = 3. Reading maxRow as
//     the bottom puts every level one cell too low.
//   * It is a world coordinate, not a room-local one, so it can be compared
//     against cell rows directly.
//   * It is deliberately not memoised. `roomBounds` caches against `room.rev`,
//     but the level bumps `metaRev`, so a cache keyed that way would go stale
//     on every move of the slider. What is left is two arithmetic operations
//     over a box that is already memoised.
//
// Nothing stores a surface and no operation adjusts a level: every row of the
// operation table falls out of this being recomputed from whatever the room's
// box is now.

import { roomBounds } from './walls'
import type { Room } from '../types'

// Null only when the room has no cells, and so no box to measure. Level 0 is
// an ordinary value that answers the bottom edge, level 100 the top.
export function liquidSurface(room: Room): number | null {
  const box = roomBounds(room)
  if (box === null) return null
  const height = box.maxRow - box.minRow + 1
  return box.maxRow + 1 - (room.liquidLevel / 100) * height
}
