<script setup lang="ts">
import { computed } from 'vue'
import TextField from '../fields/TextField.vue'
import NotesField from '../fields/NotesField.vue'
import ColorField from '../fields/ColorField.vue'
import ToggleField from '../fields/ToggleField.vue'
import { dependOn, mapScope, useModelStore } from '@/stores/model'
import { setLineStyle } from '@/core/ops/markup'
import { t } from '@/i18n'
import type { LineId, MapId } from '@/core/ids'
import type { LineObject, MapModel } from '@/core/types'
import type { Transaction } from '@/core/journal'

// One path line's style. Its geometry is not here: a line is drawn, extended
// and peeled by pointer, and there is no useful way to type a polyline.
//
// All five fields go through the one keyed setter, which is why this panel has
// no per-field op and no per-field undo label beyond naming what changed.

const props = defineProps<{ mapId: MapId; lineId: LineId }>()

const model = useModelStore()

function currentMap() {
  return model.project.mapsById.get(props.mapId) ?? null
}

function currentLine() {
  return currentMap()?.lines.get(props.lineId) ?? null
}

const exists = computed(() => {
  dependOn(model.rev, model.structureRev)
  return currentLine() !== null
})

const color = computed(() => {
  dependOn(model.rev)
  return currentLine()?.color ?? '#000000'
})

const arrowStart = computed(() => {
  dependOn(model.rev)
  return currentLine()?.arrowStart ?? false
})

const arrowEnd = computed(() => {
  dependOn(model.rev)
  return currentLine()?.arrowEnd ?? false
})

const label = computed(() => {
  dependOn(model.rev)
  return currentLine()?.label ?? ''
})

const notes = computed(() => {
  dependOn(model.rev)
  return currentLine()?.notes ?? ''
})

function edit(historyLabel: string, apply: (tx: Transaction, map: MapModel) => void) {
  const map = currentMap()
  if (!map) return
  model.run(historyLabel, mapScope(props.mapId), (tx) => apply(tx, map))
}

function style<K extends 'color' | 'arrowStart' | 'arrowEnd' | 'label' | 'notes'>(
  historyLabel: string,
  key: K,
  value: LineObject[K],
) {
  edit(historyLabel, (tx, map) => setLineStyle(tx, map, props.lineId, key, value))
}
</script>

<template>
  <div v-if="exists" class="inspector-fields">
    <ColorField
      id="inspector-line-color"
      :label="t('inspector.color')"
      :value="color"
      @commit="style(t('history.lineColor'), 'color', $event)"
    />
    <ToggleField
      id="inspector-line-arrow-start"
      :label="t('inspector.arrowStart')"
      :value="arrowStart"
      @commit="style(t('history.lineArrow'), 'arrowStart', $event)"
    />
    <ToggleField
      id="inspector-line-arrow-end"
      :label="t('inspector.arrowEnd')"
      :value="arrowEnd"
      @commit="style(t('history.lineArrow'), 'arrowEnd', $event)"
    />
    <TextField
      id="inspector-line-label"
      :label="t('inspector.label')"
      :value="label"
      allow-empty
      @commit="style(t('history.lineLabel'), 'label', $event)"
    />
    <NotesField
      id="inspector-line-notes"
      :label="t('inspector.notes')"
      :value="notes"
      @commit="style(t('history.lineNotes'), 'notes', $event)"
    />
  </div>
</template>

<style scoped>
.inspector-fields {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}
</style>
