<script setup lang="ts">
import { computed } from 'vue'
import TextField from '../fields/TextField.vue'
import NotesField from '../fields/NotesField.vue'
import SelectField from '../fields/SelectField.vue'
import ToggleField from '../fields/ToggleField.vue'
import ColorSwatch from '../fields/ColorSwatch.vue'
import { dependOn, mapScope, useModelStore } from '@/stores/model'
import { assignRoomArea, renameRoom, setRoomHeated, setRoomNotes } from '@/core/ops/rooms'
import { WORLD_AREA_ID } from '@/core/ids'
import { t } from '@/i18n'
import type { AreaId, MapId, RoomId } from '@/core/ids'
import type { Transaction } from '@/core/journal'
import type { MapModel } from '@/core/types'

// One room's identity, and the properties that change how its cells are
// painted: what it is called, what is written about it, which area owns its
// colours, and whether it is heated. Its geometry is the canvas's business and
// appears nowhere here.

const props = defineProps<{ mapId: MapId; roomId: RoomId }>()

const model = useModelStore()

// Plain lookups rather than computeds. Core's objects are invisible to Vue, so
// a computed returning the room itself hands back the same object identity on
// every recompute: an edit that mutates a field in place changes nothing Vue
// can see and the panel never repaints. Every binding below therefore ends in
// a primitive, and takes its subscription from the revision counters.
function currentMap() {
  return model.project.mapsById.get(props.mapId) ?? null
}

function currentRoom() {
  return currentMap()?.rooms.get(props.roomId) ?? null
}

const exists = computed(() => {
  dependOn(model.rev, model.structureRev)
  return currentRoom() !== null
})

const name = computed(() => {
  dependOn(model.rev)
  return currentRoom()?.name ?? ''
})

const notes = computed(() => {
  dependOn(model.rev)
  return currentRoom()?.notes ?? ''
})

const heated = computed(() => {
  dependOn(model.rev)
  return currentRoom()?.heated ?? false
})

const areaId = computed<string>(() => {
  dependOn(model.rev)
  return currentRoom()?.areaId ?? WORLD_AREA_ID
})

// World first, because it is the default and the fallback every deleted area
// reassigns to. Areas are project structure, so a rename or a new one moves
// `structureRev` and nothing else.
const areaOptions = computed(() => {
  dependOn(model.structureRev)
  const all = [...model.project.areas.values()]
  return [
    ...all.filter((area) => area.id === WORLD_AREA_ID),
    ...all.filter((area) => area.id !== WORLD_AREA_ID),
  ].map((area) => ({ value: area.id, label: area.name }))
})

// `cellColor: null` means resolve from the active theme, which is World's
// permanent state. The same CSS variable the canvas fills rooms with gives the
// swatch the same answer in both themes.
const areaFill = computed(() => {
  dependOn(model.structureRev)
  return model.project.areas.get(areaId.value as AreaId)?.cellColor ?? 'var(--canvas-room-fill)'
})

function edit(label: string, apply: (tx: Transaction, map: MapModel) => void) {
  const map = currentMap()
  if (!map) return
  model.run(label, mapScope(props.mapId), (tx) => apply(tx, map))
}

function commitName(next: string) {
  edit(t('history.renameRoom'), (tx, map) => renameRoom(tx, map, props.roomId, next))
}

function commitNotes(next: string) {
  edit(t('history.roomNotes'), (tx, map) => setRoomNotes(tx, map, props.roomId, next))
}

function commitHeated(next: boolean) {
  edit(t('history.setHeated'), (tx, map) => setRoomHeated(tx, map, props.roomId, next))
}

function commitArea(next: string) {
  edit(t('history.assignArea'), (tx, map) => assignRoomArea(tx, map, props.roomId, next as AreaId))
}
</script>

<template>
  <div v-if="exists" class="inspector-fields">
    <TextField
      id="inspector-room-name"
      :label="t('inspector.name')"
      :value="name"
      @commit="commitName"
    />
    <SelectField
      id="inspector-room-area"
      :label="t('inspector.area')"
      :value="areaId"
      :options="areaOptions"
      @commit="commitArea"
    >
      <template #before>
        <ColorSwatch :color="areaFill" :title="t('inspector.areaColorHint')" />
      </template>
    </SelectField>
    <!-- Between Area and Notes, because Notes is last on every kind's panel. -->
    <ToggleField
      id="inspector-room-heated"
      :label="t('inspector.heated')"
      :value="heated"
      @commit="commitHeated"
    />
    <NotesField
      id="inspector-room-notes"
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
