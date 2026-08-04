// The ghosting model: everything a canvas gesture does that has nothing to do
// with which gesture it is. Split across three files:
//
//   - Here: open one transaction for the whole drag, mutate only through
//     `Gesture.reapply` so preview and commit are the same code path, hold
//     the absorb overlay, route `Esc` through the shared precedence stack's
//     `gesture` tier, and settle exactly once.
//   - `cellStroke.ts`: what makes a gesture free-form: the first cell locking
//     in on press, the union that only ever grows, and the brush footprint.
//   - `runResize.ts`: what makes a gesture structured: a pointer-derived
//     quantity that reverses when the pointer comes back.
//
// The two drivers differ in exactly one line of the contract: `extendTo`
// accumulates where `moveTo` replaces, which is the whole reason they are two
// drivers and not one with a flag.

import { useModelStore, mapScope } from '@/stores/model'
import { pushEscHandler } from '@/hotkeys/escStack'
import type { CellKey } from '@/core/cell'
import type { Transaction } from '@/core/journal'
import type { MapId } from '@/core/ids'

// What a live gesture looks like to the component holding it: something with a
// ghost to draw and two ways to end. Deliberately says nothing about how the
// pointer drives it, so `CanvasRegion` can hold "the gesture in progress"
// without knowing which one it is.
export interface GhostGesture {
  // Cells this gesture is about to take or destroy that the canvas could not
  // otherwise show, for the ghost overlay. Empty once settled, and
  // permanently empty for a gesture with nothing to warn about.
  readonly absorbing: ReadonlySet<CellKey>
  commit(): void
  cancel(): void
}

// A gesture driven by the cell the pointer is over, which is the shape both of
// Select mode's moves take. One name for one shape, so the caller can hold
// whichever granularity is in use without knowing which it got.
//
// `to` starts at the origin, so a drag that has not left its cell is already a
// no-op.
export interface CellMove extends GhostGesture {
  readonly to: CellKey
  moveTo(cell: CellKey): void
}

export interface GhostGestureSpec {
  mapId: MapId
  // Undo label for the whole drag: one gesture, one transaction.
  label: string
  // Repaint. The gesture calls it rather than invalidating, because nothing
  // publishes mid-drag.
  onChange: () => void
  // The gesture's whole effect, run against the pristine model on every
  // re-apply. It closes over whatever the driver above accumulates.
  apply(transaction: Transaction): void
  // Cells to highlight as about-to-be-taken, collected before `apply` on
  // every re-apply, while the map still describes the pre-gesture grid. That
  // ordering is the whole reason this is a hook rather than something the
  // overlay reads off the map afterwards: by draw time the cells belong to the
  // gesture's room and are indistinguishable from cells picked up off empty
  // grid. Omitted by any gesture whose destruction is already visible in the
  // speculative result.
  absorbing?(): ReadonlySet<CellKey>
  // Runs once, after a commit that actually happened, never after a cancel,
  // and never twice. Where a gesture puts the consequences that must not
  // happen for a preview: arming the active room is the whole current list, and
  // arming it speculatively would leave handles on a room that `Esc` un-made.
  onCommit?(): void
}

// The driver's half of the contract: re-run `apply` and repaint. Each gesture
// calls it when the thing it derives from the pointer has actually changed,
// never on every move.
export interface GhostGestureDriver extends GhostGesture {
  refresh(): void
  // Whether this gesture has already committed or aborted.
  //
  // A gesture that draws state of its own, rather than relying on the
  // speculative model to show it, needs this: the box drag's rectangle is in
  // no model, so nothing else takes it off the canvas when `Esc` settles the
  // drag mid-flight, and `Esc` arrives through the shared stack rather than
  // through the driver's caller, so the caller cannot know on its own.
  // `refresh` is already silent after settling; this is the same fact for a
  // gesture that has something to hide as well as something to stop.
  readonly settled: boolean
}

export const NO_CELLS: ReadonlySet<CellKey> = new Set()

export function beginGhostGesture(spec: GhostGestureSpec): GhostGestureDriver {
  const model = useModelStore()
  const gesture = model.beginGesture(spec.label, mapScope(spec.mapId))

  let absorbing: ReadonlySet<CellKey> = NO_CELLS

  // Settling is idempotent, because `Esc` followed by the pointerup that was
  // always coming is the normal abort sequence rather than a caller bug. The
  // seam's own `live` flag already makes the second `commit()` harmless, but
  // this flag is what stops `onCommit` running after a cancel: a rolled back
  // gesture must not arm handles on a room it un-made.
  let settled = false

  // Assigned immediately below; declared first only so `settle` can close over
  // it.
  let popEsc: () => void = () => {}

  function settle(finish: () => void): void {
    if (settled) return
    settled = true
    popEsc()
    finish()
    // The overlay has to go with the gesture: after a rollback the rooms it
    // highlighted are back, and after a commit they are genuinely gone.
    absorbing = NO_CELLS
    spec.onChange()
  }

  popEsc = pushEscHandler('gesture', () => settle(gesture.cancel))

  return {
    get absorbing() {
      return absorbing
    },
    get settled() {
      return settled
    },
    // Silent after settling rather than throwing: the pointer keeps moving for
    // as long as the button is down, and `Esc` mid-drag is a normal thing to
    // do, so moves after an abort are expected input and not an error.
    refresh() {
      if (settled) return
      gesture.reapply((transaction) => {
        absorbing = spec.absorbing?.() ?? NO_CELLS
        spec.apply(transaction)
      })
      spec.onChange()
    },
    commit: () =>
      settle(() => {
        gesture.commit()
        spec.onCommit?.()
      }),
    cancel: () => settle(gesture.cancel),
  }
}
