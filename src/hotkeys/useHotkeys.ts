import { onMounted, onUnmounted } from 'vue'
import { useModeStore } from '@/stores/mode'
import { useTabsStore } from '@/stores/tabs'
import { useModelStore } from '@/stores/model'
import { isTextEntryTarget, normalizeCombo } from './combo'
import { defaultKeymap } from './keymap'
import { registerAction, runAction } from './actions'
import { resolveEscape } from './escStack'
import type { MapId } from '@/core/ids'

// Global keydown dispatcher. Call once, from the app root. Mode-switch and
// zoom are app-global and always relevant, so they're registered here
// permanently; everything else in the keymap has no handler yet and silently
// no-ops until the owning feature registers one via useHotkeyAction().
export function useHotkeys() {
  const modeStore = useModeStore()
  const tabsStore = useTabsStore()
  const model = useModelStore()

  function withActiveTab(action: (mapId: MapId) => void) {
    action(tabsStore.activeTabId)
  }

  const unregisterFns = [
    registerAction('mode.draw', () => modeStore.setMode('draw')),
    registerAction('mode.select', () => modeStore.setMode('select')),
    registerAction('mode.door', () => modeStore.setMode('door')),
    registerAction('mode.markup', () => modeStore.setMode('markup')),
    // Undo/redo are global rather than per-tab: one stack spans the whole
    // project, and a map-scoped step brings the tab back with it.
    registerAction('undo', () => model.undo()),
    registerAction('redo', () => model.redo()),
    registerAction('zoomIn', () => withActiveTab((id) => tabsStore.zoomIn(id))),
    registerAction('zoomOut', () => withActiveTab((id) => tabsStore.zoomOut(id))),
    registerAction('zoomReset', () => withActiveTab((id) => tabsStore.resetZoom(id))),
  ]

  function handleKeydown(event: KeyboardEvent) {
    // Global shortcuts are suppressed while editing text, including
    // Escape, which each editable field handles locally (revert its own
    // edit) rather than through the Esc precedence stack.
    if (isTextEntryTarget(event.target)) return

    if (event.key === 'Escape') {
      if (resolveEscape()) event.preventDefault()
      return
    }

    const combo = normalizeCombo(event)
    const actionId = combo ? defaultKeymap[combo] : undefined
    if (!actionId) return

    // Claim the combo to prevent the browser's own shortcut (e.g. Ctrl+S)
    // even if nothing is registered for it yet.
    event.preventDefault()
    runAction(actionId)
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
    unregisterFns.forEach((unregister) => unregister())
  })
}
