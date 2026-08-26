// A range input that writes to the model, driven by the pointer.
//
// The ghosting model with a slider for a pointer: one transaction for the whole
// drag, re-applied against the pristine model on every sample, committed once
// on release. What makes it different from the canvas gestures beside it is
// where the events come from, and three rules follow from that:
//
//   - The transaction is scoped to the pointer and to nothing else. `change`
//     is never listened to: it fires on release only when the value changed, so
//     a click on the thumb or a drag away and back would leave a transaction
//     nothing closes, and an unclosed gesture suspends autosave for the rest of
//     the session. `pointerup` always fires.
//   - An `input` with no live gesture is a keypress, and commits immediately as
//     a discrete op. Whether a gesture is live is the whole discriminator; the
//     event itself cannot tell the two apart, since arrow keys raise the same
//     one a drag does.
//   - `Esc` and `pointercancel` abort, where the canvas commits: a stroke's
//     accumulated cells are unrecoverable work and a slider's value is one
//     number the user never released.
//
// Neither write happens while another gesture owns the journal. A second
// `beginGesture` is refused, and `model.run` takes no lock of its own, so the
// keyboard path asks before it commits.
//
// `requestRepaint` is imported rather than passed in: only committed changes
// reach the published counters, and a panel owns no `draw()`, so for a control
// out here the answer is always the same one.

import { mapScope, useModelStore } from '@/stores/model'
import { requestRepaint } from '@/canvas/repaint'
import { wasRefused } from '@/core/outcome'
import type { Gesture } from '@/stores/model'
import type { Transaction } from '@/core/journal'
import type { MapId } from '@/core/ids'

export interface RangeDragSpec {
  mapId: MapId
  // Undo label for the whole drag, and for one keyboard press.
  label: string
  // The whole effect, run against the pristine model on every re-apply.
  apply(transaction: Transaction, value: number): void
}

// `begin` answers nothing, deliberately. A refused start is absorbed here: the
// caller's only response is the snap-back it already does on release, since the
// control shows its own draft only while a drag is live.
export interface RangeDrag {
  begin(): void
  input(value: number): void
  end(): void
  abort(): void
  cancel(): void
}

// `dead` is a drag that must write nothing more but has not been released yet:
// after `Esc`, and after a start the seam refused. It is what stops the
// pointerup that follows from committing, and what keeps the samples between
// here and there from being read as keypresses.
type Phase = 'idle' | 'live' | 'dead'

export function createRangeDrag(spec: RangeDragSpec): RangeDrag {
  const model = useModelStore()
  let phase: Phase = 'idle'
  let gesture: Gesture | null = null

  function settle(finish: (live: Gesture) => void, next: Phase): void {
    const live = gesture
    phase = next
    gesture = null
    if (!live) return
    finish(live)
  }

  return {
    begin() {
      if (phase !== 'idle') return
      const started = model.beginGesture(spec.label, mapScope(spec.mapId))
      if (wasRefused(started)) {
        phase = 'dead'
        return
      }
      gesture = started
      phase = 'live'
    },

    input(value) {
      if (phase === 'dead') return
      if (phase === 'live') {
        gesture?.reapply((transaction) => spec.apply(transaction, value))
        requestRepaint()
        return
      }
      // No drag: a keypress, committed on its own. It stands down while
      // another gesture holds the journal, because a transaction opened
      // alongside one is rewound over by that gesture's next re-apply.
      if (model.gestureActive) return
      model.run(spec.label, mapScope(spec.mapId), (transaction) => spec.apply(transaction, value))
    },

    end() {
      settle((live) => live.commit(), 'idle')
    },

    abort() {
      settle((live) => {
        live.cancel()
        requestRepaint()
      }, 'idle')
    },

    // Only a live drag has anything to cancel. A press with no drag under it
    // must leave the phase alone: parked on `dead` with no pointerup coming,
    // it would swallow every arrow press after it.
    cancel() {
      if (phase !== 'live') return
      settle((live) => {
        live.cancel()
        requestRepaint()
      }, 'dead')
    },
  }
}
