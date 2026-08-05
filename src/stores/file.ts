// The File menu's verbs, and the one place that decides a project is saved.
//
// Three rules hold this together, and every one of them is load-bearing:
//
//   1. `markSaved()` follows the bytes. It runs only where a write has come
//      back without throwing. A cancelled picker, a refused permission, a
//      failed write and a quota error all leave the project dirty, because the
//      user's work is not on disk and the title bar must not say otherwise.
//
//   2. Unsaved work is asked about in exactly one place. `confirmDiscard` is
//      the whole question, and New, Open and anything later that replaces the
//      project await it. Saving from inside it can itself fail or be
//      cancelled, and that cancels the operation that asked.
//
//   3. Nothing here knows where a file lives. It holds an opaque
//      `StorageHandle` and asks the provider, so the same code runs against a
//      real file handle and against a download that cannot be written back to.
//      The provider is fetched per call rather than held: capturing it at
//      setup would outlive any later change to it, and a store created before
//      the choice was made would keep answering with the wrong one for the
//      life of the session.

import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { openProject as openPending, toJSON } from '@/core/serialize'
import type { LoadEventKind } from '@/core/serialize'
import { countByKind } from '@/core/serialize'
import { FileTooLargeError } from '@/core/serialize/limits'
import { InvalidFileError } from '@/core/serialize/errors'
import { UnsupportedVersionError } from '@/core/serialize/migrate'
import { StorageError, getStorageProvider } from '@/storage'
import type { StorageHandle } from '@/storage'
import { createProject } from '@/core/factory'
import type { ProjectModel } from '@/core/types'
import { t } from '@/i18n'
import { useModelStore } from './model'

// What the three-way prompt can come back with. `cancel` is also what a
// dismissed dialog means, so there is no fourth "closed without choosing".
export type UnsavedChoice = 'save' | 'discard' | 'cancel'

// Why a load stopped short. `repaired` still holds a project, waiting on the
// user; the rest are refusals with nothing behind them.
export type LoadOutcome =
  | { kind: 'repaired'; counts: Map<LoadEventKind, number>; accept: () => void }
  | { kind: 'invalid' }
  | { kind: 'too-large'; limit: string }
  | { kind: 'too-new' }
  | { kind: 'failed'; message: string }

function newProjectModel() {
  return createProject({
    projectName: t('name.project'),
    firstMapName: t('name.map', { n: 1 }),
    worldAreaName: t('name.areaWorld'),
    openLockName: t('name.lockOpen'),
    lockedLockName: t('name.lockLocked'),
  })
}

