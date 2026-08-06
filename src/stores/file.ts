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
import type { LimitName } from '@/core/serialize/limits'
import { InvalidFileError } from '@/core/serialize/errors'
import { UnsupportedVersionError } from '@/core/serialize/migrate'
import { FILE_VERSION } from '@/core/serialize/schema'
import {
  FileMissingError,
  PermissionDeniedError,
  StorageError,
  getStorageProvider,
} from '@/storage'
import type { StorageEntry, StorageHandle } from '@/storage'
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
  // Carries the numbers, not just the fact: "10001 rooms on one map, and the
  // most is 10000" is something a person can act on, where "too large" is not.
  | { kind: 'too-large'; limit: LimitName; found: number; allowed: number }
  | { kind: 'too-new'; version: number; supported: number }
  // The two ways a file the app already knows about stops opening. Both carry
  // a way to drop the entry that named it, since an entry that cannot be
  // opened is one the user wants gone and nothing else.
  | { kind: 'missing'; name: string; forget: () => void }
  | { kind: 'permission-refused'; name: string; forget: () => void }
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

  // Files this app has opened or written, newest first. Held in memory so the
  // menu renders from what is already known: reading storage when the menu
  // opens would make the list appear a frame after the menu did.
  const recent = shallowRef<StorageEntry[]>([])

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

  // Reads the recent list back into memory. Called after anything that can
  // have changed it, and once at startup.
  async function refreshRecent(): Promise<void> {
    recent.value = await getStorageProvider().list()
  }

  // A handle that has just proved it works, which is the only kind worth
  // offering again. Called on the far side of a read or a write and nowhere
  // else, for the same reason `markSaved` follows the bytes.
  async function remember(from: StorageHandle): Promise<void> {
    await getStorageProvider().remember(from)
    await refreshRecent()
  }

  async function forgetRecent(from: StorageHandle): Promise<void> {
    await getStorageProvider().forget(from)
    await refreshRecent()
  }

  // A `.mvm` the operating system launched the app with. Nothing but the
  // provider knows what to make of the platform's own handle, and a provider
  // that cannot use one says so rather than being asked whether it is the
  // right kind.
  //
  // Everything after that is Open: the same guard, the same loader, the same
  // dialogs. The launch is only a different way of arriving.
  async function openLaunched(file: FileSystemFileHandle): Promise<boolean> {
    const adopted = getStorageProvider().adoptFileHandle(file)
    if (!adopted) return false
    return await open(adopted)
  }

  // The far side of a project that was never written: a crash snapshot,
  // adopted through the same gate a file gets.
  //
  // Adopted dirty and with no file, because that is exactly what it is. It
  // cannot use `adopt`, whose whole job is to say the opposite. The identity
  // comes from the snapshot so that later autosaves overwrite it rather than
  // starting a second snapshot of the same work.
  async function restoreSnapshot(data: unknown, key: string): Promise<boolean> {
    if (busy.value) return false
    if (!(await confirmDiscard())) return false

    busy.value = true
    try {
      const pending = openPending(data)
      if (pending.requiresConfirmation) {
        outcome.value = {
          kind: 'repaired',
          counts: countByKind(pending.report),
          accept: () => adoptRecovered(pending.accept(), key),
        }
        return false
      }

      adoptRecovered(pending.accept(), key)
      return true
    } catch (error) {
      outcome.value = describeFailure(error)
      return false
    } finally {
      busy.value = false
    }
  }

  function adoptRecovered(next: ProjectModel, key: string): void {
    model.replaceProject(next, key)
    handle.value = null
    model.markNeverSaved()
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
          accept: () => {
            adopt(pending.accept(), opened.handle)
            void remember(opened.handle)
          },
        }
        return false
      }

      adopt(pending.accept(), opened.handle)
      await remember(opened.handle)
      return true
    } catch (error) {
      outcome.value = failureOf(error, from ?? null)
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

    const writingTo = handle.value
    busy.value = true
    try {
      handle.value = await getStorageProvider().save(writingTo, toJSON(model.project))
      model.markSaved()
      await remember(handle.value)
      return true
    } catch (error) {
      outcome.value = failureOf(error, writingTo)
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
      await remember(saved)
      return true
    } catch (error) {
      outcome.value = failureOf(error, null)
      return false
    } finally {
      busy.value = false
    }
  }

  // A failure that names a file the app already knew about is worth its own
  // sentence, and its own way out: the entry that led here is what the user
  // wants rid of. Everything else falls through to the shared wording.
  //
  // Tested before the unwrapping in `describeFailure`, which would otherwise
  // reach past these to the DOMException they carry as their cause.
  function failureOf(error: unknown, from: StorageHandle | null): LoadOutcome {
    if (from) {
      if (error instanceof FileMissingError) {
        return { kind: 'missing', name: from.name, forget: () => void forgetRecent(from) }
      }
      if (error instanceof PermissionDeniedError) {
        return {
          kind: 'permission-refused',
          name: from.name,
          forget: () => void forgetRecent(from),
        }
      }
    }
    return describeFailure(error)
  }

  return {
    handle: computed(() => handle.value),
    fileName,
    canSaveInPlace,
    busy: computed(() => busy.value),
    unsavedPromptOpen,
    outcome: computed(() => outcome.value),
    recent: computed(() => recent.value),

    newProject,
    open,
    save,
    saveAs,
    restoreSnapshot,
    openLaunched,
    refreshRecent,
    forgetRecent,
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

  if (inner instanceof FileTooLargeError) {
    return { kind: 'too-large', limit: inner.limit, found: inner.found, allowed: inner.allowed }
  }
  if (inner instanceof UnsupportedVersionError) {
    return { kind: 'too-new', version: inner.version, supported: FILE_VERSION }
  }
  if (inner instanceof InvalidFileError) return { kind: 'invalid' }
  if (inner instanceof SyntaxError) return { kind: 'invalid' }
  return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
}
