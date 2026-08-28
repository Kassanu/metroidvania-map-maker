<script setup lang="ts">
// Picking what a picture of the maps contains, and how big it is.
//
// The dialog is opened *for* a format and has no Format control: the submenu
// carries one item per format, so this is handed a descriptor. It reads that
// descriptor's capabilities and never its id, which is what keeps adding a
// format to one table entry: transparency is offered when the format carries
// alpha, and the quality slider exists when the quality is the user's to set.
// A disabled control keeps its value, so opening for a format without alpha and
// then for one with it shows the choice again.
//
// The View menu is not consulted, not as a value and not as a seed. It is how
// somebody likes to work; this is what this particular picture contains.
//
// Every ticked tab is sized before anything is drawn. That is what the readout
// shows and what the ceiling is checked against: failing in the middle of a
// batch, after seven of eight maps have been drawn, is the worst outcome
// available and the dimensions are arithmetic that costs nothing.
//
// One flat column of fields, every label in one style. Grid sits with the
// margin and the appearance rather than with the layer list, because it is
// about how the picture is presented rather than about what is on the map.
//
// Reporting the outcome belongs to `useExportRun`, which every export dialog
// shares.

import { computed, ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import ScopeTree from './ScopeTree.vue'
import { dependOn, useModelStore } from '@/stores/model'
import { useTabsStore } from '@/stores/tabs'
import { useUiStore } from '@/stores/ui'
import { buildScopeTree, countOf } from '@/export/scopeTree'
import type { LeafId } from '@/export/scopeTree'
import { exportImages, imageScopeEmpty, planExport } from '@/export/image'
import type { ImageExportOptions } from '@/export/image'
import { MARGIN_MAX, MARGIN_MIN, PX_PER_CELL_PRESETS } from '@/export/image/options'
import type { ExportLayers } from '@/export/image/scene'
import { useExportRun } from '@/export/useExportRun'
import type { MapId } from '@/core/ids'
import { t } from '@/i18n'
import type { MessageKey } from '@/i18n'

const model = useModelStore()
const tabs = useTabsStore()
const ui = useUiStore()

const { busy, run: attemptExport } = useExportRun()

// The format the dialog was opened for, which is also whether it is open.
const format = computed(() => ui.imageExportFormat)

const open = computed({
  get: () => ui.imageExportFormat !== null,
  set: (next: boolean) => {
    if (!next) ui.closeImageExport()
  },
})

// What the encoder is actually told. The user's quality replaces the
// descriptor's rather than travelling beside it, so the producer keeps reading
// one field and never learns that a dialog exists.
const encodeFormat = computed(() => {
  const chosen = format.value
  if (!chosen?.quality?.adjustable || ui.imageExport.quality === null) return chosen
  return { ...chosen, quality: { ...chosen.quality, value: ui.imageExport.quality } }
})

const tree = computed(() => {
  dependOn(model.rev, model.structureRev)
  return buildScopeTree(model.project, { leaf: 'tab', isEmpty: imageScopeEmpty })
})

const selected = ref<Set<LeafId>>(new Set())

// The current tab and nothing else, on every opening, and nothing carried over
// from the last one. An image of every map is a rarer thing to want than a JSON
// of the whole project, and each extra tab is a whole extra file rather than
// another object in one. A tab with nothing to draw is not ticked, because a
// disabled node cannot be.
watch(
  () => ui.imageExportFormat,
  (opened) => {
    if (!opened) return
    const current = tree.value.find((tab) => tab.id === tabs.activeTabId)
    selected.value = current && !current.empty ? new Set<LeafId>([current.id]) : new Set()
  },
  { immediate: true },
)

// Every leaf of a tab-depth tree is a map id: the tree bottoms out at the tab.
const selectedMaps = computed(() => selected.value as ReadonlySet<MapId>)

const options = computed<ImageExportOptions>(() => ({
  pxPerCell: ui.imageExport.pxPerCell,
  margin: ui.imageExport.margin,
  layers: { ...ui.imageExport.layers },
  transparent: ui.imageExport.transparent,
  appearance: ui.imageExport.appearance ?? 'light',
}))

const count = computed(() => countOf(tree.value, selected.value))
const nothingSelected = computed(() => count.value.leaves === 0)

// Re-derived on every option change, which is what keeps the readout and the
// refusal honest: the rectangle reads the layers, so turning Lines off can
// shrink a picture or empty it.
const plan = computed(() => {
  const chosen = encodeFormat.value
  if (!chosen) return null
  dependOn(model.rev, model.structureRev)
  return planExport(model.project, selectedMaps.value, options.value, chosen)
})

const refused = computed(() => plan.value?.refused ?? null)

const readout = computed(() => {
  const largest = plan.value?.largest
  if (!largest || nothingSelected.value) return null
  const params = {
    width: largest.width,
    height: largest.height,
    size: fileSize(plan.value!.estimatedBytes),
  }
  return count.value.leaves > 1
    ? t('modal.imageExport.readoutMany', params)
    : t('modal.imageExport.readout', params)
})

// A refusal names what to change. The margin is named only when it is a lever
// on this one: naming a control that would not have helped is worse than
// naming one fewer.
const refusalMessage = computed(() => {
  const tab = refused.value
  if (!tab) return null
  if (tab.refusal === 'draws-nothing') {
    return t('modal.imageExport.drawsNothing', { tab: tab.name })
  }
  const params = { tab: tab.name, width: tab.size!.width, height: tab.size!.height }
  return tab.marginIsALever
    ? t('modal.imageExport.tooLargeMargin', params)
    : t('modal.imageExport.tooLarge', params)
})

const blocked = computed(() => nothingSelected.value || refused.value !== null)

// Decimal rather than binary units, matching what a browser's own download list
// shows the same file as.
function fileSize(bytes: number): string {
  return bytes < 1_000_000
    ? t('modal.imageExport.sizeKb', { value: Math.max(1, Math.round(bytes / 1_000)) })
    : t('modal.imageExport.sizeMb', { value: (bytes / 1_000_000).toFixed(1) })
}

// What is on the map, in the order the canvas draws it. Grid is not here: it is
// a property of the picture rather than of the map, and it sits below with the
// margin.
//
// Teleport lines depend on transitions, exactly as they do on the canvas: the
// renderer takes the connecting lines with the layer whatever this says, so the
// row disables rather than lying about what it would do.
const LAYERS: { key: keyof ExportLayers; labelKey: MessageKey; needsTransitions?: boolean }[] = [
  { key: 'transitions', labelKey: 'modal.imageExport.layer.transitions' },
  {
    key: 'teleportLines',
    labelKey: 'modal.imageExport.layer.teleportLines',
    needsTransitions: true,
  },
  { key: 'icons', labelKey: 'modal.imageExport.layer.icons' },
  { key: 'lines', labelKey: 'modal.imageExport.layer.lines' },
  { key: 'allLabels', labelKey: 'modal.imageExport.layer.allLabels' },
]

function setLayer(key: keyof ExportLayers, on: boolean): void {
  ui.imageExport.layers[key] = on
}

function checked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked
}

