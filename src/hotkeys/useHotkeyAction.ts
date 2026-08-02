import { onMounted, onUnmounted } from 'vue'
import type { ActionId } from './keymap'
import { registerAction } from './actions'

// Registers `handler` for `id` only while the calling component is mounted.
// For actions that only make sense while a particular feature/mode owns them
// (e.g. delete-selection), unlike the always-on actions useHotkeys() registers
// permanently (mode switch, zoom).
export function useHotkeyAction(id: ActionId, handler: () => void) {
  let unregister: (() => void) | null = null
  onMounted(() => {
    unregister = registerAction(id, handler)
  })
  onUnmounted(() => {
    unregister?.()
  })
}
