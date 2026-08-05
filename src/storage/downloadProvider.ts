// The fallback provider, for engines without File System Access.
//
// It cannot write in place, and it does not pretend to: `canSaveInPlace` is
// false, Save is a fresh download every time, and Open is a file input. The
// degraded story is an accepted cost, and the UI reads the flag rather than
// asking which browser it is on.
//
// One thing it genuinely cannot report. A download hands bytes to the browser
// and the browser owns what happens next: whether the user kept the file, or
// cancelled a "where do you want to save this?" dialog, is not observable. So
// a save here means "the bytes left the app", which is the strongest statement
// available and weaker than the one the FSA provider can make. Recovery
// snapshots are what cover the difference.

import { checkByteLength } from '@/core/serialize/limits'
import { FILE_EXTENSION, StorageError, safeFileName } from '@/core/storage/provider'
import type {
  OpenedProject,
  StorageEntry,
  StorageHandle,
  StorageProvider,
} from '@/core/storage/provider'

export const DOWNLOAD_PROVIDER_ID = 'download'

// The literal extension is required, not decorative. A file dialog matches on
// what the platform already knows, and a MIME type it has never heard of
// matches nothing, so the files show as unselectable.
const ACCEPT = `${FILE_EXTENSION},application/json`

// Nothing to hold: a downloaded file has no reference that survives the call.
// The name is here so the current-file indicator can say what was last
// written, which is the whole of what this provider can promise.
function nameOnly(name: string): StorageHandle {
  return { providerId: DOWNLOAD_PROVIDER_ID, name }
}

// Resolves with the chosen file, or null if the dialog was dismissed.
//
// Dismissal is the `cancel` event, which every engine this provider runs on
// has had for years. Without it the promise would never settle, so the element
// is removed on both paths and the listeners go with it.
function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = ACCEPT
    input.style.display = 'none'

    const finish = (file: File | null) => {
      input.remove()
      resolve(file)
    }

    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => finish(null), { once: true })

    document.body.append(input)
    input.click()
  })
}

async function readProject(file: File): Promise<unknown> {
  // On `File.size`, before the read, for the reason the other provider checks
  // it: a file past the cap exhausts memory inside `text()`.
  checkByteLength(file.size)
  return JSON.parse(await file.text())
}

function download(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/x-mvm+json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoking synchronously cancels the download in some engines, which is why
  // this waits a turn rather than tidying up immediately.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function createDownloadProvider(): StorageProvider {
  return {
    id: DOWNLOAD_PROVIDER_ID,
    label: 'This device',
    canSaveInPlace: false,

    // A downloaded file leaves no reference behind, so there is nothing this
    // could enumerate and nothing worth keeping when asked to. Recent files
    // renders an empty list as an absent menu rather than an empty one.
    async list(): Promise<StorageEntry[]> {
      return []
    },

    async remember(): Promise<void> {},

    async forget(): Promise<void> {},

    async open(handle?: StorageHandle): Promise<OpenedProject | null> {
      // Reopening is what a handle is for, and this provider never issues one
      // that holds a file. Offering the picker instead would silently open
      // something other than what was asked for.
      if (handle) {
        throw new StorageError('this provider cannot reopen a file')
      }

      const file = await pickFile()
      if (!file) return null

      try {
        return { data: await readProject(file), handle: nameOnly(file.name) }
      } catch (error) {
        throw asStorageError(error, 'could not read the file')
      }
    },

    // Permitted to behave as `saveAs` by the interface, which is what
    // `canSaveInPlace: false` announces. The handle's name is reused so saving
    // a project opened as `world.mvm` downloads `world.mvm` rather than
    // starting from the project name again.
    async save(handle: StorageHandle, data: unknown): Promise<StorageHandle> {
      const filename = safeFileName(handle.name)
      try {
        download(data, filename)
      } catch (error) {
        throw asStorageError(error, 'could not save the file')
      }
      return nameOnly(filename)
    },

    // Never resolves null: there is no dialog to dismiss, because the browser
    // owns whatever prompt it decides to show and does not report the outcome.
    async saveAs(data: unknown, suggestedName: string): Promise<StorageHandle | null> {
      const filename = safeFileName(suggestedName)
      try {
        download(data, filename)
      } catch (error) {
        throw asStorageError(error, 'could not save the file')
      }
      return nameOnly(filename)
    },
  }
}

function asStorageError(error: unknown, message: string): StorageError {
  return error instanceof StorageError ? error : new StorageError(message, error)
}
