// The seam. The one place the non-reactive core model meets Vue.
//
// `src/core/` is deliberately plain TypeScript: wrapping a project's thousands
// of cells, walls and indices in reactive proxies costs memory on every one and
// puts a proxy trap in the middle of the render loop, and canvas drawing is
// imperative anyway. So Vue never observes the model. It learns that something
// changed only through the revision counters core maintains, republished here
// into refs after every committed change.
//
// Three rules follow, and every one of them is load-bearing:
//
//   1. The model never leaves here as a plain property. A Pinia setup store
//      hands its returned values to `reactive()`, and a `ProjectModel` returned
//      directly comes back proxied: measured, not assumed, `isReactive` is true
//      and the identity check fails. Every cell, wall and index entry gets a
//      proxy, which is the exact cost core was written to avoid, arriving silently.
//      Two independent guards stop this, and both are here on purpose: the model
//      is exposed through a `computed` (a ref's value is unwrapped as-is, never
//      re-wrapped), and it is `markRaw`-ed so that a future plain return is still
//      safe. The test asserts identity rather than `isReactive`, because identity
//      catches any wrapping however it arrives.
//
//   2. The published counters are a projection, not state. Nothing writes
//      to them except `sync()`, and they are exposed as computeds so nothing
//      can. That is what makes this different from the placeholder
//      `stores/project.ts` it replaces, which held a second copy of the project
//      name that core also owned and nothing kept in step.
//
//   3. Only committed changes are published. A gesture's speculative
//      transaction bumps nothing here on purpose. The ghost repaints by drawing
//      rather than by invalidating. That entry point is `beginGesture`, below.

import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'
import { createProject } from '@/core/factory'
import { History } from '@/core/history'
import { PROJECT_SCOPE } from '@/core/journal'
import { t } from '@/i18n'
import type { HistoryEffect } from '@/core/history'
import type { Transaction, TransactionScope } from '@/core/journal'
import type { MapId } from '@/core/ids'
import type { ProjectModel } from '@/core/types'

export { PROJECT_SCOPE }

export function mapScope(mapId: MapId): TransactionScope {
  return { kind: 'map', mapId }
}

// How a `computed` subscribes to the model. Core's objects are invisible to
// Vue, so a derivation over them has no dependency of its own and would be
// computed once and cached for ever; naming the counters it should recompute on
// is the subscription.
//
// A function rather than a bare `void model.structureRev` statement because the
// bare form reads like dead code and is exactly what a tidying pass deletes, at
// which point the tab bar silently stops updating and nothing fails.
//
//   const tabs = computed(() => {
//     dependOn(model.structureRev)
//     return model.project.maps.map(...)
//   })
//
// The arguments are read at the call site, which is the subscription; the
// body has nothing to do.
export function dependOn(...revisions: number[]): void {
  void revisions
}

// A pointer-driven edit in progress. The counterpart to `run` for gestures:
// where `run` opens, applies and commits in one call, this stays open across a
// whole drag, is rewound and re-applied on every pointer move, and settles once
// on release.
//
// It publishes nothing until it settles: rule 3 above. The canvas shows the
// pending state because the model is the pending state; the gesture repaints
// by drawing, not by invalidating.
export interface Gesture {
  // Rewinds everything applied so far and runs `body` against the pristine
  // model. The only way a gesture is allowed to mutate, which is what makes
  // preview and commit the same code path by construction rather than by
  // discipline.
  //
  // The rewind also restores the transaction's id source, so an object the
  // body creates comes back with the same id every time. Without that, every
  // pointer move would hand the gesture a different room.
  reapply(body: (transaction: Transaction) => void): void
  // Keeps the result as one undo step. An empty transaction is dropped, which
  // is what makes a stroke that changed no cell a true no-op rather than a
  // wasted Ctrl+Z.
  commit(): void
  // Esc: undo everything, keep nothing, leave no trace on the stack.
  cancel(): void
}

