// Peeling segments off the end of a line: the erase column's only gesture, and
// the first structured gesture on the erase route.
//
// `runResize`'s shape rather than a stroke's. The count is derived from the
// pointer and replaced on every move, so dragging back outward puts segments
// back: every re-apply runs one `peelLine` against the pristine model, so a
// segment still standing at count 0 was never removed rather than redrawn.
//
// The points are captured at press and never re-read. Re-reading them would
// feed the gesture its own output, because the speculative model holds the
// already-peeled line: the points the count is measured against would move
// every time the count changed, and the drag would stop being invertible.
//
// Where peeling stops being a shortening and becomes a deletion is `peelLine`'s
// to decide. The speculative result shows whichever it chose, so the ghost is
// honest before release without this file knowing the threshold.

import { beginGhostGesture, NO_CELLS, type GhostGesture } from './ghostGesture'
import { parseCell } from '@/core/cell'
import type { WorldPoint } from '@/canvas/stroke'
import type { CellKey } from '@/core/cell'
import type { Transaction } from '@/core/journal'
import type { MapId } from '@/core/ids'

export interface LinePeel extends GhostGesture {
  // Points that would come off if the drag ended now, counted from the grabbed
  // end. Zero at press, so a click peels nothing.
  readonly count: number
  moveTo(point: WorldPoint): void
}

export interface LinePeelSpec {
  mapId: MapId
  // The line's points at press, in stored order regardless of which end was
  // grabbed.
  points: readonly CellKey[]
  // Which end the press landed on: the count runs inward from it.
  atStart: boolean
  label: string
  onChange: () => void
  // Called with 0 whenever the pointer is back at the grabbed end. Recognising
  // that as no edit is the op layer's job, the way it is for every other
  // structured gesture: a zero peel must leave the transaction empty.
  apply(transaction: Transaction, count: number): void
}

export function beginLinePeel(spec: LinePeelSpec): LinePeel {
  const { points, atStart } = spec
  let count = 0

  const driver = beginGhostGesture({
    mapId: spec.mapId,
    label: spec.label,
    onChange: spec.onChange,
    apply: (transaction) => spec.apply(transaction, count),
    // Nothing to warn about: a peel destroys only the line's own segments, and
    // the speculative result has already taken them off.
    absorbing: () => NO_CELLS,
  })

  return {
    get absorbing() {
      return driver.absorbing
    },
    get count() {
      return count
    },
    moveTo(point: WorldPoint) {
      const next = countAt(points, atStart, point)
      // Gated on the count changing, like the resize's distance: moving within
      // one cell, or sideways off the line, is free.
      if (next === count) return
      count = next
      driver.refresh()
    },
    commit: driver.commit,
    cancel: driver.cancel,
  }
}

// The pointer's nearest point on the line, as a count from the grabbed end.
//
// Nearest rather than projected: a line bends and can double back, so there is
// no axis to project onto, and following the nearest point is what makes the
// count track the pointer along whatever shape was drawn.
//
// Scanned from the grabbed end outward, keeping the first of equal distances,
// so a pointer sitting between two points peels the fewer. The count cannot
// exceed `points.length - 1`, which leaves a single point: that is the case
// `peelLine` turns into a delete.
function countAt(points: readonly CellKey[], atStart: boolean, point: WorldPoint): number {
  let best = 0
  let bestDistance = Infinity
  for (let n = 0; n < points.length; n++) {
    const distance = squaredDistanceTo(points[atStart ? n : points.length - 1 - n], point)
    if (distance < bestDistance) {
      bestDistance = distance
      best = n
    }
  }
  return best
}

// Measured to the cell's centre, in cell units. Squared, because only the
// ordering is read.
function squaredDistanceTo(cell: CellKey, point: WorldPoint): number {
  const { x, y } = parseCell(cell)
  const dx = x + 0.5 - point.x
  const dy = y + 0.5 - point.y
  return dx * dx + dy * dy
}
