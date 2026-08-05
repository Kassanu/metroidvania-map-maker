import { test, expect } from '@playwright/test'

// What jsdom cannot answer. `fake-indexeddb` flattens host objects (Blob,
// File, and by extension FileSystemFileHandle) into plain objects, so the unit
// suite can prove the wrapper's control flow and nothing about the values it
// exists to carry. Recent files depends on a handle surviving storage, and
// this is the only place that can be shown.
//
// Runs against both engines: Firefox has IndexedDB but no File System Access,
// so the two halves of the persistence story are only both covered here.

test.describe('IndexedDB in a real browser', () => {
  test('carries a host object that JSON and the test double both lose', async ({ page }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('mmm-e2e', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('probe')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })

      const stored = { name: 'project.mvm', blob: new Blob(['{"format":"mvm"}']) }
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('probe', 'readwrite')
        transaction.objectStore('probe').put(stored, 'k')
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })

      const back = await new Promise<{ name: string; blob: Blob }>((resolve, reject) => {
        const transaction = database.transaction('probe', 'readonly')
        const request = transaction.objectStore('probe').get('k')
        transaction.oncomplete = () => resolve(request.result)
        transaction.onerror = () => reject(transaction.error)
      })

      database.close()
      indexedDB.deleteDatabase('mmm-e2e')

      return {
        isBlob: back.blob instanceof Blob,
        text: await back.blob.text(),
        name: back.name,
        // The same value through the only channel localStorage has.
        throughJson: JSON.stringify(JSON.parse(JSON.stringify(stored)).blob),
      }
    })

    expect(result.isBlob).toBe(true)
    expect(result.text).toBe('{"format":"mvm"}')
    expect(result.name).toBe('project.mvm')
    expect(result.throughJson).toBe('{}')
  })

  test('a write is durable once its transaction completes', async ({ page }) => {
    await page.goto('/')

    const written = await page.evaluate(async () => {
      const open = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('mmm-e2e-durable', 1)
          request.onupgradeneeded = () => request.result.createObjectStore('probe')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })

      const first = await open()
      await new Promise<void>((resolve) => {
        const transaction = first.transaction('probe', 'readwrite')
        transaction.objectStore('probe').put({ n: 42 }, 'k')
        transaction.oncomplete = () => resolve()
      })
      first.close()
      return true
    })
    expect(written).toBe(true)

    // A fresh page, so the value is read back through a new connection rather
    // than out of the one that wrote it.
    await page.reload()
    const readBack = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('mmm-e2e-durable', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('probe')
        request.onsuccess = () => resolve(request.result)
      })
      const value = await new Promise<{ n: number }>((resolve) => {
        const transaction = database.transaction('probe', 'readonly')
        const request = transaction.objectStore('probe').get('k')
        transaction.oncomplete = () => resolve(request.result)
      })
      database.close()
      indexedDB.deleteDatabase('mmm-e2e-durable')
      return value?.n
    })
    expect(readBack).toBe(42)
  })
})
