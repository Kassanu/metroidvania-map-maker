// Crash-recovery snapshots, over the IndexedDB layer.
//
// A snapshot is a `.mvm` payload and nothing else, so recovering one runs the
// full loader with every limit and guard a file off disk gets. It was written
// by this build, which is the argument for trusting it and exactly the reason
// a corrupted store would otherwise load unchecked.
//
// One key per project and never a global slot, so opening a second project
// cannot overwrite the first one's unrecovered work.
//
// Each write is a single `put`: IndexedDB either commits the transaction or
// does not, so a crash mid-write leaves the previous snapshot whole. Nothing
// here removes and then writes, which would open a window with no snapshot in
// it at all.

import { idbStore } from '@/lib/idb'
import type { KeyValueStore } from '@/lib/idb'
import type { RecoveryStore, SnapshotAbout, SnapshotInfo } from '@/core/storage/provider'

// What sits under a key: the payload, plus what the offer needs to describe
// it without parsing it.
interface SnapshotRecord extends SnapshotAbout {
  savedAt: number
  data: unknown
}

// Old enough that it belongs to a different piece of work, and offering it
// back would be noise rather than rescue.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

// Deliberately small. Listing reads every record, and a record holds a whole
// project, so the ceiling is what keeps a startup scan bounded. Keys are
// forgotten on a project swap and cleared on a save, so reaching even this
// many means several crashes with nothing saved in between.
const MAX_SNAPSHOTS = 5

function isSnapshotRecord(value: unknown): value is SnapshotRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<SnapshotRecord>
  return (
    typeof record.savedAt === 'number' &&
    Number.isFinite(record.savedAt) &&
    typeof record.projectName === 'string' &&
    (record.fileName === null || typeof record.fileName === 'string') &&
    'data' in record
  )
}

// `store` is where the records go. It is a parameter so the snapshot rules
// above can be checked against a store that records what was asked of it,
// which is the only way to see that a write is one operation and not two.
export function createRecoveryStore(store: KeyValueStore = idbStore('recovery')): RecoveryStore {
  return {
    async put(key, data, about) {
      const record: SnapshotRecord = {
        savedAt: Date.now(),
        projectName: about.projectName,
        fileName: about.fileName,
        data,
      }
      await store.put(key, record)
    },

    async get(key) {
      const record = await store.get<unknown>(key)
      return isSnapshotRecord(record) ? record.data : null
    },

    async remove(key) {
      await store.remove(key)
    },

    // Also where pruning happens. Every record is in hand exactly here, and
    // reading them a second time to keep this function free of side effects
    // would cost more than the side effect does.
    async list() {
      const entries = await store.entries<unknown>()
      const now = Date.now()
      const kept: SnapshotInfo[] = []
      const doomed: string[] = []

      for (const { key, value } of entries) {
        // A record this build cannot read can never be recovered, so it is
        // dropped rather than carried forward and offered forever.
        if (!isSnapshotRecord(value) || now - value.savedAt > MAX_AGE_MS) {
          doomed.push(key)
          continue
        }
        kept.push({
          key,
          savedAt: value.savedAt,
          projectName: value.projectName,
          fileName: value.fileName,
        })
      }

      kept.sort((a, b) => b.savedAt - a.savedAt)
      // Newest first, so the count ceiling cuts the oldest.
      for (const extra of kept.splice(MAX_SNAPSHOTS)) doomed.push(extra.key)
      for (const key of doomed) await store.remove(key)

      return kept
    },
  }
}

let active: RecoveryStore | null = null

// Fetched per call rather than held, for the same reason the storage provider
// is: a store captured at setup outlives any later change to it.
export function getRecoveryStore(): RecoveryStore {
  if (!active) active = createRecoveryStore()
  return active
}

// Replaces the store, for tests. Passing null restores the real one.
export function setRecoveryStore(store: RecoveryStore | null): void {
  active = store
}
