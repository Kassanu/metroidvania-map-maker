// Defaults for creating transitions: held by the Door toolbar, never read or
// edited from elsewhere.
//
// This is an intent for new transitions only. It does not reflect what is
// selected, and does not change the selection. Selecting a transition never
// updates this; changing this never updates the selection. That separation lets
// you set Missile Door once and draw five of them, like the wall and area
// pickers in Draw mode.
//
// Stored here rather than in `stores/tools.ts` because it holds a `LockTypeId`,
// which only means something in the current project and needs pruning.

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useModelStore, dependOn } from './model'
import { OPEN_LOCK_ID } from '@/core/ids'
import type { LockTypeId } from '@/core/ids'
import type { TransitionOptions } from '@/core/ops/doors'

export const useDoorDefaultsStore = defineStore('doorDefaults', () => {
  const model = useModelStore()

  // `Open` is the default and the fallback: it is immutable, so there is always
  // something to fall back to. A fresh door reads as an open passage.
  const lockTypeId = ref<LockTypeId>(OPEN_LOCK_ID)

  // Direction: one-way in the direction drawn (not the Inspector's three-way
  // selector). At creation, the gesture decides the origin; the default only
  // controls the direction from there.
  const oneWay = ref(false)

  function selectLock(id: LockTypeId): void {
    lockTypeId.value = id
  }

  function setOneWay(value: boolean): void {
    oneWay.value = value
  }

  // The lock type can be deleted from the project (via the Hierarchy, undo, or
  // file load). Pruning resets to OPEN if it is deleted, so an undo-then-redo
  // that brings the lock back does not silently re-select it. Lock types are
  // project structure, so watch structureRev, not rev.
  function prune(): void {
    if (!model.project.lockTypes.has(lockTypeId.value)) lockTypeId.value = OPEN_LOCK_ID
  }

  watch([() => model.project, () => model.structureRev], prune, { flush: 'sync' })

  return {
    lockTypeId: computed(() => lockTypeId.value),
    oneWay: computed(() => oneWay.value),
    selectLock,
    setOneWay,

    // What a creation op should be handed. Resolved on read, not just on watch:
    // if `selectLock` is called with an already-unknown id, the watcher never
    // wakes, so we guard against a dangling id here.
    options: computed<TransitionOptions>(() => {
      // Subscribe to the plain-TS model via structureRev, since lock types are
      // project structure and do not update rev.
      dependOn(model.structureRev)
      const id = model.project.lockTypes.has(lockTypeId.value) ? lockTypeId.value : OPEN_LOCK_ID
      return { lockTypeId: id, oneWay: oneWay.value }
    }),
  }
})
