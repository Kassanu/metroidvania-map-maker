// The persistence seam: all persistence goes behind a `StorageProvider`
// interface (list, open, save, saveAs). Local file (FSA and download) and
// localStorage are the first implementations. Cloud providers can be added
// later without touching the editor.
//
// This file is the interface and nothing else. It deliberately knows about
// `.mvm` bytes and handles, not the model. `toJSON`/`fromJSON` sit underneath
// and stay pure, which lets a provider be swapped without the serializer or
// editor noticing.
//
// Chromium and Firefox have different capabilities (Chromium can save in place
// via File System Access; Firefox cannot), so the interface models that with
// `canSaveInPlace` rather than pretending both behave the same.

export const FILE_EXTENSION = '.mvm'

// An opaque reference to a stored project. What is inside depends entirely on
// the provider (an FSA handle, a localStorage key, a cloud file id). The
// editor must never look.
export interface StorageHandle {
  readonly providerId: string
  // Shown in the "current file" indicator, which the Firefox story leans on.
  readonly name: string
}

export interface StorageEntry {
  handle: StorageHandle
  name: string
  // Milliseconds since the epoch, or null where a provider cannot report it.
  modifiedAt: number | null
}

// The result of opening: the raw parsed JSON, plus the handle to save back to.
// Parsing is the provider's job only insofar as bytes -> unknown; validating
// the shape is `fromJSON`'s.
export interface OpenedProject {
  data: unknown
  handle: StorageHandle
}

export interface StorageProvider {
  readonly id: string
  // For the provider picker, once there is more than one.
  readonly label: string

  // Whether Save can write back to an existing handle. False on Firefox's
  // download-based local provider, where every save is a fresh copy. The
  // degraded story is made visible rather than faked.
  readonly canSaveInPlace: boolean

  // Recent/known projects. May be empty for providers that cannot enumerate
  // (a download-only local provider has nothing to list).
  list(): Promise<StorageEntry[]>

  // Prompts the user if the provider needs it (a file picker), or resolves the
  // given handle directly.
  open(handle?: StorageHandle): Promise<OpenedProject | null>

  // Writes back to `handle`. Providers with `canSaveInPlace === false` are
  // permitted to treat this as `saveAs`.
  save(handle: StorageHandle, data: unknown): Promise<StorageHandle>

  // Always prompts for a destination.
  saveAs(data: unknown, suggestedName: string): Promise<StorageHandle | null>
}

// Crash-recovery snapshots are a distinct channel from the project file:
// keyed per project so New/Open can never clobber another project's recovery.
// Kept as its own interface rather than bolted onto StorageProvider, because
// a cloud provider has no business implementing autosave and the local one has
// no business implementing it twice.
export interface RecoveryStore {
  // `key` identifies the project, not the file location. A project saved to a
  // new location keeps its recovery history.
  put(key: string, data: unknown): Promise<void>
  get(key: string): Promise<unknown | null>
  remove(key: string): Promise<void>
  list(): Promise<{ key: string; savedAt: number }[]>
}

export class StorageError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'StorageError'
    this.cause = cause
  }
}

// Appends the extension if the user did not type it, so a suggested filename
// is always a `.mvm`.
export function withExtension(name: string): string {
  const trimmed = name.trim() || 'Untitled Project'
  return trimmed.toLowerCase().endsWith(FILE_EXTENSION) ? trimmed : `${trimmed}${FILE_EXTENSION}`
}
