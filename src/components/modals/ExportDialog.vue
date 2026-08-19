<script setup lang="ts">
// Picking what to export, and how it is packaged.
//
// The tree is tab -> area -> room, one level deeper than the Hierarchy panel it
// resembles: rooms are per-tab and areas are project-wide, so the same area
// appears under several tabs holding different rooms, and ticking one takes
// exactly the rooms shown beneath it.
//
// Rendered as flat rows carrying `aria-level`, the way the Hierarchy is, since
// a tree is a list of visible rows to everything that reads it. The tri-state
// arithmetic lives in `scopeTree.ts` rather than here.
//
// The dialog reports its own outcome, because the app has no toast system yet:
// it closes on success, keeps its selection and shows the reason on a failure,
// and stays open on a cancelled destination so a retry costs no re-ticking.

import { computed, ref, watch } from 'vue'
import {
  CheckboxIndicator,
  CheckboxRoot,
  RadioGroupIndicator,
  RadioGroupItem,
  RadioGroupRoot,
} from 'reka-ui'
import BaseModal from './BaseModal.vue'
import { dependOn, useModelStore } from '@/stores/model'
import { useUiStore } from '@/stores/ui'
import { exportProject } from '@/export'
import type { ExportPackaging } from '@/export'
import { allRooms, buildScopeTree, countOf, scopeOf, stateOf, toggle } from '@/export/scopeTree'
import type { CheckedState, ScopeNode } from '@/export/scopeTree'
import type { RoomId } from '@/core/ids'
import { t } from '@/i18n'
import type { MessageKey } from '@/i18n'

const model = useModelStore()
const ui = useUiStore()

const tree = computed(() => {
  dependOn(model.rev, model.structureRev)
  return buildScopeTree(model.project)
})

const selected = ref<Set<RoomId>>(new Set())
const packaging = ref<ExportPackaging>('combined')
const busy = ref(false)
const failure = ref<string | null>(null)

// Everything ticked on every opening, and nothing carried over from the last
// one: a remembered subset would silently omit a tab the user had forgotten
// was unticked, and the omission is invisible until something downstream is
// missing a room.
watch(
  () => ui.exportOpen,
  (open) => {
    if (!open) return
    selected.value = allRooms(tree.value)
    failure.value = null
  },
  { immediate: true },
)

// One flat list of rows rather than nested lists, each carrying the level it
// sits at. `key` is unique per row: a room id alone would collide with nothing,
// but an area id repeats across tabs.
interface Row {
  key: string
  level: 1 | 2 | 3
  label: string
  node: ScopeNode
  empty: boolean
}

const rows = computed<Row[]>(() => {
  const out: Row[] = []
  for (const tab of tree.value) {
    out.push({
      key: tab.id,
      level: 1,
      label: tab.label,
      node: tab,
      empty: tab.areas.length === 0,
    })
    for (const area of tab.areas) {
      out.push({
        key: `${tab.id}/${area.id}`,
        level: 2,
        label: area.label,
        node: area,
        empty: false,
      })
      for (const room of area.rooms) {
        out.push({
          key: room.id,
          level: 3,
          label: room.label,
          node: room,
          empty: false,
        })
      }
    }
  }
  return out
})

const count = computed(() => countOf(tree.value, selected.value))
const nothingSelected = computed(() => count.value.rooms === 0)

function stateFor(node: ScopeNode): CheckedState {
  return stateOf(node, selected.value)
}

// Reka hands back the state it is moving to, which for a box currently
// indeterminate is `true`: ticking a partly-filled area fills it.
function onCheckedChange(node: ScopeNode, next: CheckedState): void {
  selected.value = toggle(node, selected.value, next === true)
}

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
  if (nothingSelected.value || busy.value) return
  busy.value = true
  failure.value = null
  try {
    const result = await exportProject(model.project, {
      packaging: packaging.value,
      scope: scopeOf(tree.value, selected.value),
    })
    // Cancelled leaves everything as it was, including the dialog: the user
    // dismissed a destination picker, not the export.
    if (result.kind === 'written') ui.exportOpen = false
    else if (result.kind === 'failed') {
      failure.value = t('modal.export.failed', { message: result.message })
    }
  } finally {
    busy.value = false
  }
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
        <div class="export-tree" role="tree" :aria-label="t('modal.export.scope')">
          <div
            v-for="row in rows"
            :key="row.key"
            class="export-row"
            role="treeitem"
            :aria-level="row.level"
            :aria-selected="stateFor(row.node) === true"
            :data-row-kind="row.node.kind"
            :data-row-id="row.node.id"
            :style="{ '--row-level': row.level }"
          >
            <CheckboxRoot
              class="export-check"
              :aria-label="row.label"
              :model-value="stateFor(row.node)"
              :disabled="row.empty"
              @update:model-value="onCheckedChange(row.node, $event)"
            >
              <CheckboxIndicator class="export-check-mark">
                {{ stateFor(row.node) === 'indeterminate' ? '–' : '✓' }}
              </CheckboxIndicator>
            </CheckboxRoot>
            <span class="export-label">{{ row.label }}</span>
            <span v-if="row.empty" class="export-note">{{ t('modal.export.emptyTab') }}</span>
          </div>
        </div>
        <p class="export-count">
          {{
            nothingSelected
              ? t('modal.export.nothing')
              : t('modal.export.count', { tabs: count.tabs, rooms: count.rooms })
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

      <p v-if="failure" class="export-failure" role="alert">{{ failure }}</p>

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

.export-tree {
  max-height: 16rem;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  padding: 0.25rem;
}

.export-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  /* Each level indents by one step; the checkbox column stays aligned with it
     so the three levels read as a tree without nested containers. */
  padding-left: calc((var(--row-level) - 1) * 1.25rem);
  min-height: 1.75rem;
}

.export-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  flex: none;
  border: 1px solid var(--border);
  border-radius: 0.1875rem;
  background: var(--bg);
  color: var(--fg);
  cursor: pointer;
}

.export-check[data-disabled] {
  opacity: 0.4;
  cursor: default;
}

.export-check-mark {
  font-size: 0.75rem;
  line-height: 1;
}

.export-label {
  font-size: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.export-note,
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

.export-failure {
  margin: 0;
  font-size: 0.8125rem;
  color: #d64545;
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
