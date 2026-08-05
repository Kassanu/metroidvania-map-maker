// The File System Access provider: the one that can genuinely save in place.
//
// Everything it knows about is bytes and handles. It parses nothing beyond
// text to `unknown`; validating the shape is `fromJSON`'s job, and the editor
// above it sees open and save rather than paths or handles.
//
// Cancellation is not failure. A user who dismisses a picker gets `null`, and
// only a real problem (permission refused, quota, a write that broke) becomes
// a `StorageError`. The distinction is what lets the File menu leave a
// project untouched and undirty-marked when someone changes their mind.

import { checkByteLength } from '@/core/serialize/limits'
import { FILE_EXTENSION, StorageError, safeFileName } from '@/core/storage/provider'
import type {
  OpenedProject,
  StorageEntry,
  StorageHandle,
  StorageProvider,
} from '@/core/storage/provider'

export const FSA_PROVIDER_ID = 'fsa'

// The custom type is safe here: Chromium filters on the extension list, and
// only a malformed MIME string is rejected. The `<input type="file">` fallback
// in the download provider is the one that needs the bare extension.
const PICKER_TYPES = [
  {
    description: 'Metroidvania Map Maker project',
    accept: { 'application/x-mvm+json': [FILE_EXTENSION] },
  },
]

// Keeps the picker returning to the folder the user last used, rather than
// starting from the default every time.
const PICKER_ID = 'mvm-project'

// The handle the editor passes around. It carries the real
// `FileSystemFileHandle`, which nothing above this file may read.
interface FsaHandle extends StorageHandle {
  readonly providerId: typeof FSA_PROVIDER_ID
  readonly file: FileSystemFileHandle
}

function wrap(file: FileSystemFileHandle): FsaHandle {
  return { providerId: FSA_PROVIDER_ID, name: file.name, file }
}

// A handle from another provider is a programming error rather than a user
// one, so it throws rather than returning a refusal the UI would have to word.
function unwrap(handle: StorageHandle): FileSystemFileHandle {
  const candidate = handle as FsaHandle
  if (candidate.providerId !== FSA_PROVIDER_ID || !candidate.file) {
    throw new StorageError('handle does not belong to this provider')
  }
  return candidate.file
}

// Whether this build can use the API at all. Feature-detected rather than
// sniffed: it is also false in a cross-origin iframe on a browser that
// otherwise supports it, and a user agent string cannot tell you that.
export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window
}

// A dismissed picker. Chromium throws `AbortError`; treating any DOMException
// named that way as a cancellation keeps it from reaching the user as a
// failure.
function isCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

// `requestPermission` must be called from a user gesture, so this is only ever
// reached from a click handler. Querying first means a handle that is already
// granted never prompts, which is what makes Save write straight back.
async function ensurePermission(
  file: FileSystemFileHandle,
  mode: 'read' | 'readwrite',
): Promise<boolean> {
  try {
    if ((await file.queryPermission({ mode })) === 'granted') return true
    return (await file.requestPermission({ mode })) === 'granted'
  } catch {
    // Older implementations lack the two methods entirely. Attempting the
    // operation is then the only way to find out, and it will raise its own
    // error if it is not allowed.
    return true
  }
}

// Bytes to `unknown`, with the size checked before the read.
//
// The cap has to be enforced on `File.size` rather than after: a file past it
// exhausts memory inside `text()`, where no later guard can still run.
async function readProject(file: FileSystemFileHandle): Promise<OpenedProject> {
  const blob = await file.getFile()
  checkByteLength(blob.size)
  const text = await blob.text()
  return { data: JSON.parse(text), handle: wrap(file) }
}

async function writeProject(file: FileSystemFileHandle, data: unknown): Promise<void> {
  // `createWritable` writes to a swap file and commits it on `close()`, so a
  // crash mid-write leaves the previous contents intact. Relied on rather than
  // reimplemented, and the reason nothing here writes a backup copy first.
  const writable = await file.createWritable()
  try {
    await writable.write(JSON.stringify(data, null, 2))
  } catch (error) {
    // Leaves the original file alone: the swap is discarded rather than
    // committed. Without this a failed write closes the stream and commits a
    // truncated file over the user's project.
    await writable.abort().catch(() => {})
    throw error
  }
  await writable.close()
}

export function createFsaProvider(): StorageProvider {
  return {
    id: FSA_PROVIDER_ID,
    label: 'This device',
    canSaveInPlace: true,

    // The API cannot enumerate anything on its own. Recent files are a list
    // this app keeps, and they arrive as handles to `open`.
    async list(): Promise<StorageEntry[]> {
      return []
    },

    async open(handle?: StorageHandle): Promise<OpenedProject | null> {
      if (handle) {
        const file = unwrap(handle)
        if (!(await ensurePermission(file, 'read'))) {
          throw new StorageError('permission to read the file was refused')
        }
        try {
          return await readProject(file)
        } catch (error) {
          throw asStorageError(error, 'could not read the file')
        }
      }

      let picked: FileSystemFileHandle[]
      try {
        picked = await showOpenFilePicker({ types: PICKER_TYPES, multiple: false, id: PICKER_ID })
      } catch (error) {
        if (isCancellation(error)) return null
        throw asStorageError(error, 'could not open the file picker')
      }

      try {
        return await readProject(picked[0])
      } catch (error) {
        throw asStorageError(error, 'could not read the file')
      }
    },

    async save(handle: StorageHandle, data: unknown): Promise<StorageHandle> {
      const file = unwrap(handle)
      if (!(await ensurePermission(file, 'readwrite'))) {
        throw new StorageError('permission to write the file was refused')
      }
      try {
        await writeProject(file, data)
      } catch (error) {
        throw asStorageError(error, 'could not write the file')
      }
      return wrap(file)
    },

    async saveAs(data: unknown, suggestedName: string): Promise<StorageHandle | null> {
      let file: FileSystemFileHandle
      try {
        file = await showSaveFilePicker({
          types: PICKER_TYPES,
          // Sanitized, not merely suffixed: the picker throws a TypeError on a
          // name the filesystem could not hold, which would make Save As fail
          // for a project whose name looks perfectly ordinary in the title bar.
          suggestedName: safeFileName(suggestedName),
          id: PICKER_ID,
        })
      } catch (error) {
        if (isCancellation(error)) return null
        throw asStorageError(error, 'could not open the save dialog')
      }

      // A picker that returned a handle has already created the file, so a
      // failure here leaves an empty file behind. That is the browser's
      // behaviour and not something this can undo; reporting it is what stops
      // the caller marking the project saved.
      try {
        await writeProject(file, data)
      } catch (error) {
        throw asStorageError(error, 'could not write the file')
      }
      return wrap(file)
    },
  }
}

// Keeps the original as `cause`, so a failure the user is shown a sentence
// about is still diagnosable from the console.
function asStorageError(error: unknown, message: string): StorageError {
  return error instanceof StorageError ? error : new StorageError(message, error)
}
