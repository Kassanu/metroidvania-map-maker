// Autosave, and the offer that hands the work back.
//
// The promise it makes is narrow and worth stating exactly: work that was
// never written to a file survives the tab dying. It is not a save. Nothing
// here ever touches the user's file, so a crash, a bad autosave and a corrupt
// snapshot all leave what is on disk exactly as the user last left it.
//
// Four rules hold it together:
//
//   1. Snapshots follow committed revisions. A gesture mid-drag is holding
//      speculative state the user has not asked for and may still cancel, so
//      a write that comes due during one waits for it to settle. The tab
//      going away does not change that.
//
//   2. Clean means nothing to recover. The snapshot is removed the moment the
//      project matches a file, whether that came from saving or from undoing
//      back to the saved point.
//
//   3. A project leaving the session takes its snapshot with it. By then the
//      guard has already been answered, so the work was either written or its
//      loss was explicitly chosen; offering it back next launch would be the
//      app second-guessing that answer.
//
//   4. Storage that does not work costs autosave and nothing else. Every call
//      into the layer below resolves, so a browser with IndexedDB blocked gets
//      an app with no recovery rather than no app. That is also why nothing
//      here tells the user autosave is running: a promise made on screen and
//      broken silently underneath is worse than no promise.

import { defineStore } from 'pinia'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { toJSON } from '@/core/serialize'
import { requestPersistentStorage } from '@/lib/idb'
import { getRecoveryStore } from '@/storage'
import type { SnapshotInfo } from '@/storage'
import { useFileStore } from './file'
import { useModelStore } from './model'

// Long enough that a stroke and its neighbours coalesce into one write,
// short enough that what is lost to a crash is a few seconds of drawing.
const DEBOUNCE_MS = 2_000

// The ceiling on that debounce. Continuous editing never pauses, and a
// trailing debounce alone would mean no snapshot at all for as long as the
// user keeps working, which is the session where one matters most.
const MAX_WAIT_MS = 15_000

// How long to wait before looking again when a write comes due mid-gesture.
// A fixed delay rather than a recomputed one: with the ceiling already passed,
// rescheduling off it would spin.
const GESTURE_RECHECK_MS = 250

export const useRecoveryStore = defineStore('recovery', () => {
  const model = useModelStore()
  const file = useFileStore()

  // Snapshots found at startup and not yet answered. Empty is the normal
  // state and means the dialog is not showing.
  const offered = shallowRef<SnapshotInfo[]>([])

  let timer: ReturnType<typeof setTimeout> | null = null
  // When the oldest deferred change arrived, or 0 when nothing is pending.
  // What the ceiling is measured from.
  let deferredSince = 0
  let writing = false
  let askedToPersist = false

  function schedule(): void {
    if (deferredSince === 0) deferredSince = Date.now()
    const waited = Date.now() - deferredSince
    const delay = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - waited))
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(fire, delay)
  }

  function cancelPending(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
    deferredSince = 0
  }

  function fire(): void {
    timer = null
    if (model.gestureActive || writing) {
      timer = setTimeout(fire, GESTURE_RECHECK_MS)
      return
    }
    deferredSince = 0
    void write()
  }

  async function write(): Promise<void> {
    if (!model.status.isDirty) return
    // Read together and before the first await, so the payload, the name and
    // the key all describe the same project.
    const key = model.projectKey
    const about = { projectName: model.projectName, fileName: file.fileName }
    const data = toJSON(model.project)

    writing = true
    try {
      await getRecoveryStore().put(key, data, about)
    } finally {
      writing = false
    }

    // Asked once there is something worth keeping rather than at startup,
    // where Firefox's prompt would arrive before the user has drawn anything.
    if (!askedToPersist) {
      askedToPersist = true
      void requestPersistentStorage()
    }
  }

  function forget(key: string): void {
    void getRecoveryStore().remove(key)
  }

  // The last moment the browser reliably offers. `beforeunload` and `unload`
  // are skipped outright when a tab is discarded under memory pressure or the
  // process is killed, and `hidden` precedes all of those; it also covers
  // switching away from the tab, which is when a laptop lid tends to close.
  //
  // A gesture in flight is left alone, pending write and all: rule 1 does not
  // stop applying because the tab is going away.
  function flush(): void {
    if (document.visibilityState !== 'hidden' || model.gestureActive) return
    cancelPending()
    void write()
  }

  document.addEventListener('visibilitychange', flush)
  onScopeDispose(() => document.removeEventListener('visibilitychange', flush))

  // Committed revisions only. The published counter moves on commit and on
  // nothing else, which is what makes rule 1 hold for everything except a
  // write that comes due while a drag is open; `fire` covers that.
  watch(() => model.rev, schedule)

  watch(
    () => model.status.isDirty,
    (dirty) => {
      if (dirty) return
      cancelPending()
      forget(model.projectKey)
    },
  )

  // Synchronous, so a pending write cannot fire between the swap and this.
  watch(
    () => model.projectKey,
    (_current, previous) => {
      cancelPending()
      if (previous) forget(previous)
    },
    { flush: 'sync' },
  )

  // What is there, once, at startup. Deliberately not re-run later: a snapshot
  // appearing mid-session is this tab's own autosave, and offering the user
  // their own current work back would be nonsense.
  async function scan(): Promise<void> {
    offered.value = await getRecoveryStore().list()
  }

  // Takes the work back. The row goes either way: it has been answered, and
  // anything that went wrong with it is reported by the load dialog. Any
  // other rows stay, and recovering one of those is then a replacement like
  // any other, guarded like any other.
  async function recover(key: string): Promise<void> {
    const data = await getRecoveryStore().get(key)
    offered.value = offered.value.filter((info) => info.key !== key)
    // Gone or unreadable between the scan and the click. There is nothing to
    // recover and nothing useful to say about it.
    if (data === null) return
    await file.restoreSnapshot(data, key)
  }

  // Throwing the work away, which is the only thing that stops it being
  // offered again.
  function discard(key: string): void {
    offered.value = offered.value.filter((info) => info.key !== key)
    forget(key)
  }

  // Closing the offer without answering it. The snapshots stay, so they are
  // offered again next launch; `discard` is how a user stops being asked.
  function dismiss(): void {
    offered.value = []
  }

  return {
    offered: computed(() => offered.value),
    scan,
    recover,
    discard,
    dismiss,
  }
})
