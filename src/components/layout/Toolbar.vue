<script setup lang="ts">
import ZoomControl from '../ZoomControl.vue'
import DrawToolbar from './DrawToolbar.vue'
import SelectToolbar from './SelectToolbar.vue'
import DoorToolbar from './DoorToolbar.vue'
import MarkupToolbar from './MarkupToolbar.vue'

import { useModeStore } from '@/stores/mode'
import { useUiStore } from '@/stores/ui'
import { t } from '@/i18n'

const modeStore = useModeStore()
const ui = useUiStore()
</script>

<template>
  <div class="toolbar" role="toolbar" :aria-label="t('toolbar.label')">
    <div class="toolbar-group persistent">
      <ZoomControl />
      <span class="toolbar-divider" aria-hidden="true" />
      <button type="button" class="toolbar-button" :title="t('toolbar.undo')">↶</button>
      <button type="button" class="toolbar-button" :title="t('toolbar.redo')">↷</button>
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
:deep(.toolbar-button:hover) {
  background: var(--surface-active);
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
