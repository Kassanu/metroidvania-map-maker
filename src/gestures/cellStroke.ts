// The free-form cell stroke: the loop paint and erase both are. Erase is the
// same loop with `eraseCells` in place of `paintCells`. What is left in each
// gesture is only what actually differs: the undo label, and what one
// `reapply` does with the accumulated cells.
//
// `ghostGesture.ts` owns the transaction, the `Esc` tier, the absorb overlay
// and the once-only settle. What is left here is exactly what makes a gesture
// free-form:
//
//   - the first cell locks in on press, before anything moves, which is what
//     makes a click just a stroke whose union is one cell: neither paint nor
//     erase consults the click/drag distinction;
//   - the union only ever grows: backtracking does not un-paint, because a
//     free-form path cannot cleanly invert. Structured gestures (resize, move,
//     door box) do reverse; `runResize.ts` is the first of them, a different
//     driver rather than an option on this one;
//   - the brush footprint, which applies to paint, grow and erase and to
//     nothing else.
//
// It owns no DOM and resolves no map: the caller hands in world points and a
// body that already closes over what it needs, which is what lets the rules be
// tested without jsdom.

import { beginGhostGesture, type GhostGesture } from './ghostGesture'
import { useToolsStore } from '@/stores/tools'
import { cellsAlong, type WorldPoint } from '@/canvas/stroke'
import { brushCellsAt, brushOffset } from '@/canvas/brush'
import { cellKey } from '@/core/cell'
import type { CellKey } from '@/core/cell'
import type { Transaction } from '@/core/journal'
import type { MapId } from '@/core/ids'

export interface CellStroke extends GhostGesture {
  // The accumulated union of every cell the stroke has touched. Read live:
  // the same set is mutated in place as the drag goes on.
  readonly cells: ReadonlySet<CellKey>
  // Extend the stroke to a world point, adding every cell the segment from the
  // last point crossed. Repaints via `onChange` only when the union actually
  // grew, which most moves in a real drag do not.
  extendTo(point: WorldPoint): void
}

export interface CellStrokeSpec {
  mapId: MapId
  origin: WorldPoint
  // Undo label for the whole stroke: one gesture, one transaction.
  label: string
  // Repaint. The gesture calls it rather than invalidating, because nothing
  // publishes mid-drag.
  onChange: () => void
  // What the stroke does to the accumulated cells, run against the pristine
  // model on every re-apply.
  apply(transaction: Transaction, cells: ReadonlySet<CellKey>): void
  // See `GhostGestureSpec.onCommit`.
  onCommit?(): void
  // See `GhostGestureSpec.absorbing`: the same hook, handed the union so a
  // stroke does not have to keep a second reference to it.
  absorbing?(cells: ReadonlySet<CellKey>): ReadonlySet<CellKey>
}

export function beginCellStroke(spec: CellStrokeSpec): CellStroke {
  // Locked at press time, like the origin room. `[` and `]` still work while
  // the button is down, but the stroke that is already running keeps the size
  // it started with: the union is re-applied from scratch on every move, so a
  // live size would silently re-stamp the whole stroke at the new width
  // rather than only what is painted from here on. Locking it makes a stroke
  // mean one thing for its whole length.
  const size = useToolsStore().brushSize

  // The footprint applies to paint, grow and erase alike, every gesture built
  // on this driver, and to nothing else. Resize and inner walls use a
  // different driver, which is how brush size applying only to paint, grow
  // and erase holds structurally rather than by a check somewhere.
  //
  // The offset comes from the pointer's sub-cell position, which only the
  // sample points have: the cells a segment crossed in between were
  // interpolated and have none of their own. So it is taken once per sample and
  // applied to every cell that sample's segment crossed. At a few dozen samples
  // a second the pointer moves about a cell between them, so the difference is
  // invisible; the alternative is inventing a sub-cell position that was never
  // measured.
  function stamp(crossed: Iterable<CellKey>, at: WorldPoint): CellKey[] {
    if (size === 1) return [...crossed]
    const offset = brushOffset(at, size)
    const stamped: CellKey[] = []
    for (const cell of crossed) stamped.push(...brushCellsAt(cell, size, offset))
    return stamped
  }

  const cells = new Set<CellKey>(stamp([cellOf(spec.origin)], spec.origin))
  let last = spec.origin

  const driver = beginGhostGesture({
    mapId: spec.mapId,
    label: spec.label,
    onChange: spec.onChange,
    onCommit: spec.onCommit,
    apply: (transaction) => spec.apply(transaction, cells),
    absorbing: spec.absorbing && (() => spec.absorbing!(cells)),
  })

  // The first cell locks in on press.
  driver.refresh()

  return {
    cells,
    get absorbing() {
      return driver.absorbing
    },
    extendTo(point: WorldPoint) {
      const crossed = stamp(cellsAlong(last, point), point)
      // Updated even when nothing was added, so the next segment starts from
      // where the pointer actually is rather than from the last cell it grew.
      last = point

      let grew = false
      for (const cell of crossed) {
        if (cells.has(cell)) continue
        cells.add(cell)
        grew = true
      }
      // Backtracking does not un-paint: the union only ever grows, so a move
      // back over touched cells is not a change and costs nothing.
      if (grew) driver.refresh()
    },
    commit: driver.commit,
    cancel: driver.cancel,
  }
}

function cellOf(point: WorldPoint): CellKey {
  return cellKey(Math.floor(point.x), Math.floor(point.y))
}