// What the Edit menu needs to render itself. Grouped into one published object
// rather than five refs because they are read together and change together:
// every one of them is a function of the same stack move.
export interface HistoryStatus {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  isDirty: boolean
}

// Core takes every user-visible name as a parameter so it never holds a second
// copy of what i18n owns. This is the caller that knows the locale.
function newProject(): ProjectModel {
  return createProject({
    projectName: t('name.project'),
    firstMapName: t('name.map', { n: 1 }),
    worldAreaName: t('name.areaWorld'),
    openLockName: t('name.lockOpen'),
    lockedLockName: t('name.lockLocked'),
  })
}

export const useModelStore = defineStore('model', () => {
  const model = shallowRef(markRaw(newProject()))
  const stack = shallowRef(markRaw(new History(model.value)))

  // The published projection. Private refs behind computeds: a caller that can
  // assign to `rev` can desynchronise the UI from the model in a way that looks
  // like a rendering bug for the rest of the project's life.
  const revState = ref(0)
  const structureRevState = ref(0)
  const nameState = ref(model.value.name)
  const tileSizeState = ref(model.value.settings.tileSize)
  const mapRevState = ref(new Map<MapId, number>())
  const statusState = ref<HistoryStatus>(readStatus(stack.value))

  function readStatus(history: History): HistoryStatus {
    return {
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      undoLabel: history.undoLabel,
      redoLabel: history.redoLabel,
      isDirty: history.isDirty,
    }
  }

  // Republishes everything Vue is allowed to see. Called after any path that
  // can have moved the model, and only those paths, so the cost is per
  // commit rather than per pointer move.
  //
  // The map revisions are rebuilt into a fresh Map rather than mutated in
  // place: assigning the ref is the trigger, and a per-map watcher still sees
  // an unchanged number for maps that did not move, so a paint stroke on one
  // tab does not invalidate the others.
  function sync(): void {
    const project = model.value
    revState.value = project.rev
    structureRevState.value = project.structureRev
    nameState.value = project.name
    tileSizeState.value = project.settings.tileSize
    const revs = new Map<MapId, number>()
    for (const mapId of project.maps) {
      const map = project.mapsById.get(mapId)
      if (map) revs.set(mapId, map.rev)
    }
    mapRevState.value = revs
    statusState.value = readStatus(stack.value)
  }

  // How undo reaches the tab bar. `History.applyEffect` must be the only thing
  // that calls this: it guards the replay flag that stops an undo-driven tab
  // switch from being recorded as a fresh navigation, which would clear the
  // redo branch (see history.ts). The tabs store registers itself at startup;
  // until it does, a history move that names a tab simply moves nothing.
  let activateMap: (mapId: MapId) => void = () => {}

  function onActivateMap(activate: (mapId: MapId) => void): void {
    activateMap = activate
  }

  // A tab switch is a history entry of its own, so undo retraces your path
  // through the tabs and never reverts an edit on a tab you cannot see. It
  // routes through here rather than straight to `History` so the published
  // status keeps up: without the `sync()`, switching tabs would leave the Edit
  // menu showing the previous step as undoable.
  //
  // `History` drops the call when it is itself replaying a navigation, so a
  // caller does not have to know when not to record.
  function pushNavigation(from: MapId, to: MapId): void {
    stack.value.pushNavigation(from, to, t('history.switchTab'))
    sync()
  }

  // The drive loop from the handoff, in one place: begin, run the ops, commit,
  // republish.
  //
  // It deliberately does not call `applyEffect`, which would be wrong on the
  // forward path: activating the step's own map can only
  // ever do nothing (you are already on the tab you are editing; you had to be
  // to make the edit) or take the user somewhere they did not ask to go. The
  // tab bar is the case that proves it: renaming or reordering an inactive tab
  // jumped to it. `undo` and `redo` still route through `applyEffect`, which is
  // where the scope is actually needed: they never undo a change on a tab you
  // cannot see. That is also where the replay guard matters. Actions that should
  // move the user, like activating a tab they just created, say so themselves.
  //
  // Returns whatever the body returned: an `Outcome`, the created map, or
  // nothing, because that is what the caller can act on. The `HistoryEffect`
  // is not it: this function has already applied it, and an empty transaction
  // is dropped by `History.commit`, which is what makes drag-back-to-origin a
  // true no-op rather than a wasted undo step.
  //
  // A throw rolls the transaction back before it escapes. Half-applied changes
  // that were never journaled are the one state the model cannot recover from,
  // and an op that throws `ModelError` on a bad id is a bug the developer needs
  // to see with the model still intact.
  function run<T>(label: string, scope: TransactionScope, body: (tx: Transaction) => T): T {
    const transaction = stack.value.begin(label, scope)
    let value: T
    try {
      value = body(transaction)
    } catch (error) {
      transaction.rollback()
      throw error
    }
    stack.value.commit(transaction)
    sync()
    return value
  }

  // The drag loop, in the seam so no gesture has to remember to `reset()`
  // first. See the `Gesture` interface above for what each method promises.
  //
  // Settling is idempotent on purpose. `Esc` mid-drag followed by the eventual
  // pointerup is the normal abort sequence, so the second call has to be a
  // no-op rather than a throw about committing a rolled-back transaction.
  function beginGesture(label: string, scope: TransactionScope): Gesture {
    const transaction = stack.value.begin(label, scope)
    let live = true

    return {
      reapply(body) {
        if (!live) return
        transaction.reset()
        try {
          body(transaction)
        } catch (error) {
          // Same reasoning as `run`: a half-applied change that was never
          // journaled is the one state the model cannot recover from.
          transaction.rollback()
          live = false
          throw error
        }
      },
      commit() {
        if (!live) return
        live = false
        stack.value.commit(transaction)
        sync()
      },
      cancel() {
        if (!live) return
        live = false
        transaction.rollback()
        // Deliberately no `sync()`. Rolling back restores exactly the state the
        // published counters already describe, so republishing would spend a
        // selection prune and every `dependOn` recompute in the app to announce
        // that nothing changed. Repainting the canvas (which was showing the
        // speculative state) is the caller's job, and it is the one thing that
        // does need doing.
      },
    }
  }

  function undo(): HistoryEffect | null {
    const effect = stack.value.undo()
    stack.value.applyEffect(effect, activateMap)
    sync()
    return effect
  }

  function redo(): HistoryEffect | null {
    const effect = stack.value.redo()
    stack.value.applyEffect(effect, activateMap)
    sync()
    return effect
  }

  // Swaps in a project from disk (the far side of `openProject(raw).accept()`)
  // or a brand new one. The History goes with it: an undo stack whose entries
  // close over the previous project's objects would replay changes into a
  // model that is no longer on screen.
  //
  // Deliberately does not prompt about unsaved work. `History.clear` is
  // explicit that whoever calls it owns that question, because afterwards there
  // is nothing left to warn about.
  function replaceProject(next: ProjectModel): void {
    model.value = markRaw(next)
    stack.value = markRaw(new History(model.value))
    sync()
  }

  function markSaved(): void {
    stack.value.markSaved()
    sync()
  }

  return {
    // The raw model. Read it, pass it to core ops, never assign to it.
    project: computed(() => model.value),
    history: computed(() => stack.value),

    rev: computed(() => revState.value),
    structureRev: computed(() => structureRevState.value),
    projectName: computed(() => nameState.value),
    // The on-screen size of one cell at zoom 1. Project-wide and saved with
    // the file, so every screen↔world conversion takes it from here rather
    // than from a constant the renderer owns.
    tileSize: computed(() => tileSizeState.value),
    status: computed(() => statusState.value),
    // A map that has never been touched reads 0, the same as a fresh one, so a
    // caller never has to distinguish "no entry" from "no changes".
    mapRev: computed(() => (mapId: MapId) => mapRevState.value.get(mapId) ?? 0),

    run,
    beginGesture,
    undo,
    redo,
    replaceProject,
    markSaved,
    onActivateMap,
    pushNavigation,
  }
})
