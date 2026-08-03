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
//
// `closes` is false for a surface whose open state is owned somewhere we cannot
// write to. Reka's ContextMenuRoot has no `open` prop, only an `update:open`
// emit, so `isOpen` there is a report rather than a control: writing false would
// release this tier while the menu is still on screen, and the next Escape
// would fall through to the selection underneath it. The layer's own Escape
// handling does the closing, and this only claims the tier until it has.
export function useDialogEscTier(isOpen: Ref<boolean>, closes = true) {
  let pop: (() => void) | null = null
  watch(
    isOpen,
    (open) => {
      if (open) {
        pop = pushEscHandler('dialog', () => {
          if (closes) isOpen.value = false
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
