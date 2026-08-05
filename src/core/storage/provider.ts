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
  const trimmed = name.trim() || FALLBACK_NAME
  return trimmed.toLowerCase().endsWith(FILE_EXTENSION) ? trimmed : `${trimmed}${FILE_EXTENSION}`
}
const FALLBACK_NAME = 'Untitled Project'

// Path separators, the punctuation Windows refuses in a filename, and every
// control character. Spaces are legitimate and are kept.
const UNSAFE_IN_FILENAME = /[<>:"/\\|?*\u0000-\u001f\u007f]/g

// Device names Windows refuses whatever follows them, so `con.mvm` cannot be
// created there either.
const RESERVED_STEM = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

// Long enough for any name a person types, short enough that the whole path
// stays inside the shortest limit a common filesystem imposes.
const MAX_STEM = 120

// A project name turned into something a file picker will accept.
//
// The picker is stricter than the name field: a project called `a/b`, or one
// carrying a tab character, makes `showSaveFilePicker` throw a TypeError. Save
// As would then fail permanently for a project the user can still rename but
// has no reason to suspect. Trailing dots and spaces go for the same reason:
// Windows strips them silently, and the file no longer matches the name that
// was asked for.
export function safeFileName(projectName: string): string {
  let stem = projectName
    .replace(UNSAFE_IN_FILENAME, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_STEM)
    // After the truncation, which can expose a new trailing dot or space.
    .replace(/[. ]+$/, '')

  // Tested against the part before the first dot, since the reservation
  // applies to the device name however the file is suffixed.
  if (!stem || RESERVED_STEM.test(stem.split('.')[0])) stem = FALLBACK_NAME
  return withExtension(stem)
}
