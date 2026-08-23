// What a gesture factory answers when it could not start, in one place.
//
// Two reasons, and the whole layer says "could not start" with this union
// rather than with a `| null` beside it: two ways to say one thing inside one
// layer is what the return convention exists to prevent.
//
//   - `gesture-live`: one transaction is already open. `reapply` rewinds and
//     replays the whole gesture against a journal stack that takes no lock, so
//     two live transactions interleave their rewinds and corrupt it.
//   - `no-target`: the thing this gesture works on is not there. A missing map,
//     a missing room, or a selection holding nothing that can be moved.
//
// Not entries in the app-wide `RefusalReason`, whose contract is one translated
// message per reason: neither of these has anything to tell the user. The
// caller's answer to both is the same, and it is "do not start this drag".

import type { Refused } from '@/core/outcome'

export type GestureRefusal = 'gesture-live' | 'no-target'

export type GestureStart<T> = T | Refused<GestureRefusal>

// The layer's own constructor, because `refuse` in `core/outcome.ts` is
// constrained to `RefusalReason` and keeping it that way is what stops the
// app-wide union drifting open.
export function refuseGesture(reason: GestureRefusal): Refused<GestureRefusal> {
  return { refused: reason }
}
