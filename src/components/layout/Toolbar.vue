<script setup lang="ts">
import { computed } from 'vue'
import ZoomControl from '../ZoomControl.vue'
import DrawToolbar from './DrawToolbar.vue'
import SelectToolbar from './SelectToolbar.vue'
import DoorToolbar from './DoorToolbar.vue'
import MarkupToolbar from './MarkupToolbar.vue'

import { useModeStore } from '@/stores/mode'
import { useUiStore } from '@/stores/ui'
import { useModelStore } from '@/stores/model'
import { combosForAction } from '@/hotkeys/keymap'
import { formatCombo } from '@/hotkeys/combo'
import type { ActionId } from '@/hotkeys/keymap'
import { t } from '@/i18n'

const modeStore = useModeStore()
const ui = useUiStore()
const model = useModelStore()

// The first combo the keymap binds to the action, in insertion order: redo has
// two, and the tooltip has room for one. The other stays in the cheat sheet.
function primaryCombo(actionId: ActionId): string {
  const [combo] = combosForAction(actionId)
  return combo ? formatCombo(combo) : ''
}

// "Undo Paint (Ctrl+Z)": the step name is the transaction's own, so the button
// says what it would revert. It falls back to the bare verb on an empty stack,
// where there is nothing to name. The chord is derived, never written down.
const undoTitle = computed(() => {
  const combo = primaryCombo('undo')
  return model.status.undoLabel
    ? t('toolbar.undoStep', { label: model.status.undoLabel, combo })
    : t('toolbar.undo', { combo })
})

const redoTitle = computed(() => {
  const combo = primaryCombo('redo')
  return model.status.redoLabel
    ? t('toolbar.redoStep', { label: model.status.redoLabel, combo })
    : t('toolbar.redo', { combo })
})
</script>

<template>
  <div class="toolbar" role="toolbar" :aria-label="t('toolbar.label')">
    <div class="toolbar-group persistent">
      <ZoomControl />
      <span class="toolbar-divider" aria-hidden="true" />
      <!-- Straight to the store, the same call the Edit menu makes: both
           surfaces mean "move the stack", so neither goes through an action. -->
      <button
        type="button"
        class="toolbar-button undo-button"
        :title="undoTitle"
        :disabled="!model.status.canUndo"
        @click="model.undo()"
      >
        ↶
      </button>
      <button
        type="button"
        class="toolbar-button redo-button"
        :title="redoTitle"
        :disabled="!model.status.canRedo"
        @click="model.redo()"
      >
        ↷
      </button>
    </div>
    <span class="toolbar-divider" aria-hidden="true" />
    <!-- One component per mode, and every mode has one. -->
    <DrawToolbar v-if="modeStore.active === 'draw'" />
    <SelectToolbar v-else-if="modeStore.active === 'select'" />
    <DoorToolbar v-else-if="modeStore.active === 'door'" />
    <MarkupToolbar v-else-if="modeStore.active === 'markup'" />
    <button
      type="button"
      class="toolbar-button zen-toggle-button"
      :title="t('toolbar.zenTitle')"
      :aria-pressed="ui.zenMode"
      @click="ui.toggleZenMode()"
    >
      {{ t('toolbar.zen') }}
    </button>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  min-height: 2.5rem;
}

:deep(.toolbar-group) {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
:deep(.toolbar-group.dynamic) {
  color: var(--fg);
  opacity: 0.75;
  font-size: 0.875rem;
}

:deep(.toolbar-button) {
  min-width: 2rem;
  height: 2rem;
  padding: 0 0.5rem;
  border: none;
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
}
/* :hover matches a disabled button, so the highlight has to exclude it or a
 * button that cannot be pressed lights up under the pointer. One rule for the
 * whole bar rather than one per button: undo, redo and the brush steppers all
 * disable, and every mode's section inherits these. */
:deep(.toolbar-button:hover:not(:disabled)) {
  background: var(--surface-active);
}
:deep(.toolbar-button:disabled) {
  opacity: 0.4;
  cursor: default;
}
/* Every toggle in the bar reads the same way pressed: Zen, erase, and the
 * sub-mode lock when it arrives. One rule rather than one per button. */
:deep(.toolbar-button[aria-pressed='true']) {
  background: var(--accent);
  color: #fff;
}

:deep(.toolbar-divider) {
  width: 1px;
  height: 1.5rem;
  background: var(--border);
}

:deep(.zen-toggle-button) {
  margin-left: auto;
  font-size: 0.8125rem;
}
</style>
