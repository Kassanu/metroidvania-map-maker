import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, idbStore, requestPersistentStorage } from './idb'

const recovery = idbStore('recovery')
const handles = idbStore('handles')

beforeEach(async () => {
  await recovery.clear()
  await handles.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  closeDatabase()
})

describe('the key-value store', () => {
  it('round-trips a value', async () => {
    await recovery.put('a', { savedAt: 7, project: { name: 'P' } })
    expect(await recovery.get('a')).toEqual({ savedAt: 7, project: { name: 'P' } })
  })

  it('answers null for a key it does not have', async () => {
    expect(await recovery.get('missing')).toBeNull()
  })

  it('overwrites rather than appending', async () => {
    await recovery.put('a', 1)
    await recovery.put('a', 2)
    expect(await recovery.get('a')).toBe(2)
    expect(await recovery.keys()).toEqual(['a'])
  })

  it('removes', async () => {
    await recovery.put('a', 1)
    await recovery.remove('a')
    expect(await recovery.get('a')).toBeNull()
    expect(await recovery.keys()).toEqual([])
  })

  it('lists keys and entries together', async () => {
    await recovery.put('b', { n: 2 })
    await recovery.put('a', { n: 1 })
    expect((await recovery.keys()).sort()).toEqual(['a', 'b'])
    expect(await recovery.entries()).toEqual([
      { key: 'a', value: { n: 1 } },
      { key: 'b', value: { n: 2 } },
    ])
  })

  it('clears', async () => {
    await recovery.put('a', 1)
    await recovery.clear()
    expect(await recovery.keys()).toEqual([])
  })

  it('keeps its stores apart', async () => {
    await recovery.put('same', 'from recovery')
    await handles.put('same', 'from handles')
    expect(await recovery.get('same')).toBe('from recovery')
    expect(await handles.get('same')).toBe('from handles')
  })

  // The reason this layer exists rather than a second localStorage wrapper.
  it('stores a value JSON could not carry', async () => {
    const stored = {
      name: 'project.mvm',
      when: new Date(0),
      nested: new Map([['k', 1]]),
      bytes: new Uint8Array([1, 2, 3]),
    }
    await handles.put('h1', stored)

    const back = await handles.get<typeof stored>('h1')
    expect(back?.when).toBeInstanceOf(Date)
    expect(back?.nested.get('k')).toBe(1)
    // By contents: the double returns typed arrays from its own realm, so an
    // instance comparison fails on two values that are byte-for-byte equal.
    expect(Array.from(back!.bytes)).toEqual([1, 2, 3])
    // The same value through localStorage's only channel loses all of it: the
    // Date becomes a string and the Map becomes `{}`.
    const throughJson = JSON.parse(JSON.stringify(stored))
    expect(typeof throughJson.when).toBe('string')
    expect(throughJson.nested).toEqual({})
  })

  // The test double is not the browser, and the difference matters for exactly
  // the value this store exists to hold. `fake-indexeddb` carries Date, Map,
  // Set, RegExp and typed arrays faithfully, and flattens host objects like
  // Blob and File into plain objects. A `FileSystemFileHandle` is a host
  // object, so **no jsdom test can show that a handle survives storage**;
  // `e2e/idb.spec.ts` is what covers that, in a browser that has both.
  it('cannot speak for host objects, which is what the browser test is for', () => {
    expect(structuredClone(new Blob(['x'])).constructor.name).not.toBe('Blob')
  })

  it('refuses a value that cannot be cloned, without taking the store down', async () => {
    await recovery.put('fn', { callback: () => 'no' })
    expect(await recovery.get('fn')).toBeNull()

    // The store still works afterwards, which is the part that matters.
    await recovery.put('ok', 1)
    expect(await recovery.get('ok')).toBe(1)
  })
})

