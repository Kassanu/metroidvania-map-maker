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
import { computed, shallowRef } from 'vue'
import { emptyClipboard, isClipboardEmpty, type ClipboardPayload } from '@/core/ops/clipboard'

export const useClipboardStore = defineStore('clipboard', () => {
  const payload = shallowRef<ClipboardPayload>(emptyClipboard())

  function put(next: ClipboardPayload): void {
    payload.value = next
  }

  return {
    payload: computed(() => payload.value),
    // Whether a paste would produce anything. Asked by the menus, so an empty
    // clipboard refuses before the click rather than after it.
    isEmpty: computed(() => isClipboardEmpty(payload.value)),
    put,
  }
})
