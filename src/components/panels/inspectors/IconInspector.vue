<script setup lang="ts">
import { computed } from 'vue'
import TextField from '../fields/TextField.vue'
import NotesField from '../fields/NotesField.vue'
import ColorField from '../fields/ColorField.vue'
import { dependOn, mapScope, useModelStore } from '@/stores/model'
import { setIconColors, setIconLabel, setIconNotes } from '@/core/ops/markup'
import { t } from '@/i18n'
import type { IconId, MapId } from '@/core/ids'
import type { Transaction } from '@/core/journal'
import type { MapModel } from '@/core/types'

// One icon: its two fills, its label, and what is written about it.
//
// Both colours belong to the icon rather than to its type, which is what makes
// them editable here at all: two icons sharing a type can differ, so recolouring
// one is a property of that icon and not a change to the library.
//
// Which library icon it draws is not here. An icon of the wrong type is deleted
// and replaced, the same way a room of the wrong shape is repainted.
//
// Its cell is not here either. An icon moves by being dragged.

const props = defineProps<{ mapId: MapId; iconId: IconId }>()

const model = useModelStore()

// Plain lookups, and every binding below ends in a primitive: core's objects
// are invisible to Vue, so a computed handing back the icon itself would return
// the same identity after an in-place edit and the panel would never repaint.
function currentMap() {
  return model.project.mapsById.get(props.mapId) ?? null
}

function currentIcon() {
  return currentMap()?.icons.get(props.iconId) ?? null
}

const exists = computed(() => {
  dependOn(model.rev, model.structureRev)
  return currentIcon() !== null
})

const plateColor = computed(() => {
  dependOn(model.rev)
  return currentIcon()?.plateColor ?? '#000000'
})

const glyphColor = computed(() => {
  dependOn(model.rev)
  return currentIcon()?.glyphColor ?? '#000000'
})

const label = computed(() => {
  dependOn(model.rev)
  return currentIcon()?.label ?? ''
})

const notes = computed(() => {
  dependOn(model.rev)
  return currentIcon()?.notes ?? ''
})

function edit(historyLabel: string, apply: (tx: Transaction, map: MapModel) => void) {
  const map = currentMap()
  if (!map) return
  model.run(historyLabel, mapScope(props.mapId), (tx) => apply(tx, map))
}

// `setIconColors` takes both fills, so each swatch passes the other one's
// current value through. One op, one transaction, one undo step per swatch.
function commitColors(plate: string, glyph: string) {
  edit(t('history.iconColors'), (tx, map) =>
    setIconColors(tx, map, props.iconId, { plateColor: plate, glyphColor: glyph }),
  )
}

function commitLabel(next: string) {
  edit(t('history.iconLabel'), (tx, map) => setIconLabel(tx, map, props.iconId, next))
}

function commitNotes(next: string) {
  edit(t('history.iconNotes'), (tx, map) => setIconNotes(tx, map, props.iconId, next))
}
</script>

<template>
  <div v-if="exists" class="inspector-fields">
    <ColorField
      id="inspector-icon-plate"
      :label="t('inspector.plate')"
      :value="plateColor"
      @commit="commitColors($event, glyphColor)"
    />
    <ColorField
      id="inspector-icon-glyph"
      :label="t('inspector.glyph')"
      :value="glyphColor"
      @commit="commitColors(plateColor, $event)"
    />
    <TextField
      id="inspector-icon-label"
      :label="t('inspector.label')"
      :value="label"
      allow-empty
      @commit="commitLabel"
    />
    <NotesField
      id="inspector-icon-notes"
      :label="t('inspector.notes')"
      :value="notes"
      @commit="commitNotes"
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
