import { onUnmounted, watch, type Ref } from 'vue'
import { pushEscHandler } from './escStack'

// Registers presence on the Esc precedence stack's 'dialog' tier for as long
// as `isOpen` is true. Reka's Dialog already closes itself on Escape via its
// own internal DismissableLayer (this doesn't replace that; harmless if both
// fire, setting `isOpen` false twice is a no-op). Without it, our global
// dispatcher (useHotkeys.ts) has no way to know a dialog is open, so on the
// same Escape press it would also resolve whatever's in a lower tier
// (an in-progress gesture, a selection), with two things responding to one
// Escape instead of "first match wins."
export function useDialogEscTier(isOpen: Ref<boolean>) {
  let pop: (() => void) | null = null
  watch(
    isOpen,
    (open) => {
      if (open) {
        pop = pushEscHandler('dialog', () => {
          isOpen.value = false
        })
      } else {
        pop?.()
        pop = null
      }
    },
    { immediate: true },
  )

  // In case the component unmounts while still open (e.g. an unexpected
  // teardown): don't leave a stale handler registered forever.
  onUnmounted(() => {
    pop?.()
    pop = null
  })
}
