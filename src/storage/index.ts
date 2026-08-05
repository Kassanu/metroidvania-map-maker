// The only place a concrete provider is named.
//
// Everything above this imports `getStorageProvider()` and the interface, so
// the editor sees open and save rather than which browser it is running on.
// That is the seam the whole persistence design rests on, and cloud providers
// slot in here later without touching anything that calls it.
//
// Selection is by capability, never by user agent. `showSaveFilePicker` is
// absent in a cross-origin iframe on an engine that otherwise has it, and no
// amount of sniffing tells you that.

import { createDownloadProvider } from './downloadProvider'
import { createFsaProvider, supportsFileSystemAccess } from './fsaProvider'
import type { StorageProvider } from '@/core/storage/provider'

export type {
  OpenedProject,
  RecoveryStore,
  SnapshotAbout,
  SnapshotInfo,
  StorageEntry,
  StorageHandle,
  StorageProvider,
} from '@/core/storage/provider'
export { getRecoveryStore, setRecoveryStore } from './recoveryStore'
export {
  FILE_EXTENSION,
  FileMissingError,
  PermissionDeniedError,
  StorageError,
  safeFileName,
  withExtension,
} from '@/core/storage/provider'

let active: StorageProvider | null = null

// One instance per session. The provider holds no per-project state, so there
// is nothing to reset between projects; a fresh one would only mean a second
// object answering the same questions.
export function getStorageProvider(): StorageProvider {
  if (!active) {
    active = supportsFileSystemAccess() ? createFsaProvider() : createDownloadProvider()
  }
  return active
}

// Replaces the selected provider, for tests and for a future provider picker.
// Passing null restores capability-based selection on the next call.
export function setStorageProvider(provider: StorageProvider | null): void {
  active = provider
}