function numberOf(event: Event): number {
  return Number((event.target as HTMLInputElement | HTMLSelectElement).value)
}

async function run(): Promise<void> {
  const chosen = encodeFormat.value
  if (!chosen || blocked.value) return
  const outcome = await attemptExport(() =>
    exportImages(model.project, selectedMaps.value, options.value, chosen),
  )
  if (outcome === 'close') ui.closeImageExport()
}
</script>

<template>
  <BaseModal
    v-if="format"
    v-model:open="open"
    :title="t('modal.imageExport.title', { format: format.label })"
    :description="t('modal.imageExport.description')"
    :closable="!busy"
    width="32rem"
  >
    <div class="image-export">
      <div class="image-export-field">
        <span class="image-export-label">{{ t('modal.imageExport.scope') }}</span>
        <ScopeTree
          v-model:selected="selected"
          :tree="tree"
          :label="t('modal.imageExport.scope')"
          :empty-note="t('modal.imageExport.emptyTab')"
        />
      </div>

      <div class="image-export-field">
        <label class="image-export-label" for="image-export-size">
          {{ t('modal.imageExport.size') }}
        </label>
        <select
          id="image-export-size"
          class="image-export-select"
          :value="ui.imageExport.pxPerCell"
          :disabled="busy"
          @change="ui.imageExport.pxPerCell = numberOf($event)"
        >
          <option v-for="preset in PX_PER_CELL_PRESETS" :key="preset" :value="preset">
            {{ t('modal.imageExport.pxPerCell', { value: preset }) }}
          </option>
        </select>
        <p class="image-export-readout" data-readout>
          {{ readout ?? t('modal.imageExport.nothing') }}
        </p>
      </div>

      <div class="image-export-field">
        <span class="image-export-label">{{ t('modal.imageExport.layers') }}</span>
        <div class="image-export-layers">
          <label v-for="layer in LAYERS" :key="layer.key" class="image-export-check">
            <input
              :id="`image-export-layer-${layer.key}`"
              type="checkbox"
              :checked="ui.imageExport.layers[layer.key]"
              :disabled="busy || (layer.needsTransitions && !ui.imageExport.layers.transitions)"
              @change="setLayer(layer.key, checked($event))"
            />
            {{ t(layer.labelKey) }}
          </label>
        </div>
      </div>

      <div class="image-export-field">
        <label class="image-export-label" for="image-export-margin">
          {{ t('modal.imageExport.margin') }}
        </label>
        <div class="image-export-row">
          <input
            id="image-export-margin"
            type="range"
            :min="MARGIN_MIN"
            :max="MARGIN_MAX"
            step="1"
            :value="ui.imageExport.margin"
            :disabled="busy"
            @input="ui.imageExport.margin = numberOf($event)"
          />
          <output class="image-export-readout" for="image-export-margin">
            {{ t('modal.imageExport.marginCells', { value: ui.imageExport.margin }) }}
          </output>
        </div>
      </div>

      <div class="image-export-field">
        <label class="image-export-check">
          <input
            id="image-export-transparent"
            type="checkbox"
            :checked="ui.imageExport.transparent"
            :disabled="busy || !format.alpha"
            @change="ui.imageExport.transparent = checked($event)"
          />
          {{ t('modal.imageExport.transparent') }}
        </label>
        <p v-if="!format.alpha" class="image-export-readout">
          {{ t('modal.imageExport.noAlpha', { format: format.label }) }}
        </p>
      </div>

      <label class="image-export-check">
        <input
          id="image-export-layer-grid"
          type="checkbox"
          :checked="ui.imageExport.layers.grid"
          :disabled="busy"
          @change="setLayer('grid', checked($event))"
        />
        {{ t('modal.imageExport.layer.grid') }}
      </label>

      <div class="image-export-field">
        <label class="image-export-label" for="image-export-appearance">
          {{ t('modal.imageExport.appearance') }}
        </label>
        <select
          id="image-export-appearance"
          class="image-export-select"
          :value="ui.imageExport.appearance ?? 'light'"
          :disabled="busy"
          @change="
            ui.imageExport.appearance = ($event.target as HTMLSelectElement).value as
              'light' | 'dark'
          "
        >
          <option value="light">{{ t('modal.imageExport.light') }}</option>
          <option value="dark">{{ t('modal.imageExport.dark') }}</option>
        </select>
      </div>

      <div v-if="format.quality?.adjustable" class="image-export-field">
        <label class="image-export-label" for="image-export-quality">
          {{ t('modal.imageExport.quality') }}
        </label>
        <input
          id="image-export-quality"
          type="range"
          min="0.1"
          max="1"
          step="0.01"
          :value="ui.imageExport.quality ?? format.quality.value"
          :disabled="busy"
          @input="ui.imageExport.quality = numberOf($event)"
        />
      </div>

      <p v-if="refusalMessage" class="image-export-refusal" data-refusal>{{ refusalMessage }}</p>

      <div class="image-export-actions">
        <button type="button" class="image-export-cancel" :disabled="busy" @click="open = false">
          {{ t('common.cancel') }}
        </button>
        <button type="button" class="image-export-confirm" :disabled="blocked || busy" @click="run">
          {{ busy ? t('modal.export.working') : t('modal.export.confirm') }}
        </button>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
