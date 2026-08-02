<script setup lang="ts">
import ZoomControl from '../ZoomControl.vue'
import DrawToolbar from './DrawToolbar.vue'
import DoorToolbar from './DoorToolbar.vue'

import { computed } from 'vue'
import { useModeStore } from '@/stores/mode'
import { useUiStore } from '@/stores/ui'
import { t } from '@/i18n'

const modeStore = useModeStore()
const ui = useUiStore()

// Placeholder text for the modes whose tools are unbuilt. Draw and Door have
// real components instead: see the template.
const modeOptionsLabel = computed(() => {
  switch (modeStore.active) {
    case 'select':
      return t('toolbar.modeOptions.select')
    case 'markup':
      return t('toolbar.modeOptions.markup')
    default:
      return ''
  }
})
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
    <DrawToolbar v-if="modeStore.active === 'draw'" />
    <DoorToolbar v-else-if="modeStore.active === 'door'" />
    <div v-else class="toolbar-group dynamic">{{ modeOptionsLabel }}</div>
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
