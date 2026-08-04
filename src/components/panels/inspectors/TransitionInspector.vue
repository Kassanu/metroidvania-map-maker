<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import NotesField from '../fields/NotesField.vue'
import SelectField from '../fields/SelectField.vue'
import ToggleField from '../fields/ToggleField.vue'
import { dependOn, mapScope, useModelStore } from '@/stores/model'
import { resolveTransition, setDirection, setLock, setTransitionNotes } from '@/core/ops/doors'
import { edgeCells } from '@/core/cell'
import { roomLabel } from '@/i18n/naming'
import { t } from '@/i18n'
import type { CellKey } from '@/core/cell'
import type { LockTypeId, MapId, TransitionId } from '@/core/ids'
import type { Direction, MapModel, ProjectModel, Transition } from '@/core/types'

// One transition: what kind it is, which two rooms it joins, how each end is
// locked, and which way it can be travelled.
//
// Its kind is read-only and its geometry is absent. A door is not turned into
// a teleport by a dropdown; it is drawn as one, and both are anchored to rooms
// that the canvas is the only place to move.
//
// It carries notes and no label, unlike an icon or a line: a transition is
// already identified by the two rooms it joins.
//
// Every op here takes the tab's own map and finds the storing map itself,
// which is what lets a cross-tab teleport be edited from the tab that only
// draws its far end.

const props = defineProps<{ mapId: MapId; transitionId: TransitionId }>()

const model = useModelStore()

// Plain lookups, and every binding ends in a primitive: core's objects are
// invisible to Vue, so a computed handing back the transition itself would
// return the same identity after an in-place edit and never repaint.
function currentMap(): MapModel | null {
  return model.project.mapsById.get(props.mapId) ?? null
}

function currentTransition(): Transition | null {
  const map = currentMap()
  if (!map) return null
  try {
    return resolveTransition(model.project, map, props.transitionId).transition
  } catch {
    // Gone: pruning has not caught up, or the far end it was reached through
    // has. Not an error worth throwing out of a render.
    return null
  }
}

const exists = computed(() => {
  dependOn(model.rev, model.structureRev)
  return currentTransition() !== null
})

const kindLabel = computed(() => {
  dependOn(model.rev)
  const kind = currentTransition()?.kind
  if (kind === 'elevator') return t('inspector.typeElevator')
  if (kind === 'teleport') return t('inspector.typeTeleport')
  return t('inspector.typeEdge')
})

// The two rooms, named for the tab each sits on. Only a cross-tab teleport can
// name a map other than this one, and it is the one case where the room name
// alone would not say where to look.
interface EndInfo {
  label: string
}

function roomAt(project: ProjectModel, mapId: MapId, cell: CellKey): string | null {
  const map = project.mapsById.get(mapId)
  const roomId = map?.cellOwner.get(cell)
  const room = roomId ? map?.rooms.get(roomId) : undefined
  return room ? roomLabel(room) : null
}

function endLabel(project: ProjectModel, mapId: MapId, cell: CellKey): EndInfo {
  const room = roomAt(project, mapId, cell)
  if (!room) return { label: t('inspector.endMissing') }
  if (mapId === props.mapId) return { label: room }
  const mapName = project.mapsById.get(mapId)?.name ?? ''
  return { label: t('inspector.endOnMap', { room, map: mapName }) }
}

function endsOf(project: ProjectModel, transition: Transition | null): [EndInfo, EndInfo] {
  const missing: EndInfo = { label: t('inspector.endMissing') }
  if (!transition) return [missing, missing]

  switch (transition.kind) {
    case 'edge': {
      // `aSide` says which of the seam's two cells is A's. The type permits a
      // mixture across segments and one panel cannot show two answers, so the
      // first segment decides, matching what the renderer draws the arrow from.
      const segment = transition.segments[0]
      if (!segment) return [missing, missing]
      const { lo, hi } = edgeCells(segment.edge)
      const aCell = segment.aSide === 'lo' ? lo : hi
      const bCell = segment.aSide === 'lo' ? hi : lo
      return [endLabel(project, props.mapId, aCell), endLabel(project, props.mapId, bCell)]
    }
    case 'elevator':
      return [
        endLabel(project, props.mapId, transition.a),
        endLabel(project, props.mapId, transition.b),
      ]
    case 'teleport':
      return [
        endLabel(project, transition.a.mapId, transition.a.cell),
        endLabel(project, transition.b.mapId, transition.b.cell),
      ]
  }
}

const ends = computed(() => {
  dependOn(model.rev, model.structureRev)
  return endsOf(model.project, currentTransition())
})

