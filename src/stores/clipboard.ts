// The one clipboard slot.
//
// App-scope, not per-tab: copying on one map and pasting on another is the
// point, and a per-tab clipboard would make cross-tab paste impossible rather
// than merely unusual.
//
// Not the system clipboard. In-app only, so nothing here serialises and nothing
// arrives from outside the app. `sourceOrigin` on the payload is named as
// though that will change one day.
//
// `shallowRef` rather than `ref`: a payload is a plain value replaced whole on
// every copy, and deep reactivity over its cell arrays would cost a proxy per
// entry for a value nothing ever mutates in place.

import { defineStore } from 'pinia'
import { computed, shallowRef, watch } from 'vue'
import { emptyClipboard, isClipboardEmpty, type ClipboardPayload } from '@/core/ops/clipboard'
import { useModelStore } from './model'

export const useClipboardStore = defineStore('clipboard', () => {
  const model = useModelStore()
  const payload = shallowRef<ClipboardPayload>(emptyClipboard())

  function put(next: ClipboardPayload): void {
    payload.value = next
  }

  // A payload names areas from the project it was copied out of, so it cannot
  // outlive that project. Pasting one into a project opened over the top
  // creates a room whose area does not exist, which breaks an invariant every
  // consumer is entitled to assume holds.
  //
  // Watches the project's identity rather than a revision counter: only
  // `replaceProject` swaps it, and that is exactly the event that invalidates
  // a payload. Copying on one map and pasting on another within one project is
  // the whole point of an app-scoped clipboard and is untouched.
  //
  // Flush sync, like the other stores that prune: nothing may read the stale
  // payload between the swap and the clear.
  watch(
    () => model.project,
    () => {
      payload.value = emptyClipboard()
    },
    { flush: 'sync' },
  )

  return {
    payload: computed(() => payload.value),
    // Whether a paste would produce anything. Asked by the menus, so an empty
    // clipboard refuses before the click rather than after it.
    isEmpty: computed(() => isClipboardEmpty(payload.value)),
    put,
  }
})