/* One rhythm: `gap` between fields, a smaller one inside a field. Nothing sets
   its own margin, so no control can end up flush against the next label. */
.image-export {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.image-export-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

/* Every label in the dialog, section or control alike. */
.image-export-label {
  font-size: 0.75rem;
  font-weight: 600;
  opacity: 0.75;
}

.image-export-readout {
  margin: 0;
  font-size: 0.75rem;
  opacity: 0.7;
}

.image-export-layers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.375rem 0.75rem;
}

.image-export-check {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.875rem;
  cursor: pointer;
}

.image-export-check input {
  margin: 0;
  cursor: pointer;
}

.image-export-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.image-export-row input[type='range'] {
  flex: 1;
}

.image-export-select {
  font: inherit;
  font-size: 0.875rem;
  padding: 0.25rem;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  background: var(--bg);
  color: var(--fg);
}

.image-export-refusal {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--danger, #e23b3b);
}

.image-export-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.image-export-cancel,
.image-export-confirm {
  border-radius: 0.25rem;
  padding: 0.375rem 0.75rem;
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}

.image-export-cancel {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--fg);
}
.image-export-cancel:hover {
  background: var(--surface-active);
}

.image-export-confirm {
  border: none;
  background: var(--accent);
  color: #fff;
}

.image-export-cancel:disabled,
.image-export-confirm:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