const lockA = computed(() => {
  dependOn(model.rev)
  return currentTransition()?.locks.a ?? ''
})

const lockB = computed(() => {
  dependOn(model.rev)
  return currentTransition()?.locks.b ?? ''
})

const direction = computed<string>(() => {
  dependOn(model.rev)
  return currentTransition()?.direction ?? 'both'
})

const notes = computed(() => {
  dependOn(model.rev)
  return currentTransition()?.notes ?? ''
})

const lockOptions = computed(() => {
  dependOn(model.structureRev)
  return [...model.project.lockTypes.values()].map((lockType) => ({
    value: lockType.id,
    label: lockType.name,
  }))
})

const directionOptions = computed(() => [
  { value: 'both', label: t('inspector.directionBoth') },
  { value: 'aToB', label: t('inspector.directionAToB') },
  { value: 'bToA', label: t('inspector.directionBToA') },
])

// Panel state, not a model field: an asymmetric door is described entirely by
// its two lock values, so there is nothing to store. It starts on whatever the
// transition already says, because showing one dropdown for two different locks
// would be a lie.
const synced = ref(lockA.value === lockB.value)
watch(
  () => props.transitionId,
  () => {
    synced.value = lockA.value === lockB.value
  },
)

function edit(historyLabel: string, apply: (tx: Parameters<typeof setDirection>[0]) => void) {
  if (!currentMap()) return
  // Scoped to the tab the user acted on rather than to the map that stores the
  // transition, matching the canvas delete: undo should put a cross-tab
  // teleport's far end back in front of whoever changed it.
  model.run(historyLabel, mapScope(props.mapId), apply)
}

function commitLock(end: 'a' | 'b' | 'both', lockTypeId: string) {
  const map = currentMap()
  if (!map) return
  edit(t('history.setLock'), (tx) =>
    setLock(tx, model.project, map, props.transitionId, end, lockTypeId as LockTypeId),
  )
}

// Turning sync on makes the claim true rather than merely displaying it: A's
// lock goes to both ends. Leaving them different behind a single dropdown
// would show a value neither end has.
function setSynced(next: boolean) {
  synced.value = next
  if (next && lockA.value !== lockB.value) commitLock('both', lockA.value)
}

function commitDirection(next: string) {
  const map = currentMap()
  if (!map) return
  edit(t('history.setDirection'), (tx) =>
    setDirection(tx, model.project, map, props.transitionId, next as Direction),
  )
}

function commitNotes(next: string) {
  const map = currentMap()
  if (!map) return
  edit(t('history.transitionNotes'), (tx) =>
    setTransitionNotes(tx, model.project, map, props.transitionId, next),
  )
}
</script>

<template>
  <div v-if="exists" class="inspector-fields">
    <div class="field">
      <span class="field-label">{{ t('inspector.type') }}</span>
      <p class="field-readonly" data-testid="transition-kind">{{ kindLabel }}</p>
    </div>

    <div class="field">
      <span class="field-label">{{ t('inspector.endA') }}</span>
      <p class="field-readonly" data-testid="transition-end-a">{{ ends[0].label }}</p>
    </div>
    <div class="field">
      <span class="field-label">{{ t('inspector.endB') }}</span>
      <p class="field-readonly" data-testid="transition-end-b">{{ ends[1].label }}</p>
    </div>

    <ToggleField
      id="inspector-transition-lock-sync"
      :label="t('inspector.lockSync')"
      :value="synced"
      @commit="setSynced"
    />
    <SelectField
      v-if="synced"
      id="inspector-transition-lock"
      :label="t('inspector.lock')"
      :value="lockA"
      :options="lockOptions"
      @commit="commitLock('both', $event)"
    />
    <template v-else>
      <SelectField
        id="inspector-transition-lock-a"
        :label="t('inspector.lockA')"
        :value="lockA"
        :options="lockOptions"
        @commit="commitLock('a', $event)"
      />
      <SelectField
        id="inspector-transition-lock-b"
        :label="t('inspector.lockB')"
        :value="lockB"
        :options="lockOptions"
        @commit="commitLock('b', $event)"
      />
    </template>

    <SelectField
      id="inspector-transition-direction"
      :label="t('inspector.direction')"
      :value="direction"
      :options="directionOptions"
      @commit="commitDirection"
    />

    <NotesField
      id="inspector-transition-notes"
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

.field {
  display: flex;
  flex-direction: column;
  gap: 0.1875rem;
}

.field-label {
  font-size: 0.6875rem;
  font-weight: 600;
  opacity: 0.7;
  color: var(--fg);
}

.field-readonly {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--fg);
}
</style>
