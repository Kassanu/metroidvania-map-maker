// Dragging an icon to another cell: the first gesture in the app that *moves*
// an object rather than creating, growing or destroying one.
//
// Structured, like `runResize` and unlike the strokes: the destination is a
// single cell derived from the pointer and **replaced** on every move, never
// accumulated. Every re-apply runs one `repositionIcon` against the pristine
// model, so dragging back to the origin leaves the icon exactly where it
// started rather than reconstructing it there, and the empty transaction the
// seam drops means no undo step for a move that went nowhere.
//
// A refused destination applies nothing, so the icon simply stays put in the
// speculative model. That is why the caller shows the refusal on the cursor:
// "did not move" and "cannot move here" look identical otherwise.
//
// Deliberately not Door mode's rule. Transitions are never dragged or moved
// directly, and an icon is the opposite case: it is cell-anchored, and moving
// it into another room re-owns it with no cascade at all, because ownership is
// derived from the cell rather than stored.

import { beginGhostGesture, NO_CELLS, type GhostGesture } from './ghostGesture'
import type { CellKey } from '@/core/cell'
import type { Transaction } from '@/core/journal'
import type { MapId } from '@/core/ids'

export interface IconDrag extends GhostGesture {
  // The cell the icon would land on if released now. Starts at its own cell,
  // so a drag that has not left it is already a no-op.
  readonly to: CellKey
  moveTo(cell: CellKey): void
}

export interface IconDragSpec {
  mapId: MapId
  from: CellKey
  label: string
  onChange: () => void
  // The move, run against the pristine model on every re-apply. Refusals are
  // the caller's to interpret: from here a refused move is simply one that
  // applied nothing.
  apply(transaction: Transaction, to: CellKey): void
}

export function beginIconDrag(spec: IconDragSpec): IconDrag {
  let to = spec.from

  const driver = beginGhostGesture({
    mapId: spec.mapId,
    label: spec.label,
    onChange: spec.onChange,
    apply: (transaction) => spec.apply(transaction, to),
    // An icon takes nothing from anything: replacing one on the destination
    // cell removes that icon, which the speculative result already shows.
    absorbing: () => NO_CELLS,
  })

  return {
    get to() {
      return to
    },
    get absorbing() {
      return driver.absorbing
    },
    moveTo(cell: CellKey) {
      if (cell === to) return
      to = cell
      driver.refresh()
    },
    commit: driver.commit,
    cancel: driver.cancel,
  }
}
