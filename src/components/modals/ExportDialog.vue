<script setup lang="ts">
// Picking what to export, and how it is packaged.
//
// The tree is tab -> area -> room, one level deeper than the Hierarchy panel it
// resembles: rooms are per-tab and areas are project-wide, so the same area
// appears under several tabs holding different rooms, and ticking one takes
// exactly the rooms shown beneath it. `ScopeTree.vue` draws it and
// `scopeTree.ts` does the tri-state arithmetic; this file owns the packaging
// choice, the count and the run.
//
// A tab is empty here when it holds no rooms, which is this exporter's own
// predicate: any subset of the project is legal JSON, so a tab with nothing in
// it is the only thing that cannot contribute.
//
// Reporting the outcome belongs to `useExportRun`, which every export dialog
// shares.

import { computed, ref, watch } from 'vue'
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import BaseModal from './BaseModal.vue'
import ScopeTree from './ScopeTree.vue'
import { dependOn, useModelStore } from '@/stores/model'
import { useUiStore } from '@/stores/ui'
import { exportProjectJson, jsonScopeEmpty } from '@/export'
import type { ExportPackaging } from '@/export'
import { allLeaves, buildScopeTree, countOf, scopeOf } from '@/export/scopeTree'
import type { LeafId } from '@/export/scopeTree'
import { useExportRun } from '@/export/useExportRun'
import { t } from '@/i18n'
import type { MessageKey } from '@/i18n'

const model = useModelStore()
const ui = useUiStore()

const tree = computed(() => {
  dependOn(model.rev, model.structureRev)
  return buildScopeTree(model.project, { leaf: 'room', isEmpty: jsonScopeEmpty })
})

const selected = ref<Set<LeafId>>(new Set())
const packaging = ref<ExportPackaging>('combined')
const { busy, run: attemptExport } = useExportRun()

// Everything ticked on every opening, and nothing carried over from the last
// one: a remembered subset would silently omit a tab the user had forgotten
// was unticked, and the omission is invisible until something downstream is
// missing a room.
watch(
  () => ui.exportOpen,
  (open) => {
    if (!open) return
    selected.value = allLeaves(tree.value)
  },
  { immediate: true },
)

const count = computed(() => countOf(tree.value, selected.value))
const nothingSelected = computed(() => count.value.leaves === 0)

// Keys rather than resolved strings: `t` reads the locale ref, so resolving
// here would freeze both labels at whatever language was current when the
// module loaded.
const PACKAGING_OPTIONS: { value: ExportPackaging; labelKey: MessageKey; hintKey: MessageKey }[] = [
  {
    value: 'combined',
    labelKey: 'modal.export.combined',
    hintKey: 'modal.export.combinedHint',
  },
  {
    value: 'per-room',
    labelKey: 'modal.export.perRoom',
    hintKey: 'modal.export.perRoomHint',
  },
]

async function run(): Promise<void> {
  if (nothingSelected.value) return
  const outcome = await attemptExport(() =>
    exportProjectJson(model.project, {
      packaging: packaging.value,
      scope: scopeOf(tree.value, selected.value),
    }),
  )
  if (outcome === 'close') ui.exportOpen = false
}
</script>

<template>
  <BaseModal
    v-model:open="ui.exportOpen"
    :title="t('modal.export.title')"
    :description="t('modal.export.description')"
    width="30rem"
  >
    <div class="export-body">
      <section class="export-section">
        <h3 class="export-heading">{{ t('modal.export.scope') }}</h3>
        <ScopeTree
          v-model:selected="selected"
          :tree="tree"
          :label="t('modal.export.scope')"
          :empty-note="t('modal.export.emptyTab')"
        />
        <p class="export-count">
          {{
            nothingSelected
              ? t('modal.export.nothing')
              : t('modal.export.count', { tabs: count.tabs, rooms: count.leaves })
          }}
        </p>
      </section>

      <section class="export-section">
        <h3 class="export-heading">{{ t('modal.export.packaging') }}</h3>
        <RadioGroupRoot v-model="packaging" class="export-packaging">
          <label v-for="option in PACKAGING_OPTIONS" :key="option.value" class="export-option">
            <RadioGroupItem :value="option.value" class="export-radio">
              <RadioGroupIndicator class="export-radio-dot" />
            </RadioGroupItem>
            <span class="export-option-text">
              <span class="export-option-label">{{ t(option.labelKey) }}</span>
              <span class="export-option-hint">{{ t(option.hintKey) }}</span>
            </span>
          </label>
        </RadioGroupRoot>
      </section>

      <div class="export-actions">
        <button type="button" class="export-cancel" @click="ui.exportOpen = false">
          {{ t('common.cancel') }}
        </button>
        <button
          type="button"
          class="export-confirm"
          :disabled="nothingSelected || busy"
          @click="run"
        >
          {{ busy ? t('modal.export.working') : t('modal.export.confirm') }}
        </button>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
.export-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.export-section {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.export-heading {
  margin: 0;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.7;
}

.export-count {
  font-size: 0.75rem;
  opacity: 0.7;
  margin: 0;
}

.export-packaging {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.export-option {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  cursor: pointer;
}

.export-radio {
  /* Sized as a box with an inner dot rather than as a thick border: a border
     that thick on a button collapses the circle into an oval. */
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  flex: none;
  padding: 0;
  margin-top: 0.125rem;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--bg);
  cursor: pointer;
}

.export-radio[data-state='checked'] {
  border-color: var(--accent);
}

.export-radio-dot {
  display: block;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--accent);
}

.export-option-text {
  display: flex;
  flex-direction: column;
}

.export-option-label {
  font-size: 0.875rem;
}

.export-option-hint {
  font-size: 0.75rem;
  opacity: 0.7;
}

.export-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.export-cancel,
.export-confirm {
  border-radius: 0.25rem;
  padding: 0.375rem 0.75rem;
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}

.export-cancel {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--fg);
}
.export-cancel:hover {
  background: var(--surface-active);
}

.export-confirm {
  border: none;
  background: var(--accent);
  color: #fff;
}

.export-confirm:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
