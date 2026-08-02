<script setup lang="ts">
import { useUiStore } from '@/stores/ui'
import { buildCheatSheet } from '@/hotkeys/cheatSheet'
import { formatCombo } from '@/hotkeys/combo'
import { useHotkeyAction } from '@/hotkeys/useHotkeyAction'
import { t } from '@/i18n'
import BaseModal from './BaseModal.vue'

const ui = useUiStore()

const sections = buildCheatSheet()

useHotkeyAction('cheatSheet', () => ui.toggleCheatSheet())
</script>

<template>
  <BaseModal
    v-model:open="ui.cheatSheetOpen"
    :title="t('modal.cheatSheet.title')"
    :description="t('modal.cheatSheet.description')"
    width="56rem"
  >
    <div class="cheat-sheet-grid">
      <section v-for="section in sections" :key="section.labelKey" class="cheat-sheet-section">
        <table class="cheat-sheet-table">
          <caption class="cheat-sheet-section-title">
            {{
              t(section.labelKey)
            }}
          </caption>
          <tbody>
            <tr v-for="row in section.rows" :key="row.labelKey">
              <th scope="row" class="cheat-sheet-action">{{ t(row.labelKey) }}</th>
              <td class="cheat-sheet-combo">
                <kbd v-for="combo in row.combos" :key="combo" class="cheat-sheet-key">
                  {{ formatCombo(combo) }}
                </kbd>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </BaseModal>
</template>

<style scoped>
.cheat-sheet-grid {
  columns: 2;
  column-gap: 2rem;
}

.cheat-sheet-section {
  break-inside: avoid-column;
  margin-bottom: 1rem;
}

.cheat-sheet-table {
  width: 100%;
  border-collapse: collapse;
}

.cheat-sheet-section-title {
  caption-side: top;
  text-align: left;
  font-size: 0.8125rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg);
  opacity: 0.6;
  padding-bottom: 0.375rem;
}

.cheat-sheet-action {
  text-align: left;
  font-weight: 400;
  padding: 0.25rem 0.5rem 0.25rem 0;
  white-space: nowrap;
}

.cheat-sheet-combo {
  text-align: right;
  padding: 0.25rem 0;
  width: 100%;
}

.cheat-sheet-key {
  display: inline-block;
  font: inherit;
  font-size: 0.8125rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  padding: 0.0625rem 0.375rem;
  margin-left: 0.25rem;
}
</style>
