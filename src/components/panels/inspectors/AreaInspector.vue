<script setup lang="ts">
import { computed } from 'vue'
import TextField from '../fields/TextField.vue'
import NotesField from '../fields/NotesField.vue'
import ColorField from '../fields/ColorField.vue'
import { PROJECT_SCOPE, dependOn, useModelStore } from '@/stores/model'
import { isImmutableArea, recolorArea, renameArea, setAreaNotes } from '@/core/ops/project'
import { t } from '@/i18n'
import type { AreaId } from '@/core/ids'
import type { Transaction } from '@/core/journal'

// One area: its name, the two colours every room in it is drawn with, and its
// notes.
//
// Which rooms are in it is the Hierarchy's answer, not a field here. An area is
// project-wide while rooms are per-tab, so a membership list in a panel that
// shows one tab would be either wrong or somewhere else's job.
//
// World is the guaranteed fallback for every room, which is why it cannot be
// renamed, recoloured or deleted: keeping it unchangeable is what stops a room
// ever pointing at an area that is gone. Its fields say so rather than
// vanishing, so the rule is visible instead of merely enforced.

const props = defineProps<{ areaId: AreaId }>()

const model = useModelStore()

// Plain lookups, and every binding ends in a primitive: core's objects are
// invisible to Vue, so a computed handing back the area itself would return the
// same identity after an in-place edit and never repaint.
function currentArea() {
  return model.project.areas.get(props.areaId) ?? null
}

const exists = computed(() => {
  dependOn(model.structureRev)
  return currentArea() !== null
})

const locked = computed(() => isImmutableArea(props.areaId))

const name = computed(() => {
  dependOn(model.structureRev)
  return currentArea()?.name ?? ''
})

const notes = computed(() => {
  dependOn(model.structureRev)
  return currentArea()?.notes ?? ''
})

// `null` means resolve from the active theme, which is World's permanent state
// and the reason its swatches read as the neutral the canvas actually paints.
const cellColor = computed(() => {
  dependOn(model.structureRev)
  return currentArea()?.cellColor ?? '#000000'
})

const wallColor = computed(() => {
  dependOn(model.structureRev)
  return currentArea()?.wallColor ?? '#000000'
})

function edit(historyLabel: string, apply: (tx: Transaction) => void) {
  if (!currentArea()) return
  model.run(historyLabel, PROJECT_SCOPE, apply)
}

function commitName(next: string) {
  edit(t('history.renameArea'), (tx) => renameArea(tx, model.project, props.areaId, next))
}

// Both fills go together, so each swatch passes the other's current value
// through: one op, one transaction, one undo step per swatch.
function commitColors(cell: string, wall: string) {
  edit(t('history.recolorArea'), (tx) => recolorArea(tx, model.project, props.areaId, cell, wall))
}

function commitNotes(next: string) {
  edit(t('history.areaNotes'), (tx) => setAreaNotes(tx, model.project, props.areaId, next))
}
</script>

<template>
  <div v-if="exists" class="inspector-fields">
    <TextField
      id="inspector-area-name"
      :label="t('inspector.name')"
      :value="name"
      :disabled="locked"
      :reason="t('inspector.worldLocked')"
      @commit="commitName"
    />
    <ColorField
      id="inspector-area-cell"
      :label="t('inspector.cellColor')"
      :value="cellColor"
      :disabled="locked"
      :reason="t('inspector.worldLocked')"
      @commit="commitColors($event, wallColor)"
    />
    <ColorField
      id="inspector-area-wall"
      :label="t('inspector.wallColor')"
      :value="wallColor"
      :disabled="locked"
      :reason="t('inspector.worldLocked')"
      @commit="commitColors(cellColor, $event)"
    />
    <NotesField
      id="inspector-area-notes"
      :label="t('inspector.notes')"
      :value="notes"
      :disabled="locked"
      :reason="t('inspector.worldLocked')"
      @commit="commitNotes"
    />
    <p v-if="locked" class="inspector-note">{{ t('inspector.worldLocked') }}</p>
  </div>
</template>

<style scoped>
.inspector-fields {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.inspector-note {
  margin: 0;
  font-size: 0.75rem;
  opacity: 0.7;
  color: var(--fg);
}
</style>
