// Pinia plugin that syncs a store's durable slice to localStorage.
//
// A store opts in by declaring a `persist` option (one entry, or several
// when it owns more than one preference key):
//
//   persist: { key: 'canvasView' }
//   persist: [{ key: 'sidebarLayout', paths: ['leftSidebarWidth', ...] }, ...]
//
// `paths` limits the write to a subset of state, which is what lets a store
// keep session-only fields (zenMode, modal flags) next to durable ones
// without being split in two. Writes are debounced, so a resize drag's
// stream of intermediate mutations coalesces into a single write once the
// user stops. No "persist once on release" call needed for the caller.
import type { PiniaPlugin, StateTree } from 'pinia'
import { loadPref, savePref } from '@/lib/userPrefs'
import { PREFS_VERSION } from '@/config/preferences'

export interface PersistEntry<S extends StateTree = StateTree> {
  // userPrefs key (namespaced to `mmm:` by the storage layer).
  key: string
  // State fields to persist. Omitted = the whole state tree.
  paths?: (keyof S & string)[]
  // Escape hatch for state that can't just be assigned back. For merging saved
  // entries onto a registry's defaults, or deriving a session field from a
  // pref that was just loaded. Mutate `state` in place.
  hydrate?: (saved: Partial<S>, state: S) => void
}

declare module 'pinia' {
  // `Store` must keep this exact name to merge with Pinia's own declaration;
  // renaming it (even to `_Store`) breaks the augmentation and type-check fails.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export interface DefineStoreOptionsBase<S extends StateTree, Store> {
    persist?: PersistEntry<S> | PersistEntry<S>[]
  }
  export interface PiniaCustomProperties {
    // Writes any pending debounced preference immediately. Mostly for tests
    // and for a future "save before unload" hook; normal code just mutates
    // state and lets the debounce fire.
    $flushPersist: () => void
  }
}

// Stored values are wrapped so the version travels with the data, giving
// load-time migration one central place to hook in.
interface Envelope {
  v: number
  data: StateTree
}

const DEBOUNCE_MS = 150

function read(key: string): StateTree | null {
  const raw = loadPref<Envelope | null>(key, null)
  if (!raw || typeof raw !== 'object' || typeof raw.v !== 'number' || !raw.data) return null
  // Unknown version: fall back to defaults rather than guess at the shape.
  // Migrations belong here, keyed off raw.v, once PREFS_VERSION moves past 1.
  if (raw.v !== PREFS_VERSION) return null
  return raw.data
}

// Only fields the store actually declares survive the round trip, so a
// renamed or removed field in storage can't leak stale keys into state, and
// a field absent from storage keeps its default.
function pick(source: StateTree, keys: string[]): StateTree {
  const out: StateTree = {}
  for (const key of keys) {
    if (key in source) out[key] = source[key]
  }
  return out
}

export function createPersistPrefsPlugin(): PiniaPlugin {
  // Per-plugin-instance, not module-level: a fresh pinia (every test, and
  // any future multi-app mount) starts with a clean slate.
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const lastWritten = new Map<string, string>()

  return ({ store, options }) => {
    const option = options.persist
    const entries = option ? (Array.isArray(option) ? option : [option]) : []

    function keysFor(entry: PersistEntry): string[] {
      return entry.paths ?? Object.keys(store.$state)
    }

    function write(entry: PersistEntry) {
      const data = pick(store.$state, keysFor(entry))
      const json = JSON.stringify(data)
      // Skip no-op writes so a mutation to a session-only field (zenMode, a
      // modal flag) doesn't rewrite or spuriously create a pref entry.
      if (lastWritten.get(entry.key) === json) return
      lastWritten.set(entry.key, json)
      savePref<Envelope>(entry.key, { v: PREFS_VERSION, data })
    }

    for (const entry of entries) {
      const saved = read(entry.key)
      if (saved) {
        if (entry.hydrate) entry.hydrate(saved as Partial<StateTree>, store.$state)
        else store.$patch(pick(saved, keysFor(entry)))
      }
      // Baseline for the no-op check above: whatever we'd write right now
      // (defaults, or what we just loaded) counts as already stored.
      lastWritten.set(entry.key, JSON.stringify(pick(store.$state, keysFor(entry))))
    }

    function flush() {
      for (const entry of entries) {
        const timer = timers.get(entry.key)
        if (timer !== undefined) {
          clearTimeout(timer)
          timers.delete(entry.key)
        }
        write(entry)
      }
    }

    if (entries.length > 0) {
      // detached: the subscription belongs to the store, not to whichever
      // component happened to instantiate it first.
      store.$subscribe(
        () => {
          for (const entry of entries) {
            const existing = timers.get(entry.key)
            if (existing !== undefined) clearTimeout(existing)
            timers.set(
              entry.key,
              setTimeout(() => {
                timers.delete(entry.key)
                write(entry)
              }, DEBOUNCE_MS),
            )
          }
        },
        { detached: true },
      )
    }

    return { $flushPersist: flush }
  }
}
