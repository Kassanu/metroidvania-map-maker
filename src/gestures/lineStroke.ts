// The markup line drag: draw a new line, or extend an existing one from either
// end. One driver, because the two differ only in what `apply` does with the
// accumulated path.
//
// `ghostGesture.ts` owns the transaction, the `Esc` tier and the once-only
// settle. What is left here is the path itself, and it is a third shape beside
// the two drivers already there:
//
//   - `cellStroke.ts` accumulates a *set*, where order cannot matter and
//     backtracking cannot un-paint;
//   - `runResize.ts` derives a *quantity* that is replaced, so backtracking
//     reverses it;
//   - this accumulates an ordered *path*, which grows the way the set does but
//     where order is the whole content. Dragging back over the path appends
//     the way back rather than undoing it, which is what the locked rule "each
//     step adds a unit segment" says and what the renderer's round joins were
//     built for.
//
// Every move interpolates. `normalizePath` stops at the first step that is not
// 8-adjacent and drops the rest of the path, and a pointer sampled a few dozen
// times a second jumps several cells at speed, so a gesture that pushed raw
// samples would produce a line quietly shorter than the one drawn.
//
// It owns no DOM and resolves no map: the caller hands in world points and an
// `apply` that already closes over what it needs.

import { beginGhostGesture, NO_CELLS, type GhostGesture } from './ghostGesture'
import { stepsAlong, type WorldPoint } from '@/canvas/stroke'
import { parseCell } from '@/core/cell'
import type { CellKey } from '@/core/cell'
import type { Transaction } from '@/core/journal'
import type { MapId } from '@/core/ids'

export interface LineStroke extends GhostGesture {
  // The path so far, in draw order. Read live: the same array grows as the
  // drag goes on.
  readonly points: readonly CellKey[]
  // Extend to a world point, appending every cell of an 8-connected walk from
  // the last one. Repaints only when the path actually grew, which most moves
  // in a real drag do not.
  extendTo(point: WorldPoint): void
}

export interface LineStrokeSpec {
  mapId: MapId
  // Where the path starts: the pressed cell for a new line, the line's own
  // endpoint for an extend.
  origin: CellKey
  label: string
  onChange: () => void
  // What the path means, run against the pristine model on every re-apply.
  apply(transaction: Transaction, points: readonly CellKey[]): void
}

export function beginLineStroke(spec: LineStrokeSpec): LineStroke {
  const points: CellKey[] = [spec.origin]

  const driver = beginGhostGesture({
    mapId: spec.mapId,
    label: spec.label,
    onChange: spec.onChange,
    apply: (transaction) => spec.apply(transaction, points),
    // Nothing to warn about: a line takes no cells from anything. It has no
    // room owner, and drawing one over a room, a door or another line destroys
    // none of them.
    absorbing: () => NO_CELLS,
  })

  return {
    points,
    get absorbing() {
      return driver.absorbing
    },
    extendTo(point: WorldPoint) {
      const last = points[points.length - 1]
      const walk = stepsAlong(cellCentreOf(last), point)
      // The walk starts in the cell we are already on, so the first entry is
      // always a repeat.
      if (walk.length < 2) return
      points.push(...walk.slice(1))
      driver.refresh()
    },
    commit: driver.commit,
    cancel: driver.cancel,
  }
}

// The walk is measured from the centre of the cell the path is standing in
// rather than from the pointer's last position. Using the raw sample would let
// sub-cell drift decide which neighbour a step lands on, so an unmoved pointer
// could still change the path.
function cellCentreOf(cell: CellKey): WorldPoint {
  const { x, y } = parseCell(cell)
  return { x: x + 0.5, y: y + 0.5 }
}
