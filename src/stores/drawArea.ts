// The area new rooms are drawn into. Core honours this only when creating a
// room: `paintCells` reads `options.areaId` only on creation. Growing, merging,
// and resizing leave the target room's own area alone, so this can never
// re-paper an existing room by accident.
//
// It is an intent, not a readout: selecting a different area does not switch
// this. It says what comes next.
//
// Has its own store rather than living in `stores/tools.ts` because it holds an
// `AreaId`, which only means something inside the current project and needs both
// a watcher and the model dependency that `tools.ts` avoids.

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useModelStore, dependOn } from './model'
import { WORLD_AREA_ID } from '@/core/ids'
import type { AreaId } from '@/core/ids'

export const useDrawAreaStore = defineStore('drawArea', () => {
  const model = useModelStore()

  // World is the default and fallback. It is immutable, so there is always
  // something to fall back to.
  const selected = ref<AreaId>(WORLD_AREA_ID)

  function select(areaId: AreaId): void {
    selected.value = areaId
  }

  // The selection can outlive the area: the Hierarchy deletes it, undo removes
  // it, a file is opened over the top. Pruning is one-way: the watcher forgets
  // it, so undo-then-redo does not silently re-select a deleted area.
  //
  // Watches `structureRev`, not `rev`: areas are project structure, not map
  // content.
  function prune(): void {
    if (!model.project.areas.has(selected.value)) selected.value = WORLD_AREA_ID
  }

  // Flush sync: nothing should read the old value between the delete and the
  // prune.
  watch([() => model.project, () => model.structureRev], prune, { flush: 'sync' })

  return {
    // Resolved on read, not trusted. Catches the case where `select()` is handed
    // an id that is already unknown.
    areaId: computed(() => {
      // `dependOn` is how a computed subscribes to the plain-TS model, which is
      // not reactive: without it this reads `areas` once and caches the answer
      // through every deletion. Areas are project structure, so `structureRev`
      // is the counter that moves.
      dependOn(model.structureRev)
      return model.project.areas.has(selected.value) ? selected.value : WORLD_AREA_ID
    }),
    select,
  }
})
