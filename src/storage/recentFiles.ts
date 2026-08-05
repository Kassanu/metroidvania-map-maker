// The recent-files list, kept whole under one IndexedDB key.
//
// One key holding the ordered array rather than a record per entry, for one
// reason: a list has an order and a ceiling, and both are properties of the
// list rather than of any entry in it. Writing it as a single value makes
// every change one transaction, so a reorder can never half-apply and two
// entries can never claim the same position.
//
// It lives in IndexedDB rather than beside the other preferences because of
// what it carries. `JSON.stringify(fileHandle)` is `{}`: a
// `FileSystemFileHandle` is structured-cloneable and not serializable, so
// localStorage physically cannot hold one. Splitting the names into
// localStorage and the handles here would only invent a state where an entry
// exists and the thing that makes it useful does not.

import { idbStore } from '@/lib/idb'
import type { KeyValueStore } from '@/lib/idb'
import type { StorageEntry, StorageHandle } from '@/core/storage/provider'

// Long enough to hold a working set, short enough that the menu stays a menu.
const MAX_ENTRIES = 10

const KEY = 'recent'

// Two handles name the same project when the file behind them is the same
// one. `isSameEntry` is asynchronous on purpose: `FileSystemFileHandle` can
// only answer that through `isSameEntry`, and comparing names would merge two
// different `world.mvm` files in two different folders.
export type SameFile = (a: StorageHandle, b: StorageHandle) => Promise<boolean>

function isRecord(value: unknown): value is StorageEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<StorageEntry>
  return (
    typeof entry.name === 'string' &&
    typeof entry.lastOpenedAt === 'number' &&
    Number.isFinite(entry.lastOpenedAt) &&
    typeof entry.handle === 'object' &&
    entry.handle !== null
  )
}

export interface RecentFiles {
  // Newest first, capped, and never throwing: an unreadable store reads as an
  // empty list, which is a menu that is absent rather than an app that is not.
  list(): Promise<StorageEntry[]>
  remember(handle: StorageHandle): Promise<void>
  forget(handle: StorageHandle): Promise<void>
}

export function createRecentFiles(
  sameFile: SameFile,
  store: KeyValueStore = idbStore('handles'),
): RecentFiles {
  async function read(): Promise<StorageEntry[]> {
    const stored = await store.get<unknown>(KEY)
    if (!Array.isArray(stored)) return []
    return stored.filter(isRecord).slice(0, MAX_ENTRIES)
  }

  // Everything else in the entry is derived from the handle, so a handle that
  // fails to clone (a future provider whose handle is not a plain value) makes
  // the write a no-op rather than a corrupt list. The layer below swallows it.
  async function write(entries: StorageEntry[]): Promise<void> {
    await store.put(KEY, entries.slice(0, MAX_ENTRIES))
  }

  // The index of the entry naming the same file, or -1. Linear and awaited per
  // entry, which is fine at ten and is what `isSameEntry` costs.
  async function indexOf(entries: StorageEntry[], handle: StorageHandle): Promise<number> {
    for (let i = 0; i < entries.length; i++) {
      if (await sameFile(entries[i].handle, handle)) return i
    }
    return -1
  }

  return {
    list: read,

    async remember(handle) {
      const entries = await read()
      const existing = await indexOf(entries, handle)
      if (existing >= 0) entries.splice(existing, 1)
      // Front, so the list is most-recently-used rather than
      // most-recently-discovered. Reopening the oldest entry moves it up.
      entries.unshift({ handle, name: handle.name, lastOpenedAt: Date.now() })
      await write(entries)
    },

    async forget(handle) {
      const entries = await read()
      const existing = await indexOf(entries, handle)
      if (existing < 0) return
      entries.splice(existing, 1)
      await write(entries)
    },
  }
}
