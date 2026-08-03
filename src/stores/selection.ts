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
// A list rather than a single slot: shift-click builds a multi-selection, and
// a selection of exactly one room is also what Draw mode draws its resize
// handles on.

import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { useModelStore } from './model'
import { farEndsOnMap } from '@/core/farEnds'
import type { CellKey } from '@/core/cell'
import type { MapModel, ObjectRef } from '@/core/types'
import type { IconId, LineId, MapId, RoomId, TransitionId } from '@/core/ids'

function sameRef(a: ObjectRef, b: ObjectRef): boolean {
  return a.kind === b.kind && a.id === b.id
}

// Kind and id together, because ids are only unique within a kind and a cell
// key is not unique at all. Kinds contain no colon, so the join is unambiguous.
function refKey(ref: ObjectRef): string {
  return `${ref.kind}:${ref.id}`
}

export const useSelectionStore = defineStore('selection', () => {
  const model = useModelStore()
  const items = ref<ObjectRef[]>([])
  // Membership, derived from `items` and never written on its own: every
  // assignment to the list goes through `replace`, which rebuilds this.
  //
  // It exists because `isSelected` is called once per cell per draw and a
  // marquee re-runs the lot on every pointer move, which a linear scan of
  // `items` turns into a per-frame O(selection x cells) cost. `shallowRef`
  // holding a fresh Set rather than a reactive one: the whole set is replaced
  // on every change, so tracking the ref is enough and `has` stays a raw
  // lookup.
  const index = shallowRef<ReadonlySet<string>>(new Set())
  // Selection is per-tab: the objects on the tab you are looking at. Switching
  // away and back does not restore it. A `ref`, not a plain `let`, because the
  // `mapId` getter below is a `computed`. A non-reactive backing value would
  // cache whatever it saw first and only recompute when something else changes.
  const selectionMapId = ref<MapId | null>(null)

  const selected = computed<readonly ObjectRef[]>(() => items.value)
  const isEmpty = computed(() => items.value.length === 0)

  // The one place the list is assigned. The array carries order; the index
  // carries membership, and the two cannot drift because neither is written
  // anywhere else.
  function replace(next: ObjectRef[]): void {
    items.value = next
    index.value = new Set(next.map(refKey))
  }

  function isSelected(ref: ObjectRef): boolean {
    return index.value.has(refKey(ref))
  }

  function set(next: ObjectRef[], mapId: MapId): void {
    selectionMapId.value = mapId
    replace(next)
  }

  function clear(): void {
    replace([])
  }

  // Shift-click: add if absent, remove if present. The gesture layer decides
  // when this applies; the store only owns what it means.
  function toggle(ref: ObjectRef, mapId: MapId): void {
    if (selectionMapId.value !== mapId) {
      set([ref], mapId)
      return
    }
    replace(
      isSelected(ref) ? items.value.filter((item) => !sameRef(item, ref)) : [...items.value, ref],
    )
  }

  // Union, not toggle: what a shift-marquee means. Sweeping over a room that is
  // already selected leaves it selected, where a shift-click on it would remove
  // it. The two gestures differ because a sweep covers whatever it passes over
  // and a click names one thing.
  //
  // Additions keep selection order and land after what was already there.
  function addAll(refs: ObjectRef[], mapId: MapId): void {
    if (selectionMapId.value !== mapId) {
      set(refs, mapId)
      return
    }
    const fresh = refs.filter((ref) => !isSelected(ref))
    if (fresh.length === 0) return
    replace([...items.value, ...fresh])
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

  // The room Draw mode draws handles on: exactly one room selected, on this
  // map. Null for a selection that holds anything else, holds more than one
  // room, or belongs to another tab.
  //
  // Answering null for a multi-room selection is the point rather than a
  // limitation. Resizing three rooms at once is not a thing, so every consumer
  // asks the question in the form that already has the right answer instead of
  // reaching for the first item of a list.
  function soleRoomOn(mapId: MapId): RoomId | null {
    if (selectionMapId.value !== mapId || items.value.length !== 1) return null
    const [only] = items.value
    return only.kind === 'room' ? only.id : null
  }

  // The selected objects of one kind, on the tab asked about, in selection
  // order.
  //
  // Each takes a map for the reason `soleRoomOn` does, and for cells it is the
  // difference between empty and wrong: a stale room or icon id simply fails to
  // match anything on another map, but `3,4` names a cell on every map there
  // is, so an unguarded cell selector would light up the wrong tab.
  //
  // Written out per kind rather than derived from a kind argument, because each
  // one's return type is the point: a caller gets RoomId[] to hand to a room op,
  // not a union it has to narrow again.
  function roomsOn(mapId: MapId): RoomId[] {
    const out: RoomId[] = []
    if (selectionMapId.value !== mapId) return out
    for (const item of items.value) {
      if (item.kind === 'room') out.push(item.id)
    }
    return out
  }

  function cellsOn(mapId: MapId): CellKey[] {
    const out: CellKey[] = []
    if (selectionMapId.value !== mapId) return out
    for (const item of items.value) {
      if (item.kind === 'cell') out.push(item.id)
    }
    return out
  }

  function transitionsOn(mapId: MapId): TransitionId[] {
    const out: TransitionId[] = []
    if (selectionMapId.value !== mapId) return out
    for (const item of items.value) {
      if (item.kind === 'transition') out.push(item.id)
    }
    return out
  }

  function iconsOn(mapId: MapId): IconId[] {
    const out: IconId[] = []
    if (selectionMapId.value !== mapId) return out
    for (const item of items.value) {
      if (item.kind === 'icon') out.push(item.id)
    }
    return out
  }

  function linesOn(mapId: MapId): LineId[] {
    const out: LineId[] = []
    if (selectionMapId.value !== mapId) return out
    for (const item of items.value) {
      if (item.kind === 'line') out.push(item.id)
    }
    return out
  }

  // Whether anything in the selection could go on a clipboard.
  //
  // Transitions are never copied, and an icon travels as content on a cell
  // rather than on its own, so a selection holding only those two has no
  // payload at all. Copy, cut and duplicate refuse such a selection before the
  // click rather than producing an empty payload a later paste does nothing
  // with.
  function hasCopyableOn(mapId: MapId): boolean {
    if (selectionMapId.value !== mapId) return false
    return items.value.some(
      (item) => item.kind === 'room' || item.kind === 'cell' || item.kind === 'line',
    )
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
      replace([])
      return
    }
    // One pass over the selection, one hash lookup each: a cell selection can
    // be large, and asking the map about each item must not walk the map.
    const alive = items.value.filter((item) => exists(item, map))
    if (alive.length !== items.value.length) replace(alive)
  }

  watch([() => model.project, () => model.rev], prune, { flush: 'sync' })

  return {
    selected,
    isEmpty,
    isSelected: computed(() => (ref: ObjectRef) => isSelected(ref)),
    set,
    addAll,
    toggle,
    clear,
    clickSelect,
    soleRoomOn: computed(() => soleRoomOn),
    roomsOn: computed(() => roomsOn),
    cellsOn: computed(() => cellsOn),
    transitionsOn: computed(() => transitionsOn),
    iconsOn: computed(() => iconsOn),
    linesOn: computed(() => linesOn),
    hasCopyableOn: computed(() => hasCopyableOn),
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
    // A cell is always there; what it can lose is an owner. Erased back to bare
    // grid it cannot be moved, cut or erased any further, so it drops out the
    // same way a deleted room does.
    case 'cell':
      return map.cellOwner.has(ref.id)
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
