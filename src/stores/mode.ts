import { defineStore } from 'pinia'
import type { MessageKey } from '@/i18n'
import type { ActionId } from '@/hotkeys/keymap'

export type Mode = 'draw' | 'select' | 'door' | 'markup'

// Registries carry message keys, not text. The component that renders one
// calls t(), so the label follows the active locale. Likewise `actionId`
// rather than a literal key: the displayed shortcut is looked up in the
// keymap, so remapping a mode key updates the tooltip automatically instead
// of silently leaving it lying.
export const MODES: { id: Mode; labelKey: MessageKey; actionId: ActionId }[] = [
  { id: 'draw', labelKey: 'mode.draw', actionId: 'mode.draw' },
  { id: 'select', labelKey: 'mode.select', actionId: 'mode.select' },
  { id: 'door', labelKey: 'mode.door', actionId: 'mode.door' },
  { id: 'markup', labelKey: 'mode.markup', actionId: 'mode.markup' },
]

export const useModeStore = defineStore('mode', {
  state: () => ({
    active: 'draw' as Mode,
  }),
  actions: {
    setMode(mode: Mode) {
      this.active = mode
    },
  },
})
