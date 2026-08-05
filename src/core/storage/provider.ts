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
  // When this app last opened the project, in milliseconds since the epoch.
  // The ordering key for a recent list, and deliberately not the file's own
  // modification time: reading that costs a permission prompt per entry, which
  // is the whole thing a recent list exists to avoid.
  lastOpenedAt: number
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

  // Recent/known projects, newest first. May be empty for providers that
  // cannot enumerate: a download-only local provider issues no handle that
  // survives the call, so it has nothing to list and the menu is absent.
  list(): Promise<StorageEntry[]>

  // Adds a handle to that list, or moves it to the front if it is already
  // there. Called where a handle has just proved it works, which is the far
  // side of a successful open or save and nowhere else.
  remember(handle: StorageHandle): Promise<void>

  // Drops a handle from the list. The user's answer to an entry that no longer
  // opens, and the only way one leaves other than falling off the end.
  forget(handle: StorageHandle): Promise<void>

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
// What the recovery offer has to say about a snapshot before anyone decides
// whether they want it. Stored beside the payload rather than read out of it,
// so listing what is there does not mean parsing every snapshot to find out.
export interface SnapshotAbout {
  projectName: string
  // The file the work came from, or null for a project that was never saved.
  fileName: string | null
}

export interface SnapshotInfo extends SnapshotAbout {
  key: string
  // Milliseconds since the epoch.
  savedAt: number
}

export interface RecoveryStore {
  // `key` identifies the project, not the file location. A project saved to a
  // new location keeps its recovery history.
  put(key: string, data: unknown, about: SnapshotAbout): Promise<void>
  get(key: string): Promise<unknown | null>
  remove(key: string): Promise<void>
  // Newest first.
  list(): Promise<SnapshotInfo[]>
}

export class StorageError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'StorageError'
    this.cause = cause
  }
}

// The two ways a handle that worked once stops working. Both are ordinary
// rather than exceptional: a file gets moved, and permission does not survive
// a reload. They are separate classes because the caller does different things
// with them, and because telling failures apart by reading a message is how a
// reworded string silently changes behaviour.

// The file is not where the handle says it is: moved, renamed, or deleted.
export class FileMissingError extends StorageError {
  constructor(cause?: unknown) {
    super('the file is no longer there', cause)
    this.name = 'FileMissingError'
  }
}

// The user declined the browser's prompt, or the prompt could not be shown
// because the click that led here was too long ago.
export class PermissionDeniedError extends StorageError {
  constructor(cause?: unknown) {
    super('permission to use the file was refused', cause)
    this.name = 'PermissionDeniedError'
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
    // Trailing, after the truncation, which can expose a new dot or space.
    // Leading, because a name starting with a dot is a hidden file on Unix,
    // and `..` from a path-shaped project name reads as one.
    .replace(/[. ]+$/, '')
    .replace(/^[. ]+/, '')

  // Tested against the part before the first dot, since the reservation
  // applies to the device name however the file is suffixed.
  if (!stem || RESERVED_STEM.test(stem.split('.')[0])) stem = FALLBACK_NAME
  return withExtension(stem)
}
