// The one shared selection slot.
//
// Kept in the store, not the core model, so the model stays selection-free and
// outside Vue reactivity. A selection is read by panels and the toolbar on
// every change, so it must be reactive.
//
// `ObjectRef[]` rather than a set of ids because the kinds are not
// interchangeable: a RoomId and an IconId are both short strings, and "what is
// selected" has to survive being handed to an op that only accepts one kind.
//
// A list rather than a single slot because multi-select is planned for v1, even
// though only click-select exists today.

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useModelStore } from './model'
import { farEndsOnMap } from '@/core/farEnds'
import type { MapModel, ObjectRef } from '@/core/types'
import type { MapId, TransitionId } from '@/core/ids'

function sameRef(a: ObjectRef, b: ObjectRef): boolean {
  return a.kind === b.kind && a.id === b.id
}

export const useSelectionStore = defineStore('selection', () => {
  const model = useModelStore()
  const items = ref<ObjectRef[]>([])
  // Selection is per-tab: the objects on the tab you are looking at. Switching
  // away and back does not restore it. A `ref`, not a plain `let`, because the
  // `mapId` getter below is a `computed`. A non-reactive backing value would
  // cache whatever it saw first and only recompute when something else changes.
  const selectionMapId = ref<MapId | null>(null)

  const selected = computed<readonly ObjectRef[]>(() => items.value)
  const isEmpty = computed(() => items.value.length === 0)

  function isSelected(ref: ObjectRef): boolean {
    return items.value.some((item) => sameRef(item, ref))
  }

  function set(next: ObjectRef[], mapId: MapId): void {
    selectionMapId.value = mapId
    items.value = next
  }

  function clear(): void {
    items.value = []
  }

  // Shift-click: add if absent, remove if present. The gesture layer decides
  // when this applies; the store only owns what it means.
  function toggle(ref: ObjectRef, mapId: MapId): void {
    if (selectionMapId.value !== mapId) {
      set([ref], mapId)
      return
    }
    items.value = isSelected(ref)
      ? items.value.filter((item) => !sameRef(item, ref))
      : [...items.value, ref]
  }

  // What a click means, for every mode. A mode decides only which of its
  // targets are selectable and hands the ref, or null for a click that found
  // nothing; this decides the rest, so no two modes can disagree about it.
  //
  // `additive` is shift held. A shift-click only ever edits the selection: a
  // miss leaves it alone rather than clearing, because a stray shift-click on
  // bare grid would destroy the multi-selection it is being used to build.
  function clickSelect(ref: ObjectRef | null, mapId: MapId, additive: boolean): void {
    if (!ref) {
      if (!additive) clear()
      return
    }
    if (additive) toggle(ref, mapId)
    else set([ref], mapId)
  }

  // A selection can outlive the thing it points at: undo removes a room, a
  // delete cascades, a file is opened. Having every op that can destroy an
  // object also prune the selection is the version that eventually misses one.
  // This drops anything that no longer resolves, after any committed change.
  //
  // Runs on `rev`, not `structureRev`: deleting a room is map content, and
  // `structureRev` would not move.
  function prune(): void {
    if (items.value.length === 0) return
    const map = selectionMapId.value ? model.project.mapsById.get(selectionMapId.value) : undefined
    if (!map) {
      items.value = []
      return
    }
    const alive = items.value.filter((item) => exists(item, map))
    if (alive.length !== items.value.length) items.value = alive
  }

  watch([() => model.project, () => model.rev], prune, { flush: 'sync' })

  return {
    selected,
    isEmpty,
    isSelected: computed(() => (ref: ObjectRef) => isSelected(ref)),
    set,
    toggle,
    clear,
    clickSelect,
    // The tab the current selection belongs to, so the canvas can tell whether
    // what it is drawing is the selected map's.
    mapId: computed(() => selectionMapId.value),
  }
})

function exists(ref: ObjectRef, map: MapModel): boolean {
  switch (ref.kind) {
    case 'room':
      return map.rooms.has(ref.id)
    case 'icon':
      return map.icons.has(ref.id)
    case 'line':
      return map.lines.has(ref.id)
    // A cross-tab teleport is selectable from its destination tab but stored
    // under its origin, so it is alive if either end knows it.
    case 'transition':
      return map.transitions.has(ref.id) || isFarEndOn(map, ref.id)
    // Areas are project-scope and selected through the Hierarchy, never from
    // the canvas. They cannot go stale with a map.
    case 'area':
      return true
  }
}

function isFarEndOn(map: MapModel, transitionId: TransitionId): boolean {
  const model = useModelStore()
  for (const ref of farEndsOnMap(model.project.teleportFarEnds, map.id).values()) {
    if (ref.transitionId === transitionId) return true
  }
  return false
}