export const useFileStore = defineStore('file', () => {
  const model = useModelStore()

  // The file the project came from, or null for one that has never been
  // saved. Opaque by design: nothing outside the provider may look inside it.
  const handle = shallowRef<StorageHandle | null>(null)

  // One operation at a time. A second Save started while the first is still
  // writing would race the handle, and the menu disables itself off this.
  const busy = ref(false)

  // The pending three-way question. Held here rather than in the dialog's own
  // open state: Reka closes an AlertDialog before running the handler of the
  // button that was picked, so a resolver living in the open state would be
  // cleared a beat before anything could read it.
  const pendingChoice = shallowRef<((choice: UnsavedChoice) => void) | null>(null)

  const outcome = shallowRef<LoadOutcome | null>(null)

  const fileName = computed(() => handle.value?.name ?? null)
  const canSaveInPlace = computed(() => getStorageProvider().canSaveInPlace)
  const unsavedPromptOpen = computed(() => pendingChoice.value !== null)

  // Answers the pending question. Called by the dialog's three buttons and by
  // its dismissal, which means cancel.
  function chooseUnsaved(choice: UnsavedChoice): void {
    const resolve = pendingChoice.value
    pendingChoice.value = null
    resolve?.(choice)
  }

  function dismissOutcome(): void {
    outcome.value = null
  }

  // Whether the caller may go ahead and replace the project.
  //
  // The three-way prompt, and the only place it is asked. A clean project
  // answers true without asking anything.
  async function confirmDiscard(): Promise<boolean> {
    if (!model.status.isDirty) return true

    const choice = await new Promise<UnsavedChoice>((resolve) => {
      pendingChoice.value = resolve
    })

    if (choice === 'cancel') return false
    if (choice === 'discard') return true
    // Saving is allowed to fail or be cancelled, and either one cancels the
    // operation that asked. Discarding work because a save quietly did not
    // happen is the failure this whole store exists to prevent.
    return await save()
  }

  // Swaps in a project and forgets the file it came from, unless one is given.
  // The history goes with it, which is `replaceProject`'s contract.
  function adopt(next: ProjectModel, from: StorageHandle | null): void {
    model.replaceProject(next)
    handle.value = from
    // A project that has just been loaded or created is not unsaved work.
    model.markSaved()
  }

  async function newProject(): Promise<boolean> {
    if (busy.value) return false
    if (!(await confirmDiscard())) return false
    adopt(newProjectModel(), null)
    return true
  }

  async function open(from?: StorageHandle): Promise<boolean> {
    if (busy.value) return false
    if (!(await confirmDiscard())) return false

    busy.value = true
    try {
      const opened = await getStorageProvider().open(from)
      // A dismissed picker is not a failure and says nothing to the user.
      if (!opened) return false

      const pending = openPending(opened.data)
      if (pending.requiresConfirmation) {
        // The repaired project is reachable only through `accept()`, so the
        // dialog holds the closure rather than the project. Declining drops it.
        outcome.value = {
          kind: 'repaired',
          counts: countByKind(pending.report),
          accept: () => adopt(pending.accept(), opened.handle),
        }
        return false
      }

      adopt(pending.accept(), opened.handle)
      return true
    } catch (error) {
      outcome.value = describeFailure(error)
      return false
    } finally {
      busy.value = false
    }
  }

  // True only when the bytes are written. Everything else about this function
  // exists to make that sentence true.
  async function save(): Promise<boolean> {
    if (busy.value) return false
    // Nowhere to write back to, so Save is Save As. This is also the whole of
    // what `canSaveInPlace: false` costs: the provider is handed the same call
    // and prompts every time.
    if (!handle.value) return await saveAs()

    busy.value = true
    try {
      handle.value = await getStorageProvider().save(handle.value, toJSON(model.project))
      model.markSaved()
      return true
    } catch (error) {
      outcome.value = describeFailure(error)
      return false
    } finally {
      busy.value = false
    }
  }

  async function saveAs(): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    try {
      const saved = await getStorageProvider().saveAs(
        toJSON(model.project),
        handle.value?.name ?? model.projectName,
      )
      // Dismissed, so nothing was written and nothing is marked.
      if (!saved) return false

      handle.value = saved
      model.markSaved()
      return true
    } catch (error) {
      outcome.value = describeFailure(error)
      return false
    } finally {
      busy.value = false
    }
  }

  return {
    handle: computed(() => handle.value),
    fileName,
    canSaveInPlace,
    busy: computed(() => busy.value),
    unsavedPromptOpen,
    outcome: computed(() => outcome.value),

    newProject,
    open,
    save,
    saveAs,
    confirmDiscard,
    chooseUnsaved,
    dismissOutcome,
  }
})

// Every refusal the load path can produce, told apart by its type rather than
// by reading a message. A `StorageError` that wraps one of the loader's own
// errors is unwrapped, since the inner one is what the user needs told.
function describeFailure(error: unknown): LoadOutcome {
  const inner = error instanceof StorageError && error.cause ? error.cause : error

  if (inner instanceof FileTooLargeError) return { kind: 'too-large', limit: inner.limit }
  if (inner instanceof UnsupportedVersionError) return { kind: 'too-new' }
  if (inner instanceof InvalidFileError) return { kind: 'invalid' }
  if (inner instanceof SyntaxError) return { kind: 'invalid' }
  return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
}