// A browser that cannot give us IndexedDB must cost the user the feature, not
// the app. Every method resolves with an empty answer rather than rejecting.
describe('when IndexedDB is unavailable', () => {
  async function expectSilentlyEmpty() {
    const store = idbStore('recovery')
    await expect(store.put('a', 1)).resolves.toBeUndefined()
    await expect(store.get('a')).resolves.toBeNull()
    await expect(store.remove('a')).resolves.toBeUndefined()
    await expect(store.keys()).resolves.toEqual([])
    await expect(store.entries()).resolves.toEqual([])
    await expect(store.clear()).resolves.toBeUndefined()
  }

  it('degrades when the API is absent', async () => {
    closeDatabase()
    vi.stubGlobal('indexedDB', undefined)
    await expectSilentlyEmpty()
  })

  it('degrades when open() throws, as it does in private browsing', async () => {
    closeDatabase()
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new DOMException('denied', 'SecurityError')
      },
    })
    await expectSilentlyEmpty()
  })

  it('degrades when open() fires an error', async () => {
    closeDatabase()
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request = { onerror: null } as unknown as IDBOpenDBRequest & {
          onerror: (() => void) | null
        }
        queueMicrotask(() => request.onerror?.())
        return request
      },
    })
    await expectSilentlyEmpty()
  })

  it('degrades when another tab blocks the upgrade', async () => {
    closeDatabase()
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request = { onblocked: null } as unknown as IDBOpenDBRequest & {
          onblocked: (() => void) | null
        }
        queueMicrotask(() => request.onblocked?.())
        return request
      },
    })
    await expectSilentlyEmpty()
  })

  // A request fires `onsuccess` while its transaction can still roll back, so
  // a wrapper that resolves on the request reports a write as durable that
  // never landed. Driven through a stub because a real abort after a
  // successful request is not something the store's own API can provoke.
  it('waits for the transaction, not the request inside it', async () => {
    closeDatabase()

    const request = { result: 'the request succeeded', onsuccess: null as (() => void) | null }
    const transaction = {
      objectStore: () => ({ get: () => request, put: () => request }),
      oncomplete: null as (() => void) | null,
      onabort: null as (() => void) | null,
      onerror: null as (() => void) | null,
    }
    const database = {
      transaction: () => {
        queueMicrotask(() => {
          request.onsuccess?.()
          // ...and then the transaction throws the whole thing away.
          transaction.onabort?.()
        })
        return transaction
      },
      close: () => {},
    }
    vi.stubGlobal('indexedDB', {
      open: () => {
        const openRequest = { result: database, onsuccess: null as (() => void) | null }
        queueMicrotask(() => openRequest.onsuccess?.())
        return openRequest
      },
    })

    expect(await idbStore('recovery').get('k')).toBeNull()
  })

  it('opens once and reuses the connection', async () => {
    closeDatabase()
    const open = vi.fn(indexedDB.open.bind(indexedDB))
    vi.stubGlobal('indexedDB', { ...indexedDB, open })

    const store = idbStore('recovery')
    await store.put('a', 1)
    await store.get('a')
    await store.keys()
    expect(open).toHaveBeenCalledTimes(1)
  })
})

describe('persistent storage', () => {
  it('is not requested again once already granted', async () => {
    const persist = vi.fn()
    vi.stubGlobal('navigator', {
      storage: { persist, persisted: () => Promise.resolve(true) },
    })
    expect(await requestPersistentStorage()).toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('asks when it has not been granted', async () => {
    const persist = vi.fn(() => Promise.resolve(true))
    vi.stubGlobal('navigator', {
      storage: { persist, persisted: () => Promise.resolve(false) },
    })
    expect(await requestPersistentStorage()).toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('answers false where the API is missing or refuses', async () => {
    vi.stubGlobal('navigator', {})
    expect(await requestPersistentStorage()).toBe(false)

    vi.stubGlobal('navigator', {
      storage: {
        persisted: () => Promise.reject(new Error('nope')),
        persist: () => Promise.resolve(true),
      },
    })
    expect(await requestPersistentStorage()).toBe(false)
  })
})
