<script setup lang="ts">
import { useModeStore, MODES } from '@/stores/mode'
import { combosForAction } from '@/hotkeys/keymap'
import { formatCombo } from '@/hotkeys/combo'
import { t } from '@/i18n'
import type { ActionId } from '@/hotkeys/keymap'
import type { MessageKey } from '@/i18n'

const modeStore = useModeStore()

// "Draw/Edit (1)": the key comes from the keymap, so a remap is reflected
// here without touching MODES.
function modeTitle(labelKey: MessageKey, actionId: ActionId): string {
  const [combo] = combosForAction(actionId)
  const label = t(labelKey)
  return combo ? `${label} (${formatCombo(combo)})` : label
}
</script>

<template>
  <nav class="activity-bar" :aria-label="t('activityBar.label')">
    <button
      v-for="mode in MODES"
      :key="mode.id"
      type="button"
      class="mode-button"
      :class="{ active: modeStore.active === mode.id }"
      :aria-pressed="modeStore.active === mode.id"
      :title="modeTitle(mode.labelKey, mode.actionId)"
      @click="modeStore.setMode(mode.id)"
    >
      {{ t(mode.labelKey)[0] }}
    </button>
  </nav>
</template>

<style scoped>
.activity-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem 0.375rem;
  width: 3rem;
  background: var(--surface);
  border-right: 1px solid var(--border);
}

.mode-button {
  width: 2.25rem;
  height: 2.25rem;
  border: none;
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-weight: 600;
  cursor: pointer;
}
.mode-button:hover {
  background: var(--surface-active);
}
.mode-button.active {
  background: var(--accent);
  color: #fff;
}
</style>
