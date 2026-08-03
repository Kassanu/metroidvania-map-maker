<script setup lang="ts">
import { useToolsStore } from '@/stores/tools'
import { t, type MessageKey } from '@/i18n'
import type { SelectSubMode } from '@/canvas/selectTarget'

// Select mode's half of the toolbar's dynamic section: what a press selects,
// and nothing else. A mode toggle, not a selection editor. Editing what is
// selected is the Inspector's job, and every column of the table is a pointer
// gesture or a key.
//
// `enabled` rather than a filtered list, so the disabled half is visible and
// says what it is instead of being missing. Cells resolves and is tested, but
// nothing consumes a cell selection and no cell gesture exists, so a live
// toggle would offer a granularity where every press resolves correctly and
// then does nothing.
const GRANULARITY = [
  { mode: 'rooms', label: 'toolbar.select.rooms', enabled: true },
  { mode: 'cells', label: 'toolbar.select.cells', enabled: false },
] as const satisfies readonly { mode: SelectSubMode; label: MessageKey; enabled: boolean }[]

const tools = useToolsStore()
</script>

<template>
  <div class="toolbar-group dynamic" role="group" :aria-label="t('toolbar.select.label')">
    <span class="granularity-label">{{ t('toolbar.select.granularity') }}</span>
    <div
      class="granularity"
      role="radiogroup"
      :aria-label="t('toolbar.select.granularity')"
      :title="t('toolbar.select.granularityTitle')"
    >
      <button
        v-for="option in GRANULARITY"
        :key="option.mode"
        type="button"
        class="toolbar-button granularity-button"
        role="radio"
        :disabled="!option.enabled"
        :aria-checked="tools.selectSubMode === option.mode"
        :class="{ active: tools.selectSubMode === option.mode }"
        :title="option.enabled ? undefined : t('toolbar.select.cellsUnavailable')"
        @click="tools.setSelectSubMode(option.mode)"
      >
        {{ t(option.label) }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Everything else is Toolbar.vue's :deep rules, so these controls cannot drift
 * away from the ones beside them. */
.granularity-label {
  font-size: 0.8125rem;
  opacity: 0.75;
}
.granularity {
  display: flex;
  gap: 0.125rem;
}
.granularity-button {
  font-size: 0.8125rem;
}
/* Tracks aria-checked, so the visual and the accessible state cannot drift. */
.granularity-button.active {
  background: var(--accent-soft, var(--surface-raised));
  font-weight: 600;
}
.granularity-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
