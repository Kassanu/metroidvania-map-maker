// A promise-wrapped key-value store over IndexedDB.
//
// Distinct from userPrefs, which is localStorage and holds plain settings.
// This holds the two things localStorage cannot: a `FileSystemFileHandle` is
// structured-cloneable but not JSON-serializable, and a recovery snapshot is
// larger than localStorage's budget and must not block the main thread.
//
// Nothing here rejects. A browser with IndexedDB unavailable (private mode, a
// blocked origin, a failed upgrade, a version conflict with another tab) gets
// an app with no recent files and no recovery, which is these features
// degrading rather than the app failing. userPrefs swallows a dead
// localStorage for the same reason.

const DB_NAME = 'mmm'
const DB_VERSION = 1

// Declared up front because IndexedDB can only create object stores during a
// version upgrade. Adding one means a name here and a bumped DB_VERSION.
export const STORE_NAMES = ['recovery', 'handles'] as const
export type StoreName = (typeof STORE_NAMES)[number]

export interface KeyValueStore {
  put(key: string, value: unknown): Promise<void>
  // Null for both "no such key" and "storage unavailable". Every caller wants
  // the same thing of the two, and distinguishing them would only invite a
  // branch that cannot be tested in a browser that works.
  get<T>(key: string): Promise<T | null>
  remove(key: string): Promise<void>
  keys(): Promise<string[]>
  entries<T>(): Promise<{ key: string; value: T }[]>
  clear(): Promise<void>
}

let connection: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (connection) return connection
  connection = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)

    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      // Firefox throws here outright in private browsing rather than firing
      // an error event.
      return resolve(null)
    }

    request.onupgradeneeded = () => {
      const database = request.result
      for (const name of STORE_NAMES) {
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    // Another tab holds an older version open. Waiting would hang the caller,
    // so this session goes without.
    request.onblocked = () => resolve(null)
  })
  return connection
}

// Resolves on the transaction completing rather than on the request
// succeeding. A request fires `onsuccess` while its transaction can still
// abort, so awaiting the request would report a write as durable before it is.
function run<T>(
  name: StoreName,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  return open().then((database) => {
    if (!database) return null
    return new Promise<T | null>((resolve) => {
      try {
        const transaction = database.transaction(name, mode)
        const request = body(transaction.objectStore(name))
        transaction.oncomplete = () => resolve(request.result as T)
        transaction.onabort = () => resolve(null)
        transaction.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  })
}

// Keys and values together, read in one transaction so they cannot be paired
// up wrongly by a write landing between two reads.
function readEntries<T>(name: StoreName): Promise<{ key: string; value: T }[]> {
  return open().then((database) => {
    if (!database) return []
    return new Promise<{ key: string; value: T }[]>((resolve) => {
      try {
        const transaction = database.transaction(name, 'readonly')
        const store = transaction.objectStore(name)
        const keys = store.getAllKeys()
        const values = store.getAll()
        transaction.oncomplete = () =>
          resolve(
            (keys.result as string[]).map((key, index) => ({
              key,
              value: (values.result as T[])[index],
            })),
          )
        transaction.onabort = () => resolve([])
        transaction.onerror = () => resolve([])
      } catch {
        resolve([])
      }
    })
  })
}

export function idbStore(name: StoreName): KeyValueStore {
  return {
    async put(key, value) {
      await run(name, 'readwrite', (store) => store.put(value, key))
    },
    async get<T>(key: string) {
      return (await run<T>(name, 'readonly', (store) => store.get(key))) ?? null
    },
    async remove(key) {
      await run(name, 'readwrite', (store) => store.delete(key))
    },
    async keys() {
      return (await run<string[]>(name, 'readonly', (store) => store.getAllKeys())) ?? []
    },
    entries<T>() {
      return readEntries<T>(name)
    },
    async clear() {
      await run(name, 'readwrite', (store) => store.clear())
    },
  }
}

// Asks the browser not to evict this origin's storage when the disk fills.
//
// Deliberately not called at startup: Firefox shows a permission prompt, and a
// prompt before the user has drawn anything is one they will refuse. The
// caller is whatever first has something worth keeping.
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

// Drops the cached connection, so the next call opens afresh. Tests use it to
// swap the environment out from under the module; nothing in the app needs it
// while there is one database and one profile.
export function closeDatabase(): void {
  const pending = connection
  connection = null
  void pending?.then((database) => database?.close())
}
