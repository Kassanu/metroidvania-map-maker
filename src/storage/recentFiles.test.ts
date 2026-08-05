import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, idbStore } from '@/lib/idb'
import type { KeyValueStore } from '@/lib/idb'
import type { StorageHandle } from '@/core/storage/provider'
import { createRecentFiles } from './recentFiles'

const raw = idbStore('handles')

// Two handles name the same file when they carry the same marker, standing in
// for `FileSystemFileHandle.isSameEntry`. Names are deliberately not it: the
// point of the real call is that two `world.mvm` files in two folders are
// different projects.
interface Marked extends StorageHandle {
  at: string
}

async function sameFile(a: StorageHandle, b: StorageHandle) {
  return (a as Marked).at === (b as Marked).at
}

function handle(name: string, at = name): Marked {
  return { providerId: 'fsa', name, at }
}

const recent = createRecentFiles(sameFile)

beforeEach(async () => {
  await raw.clear()
})

afterEach(() => {
  closeDatabase()
})

async function names() {
  return (await recent.list()).map((entry) => entry.name)
}

describe('the recent list', () => {
  it('is empty before anything has been opened', async () => {
    expect(await recent.list()).toEqual([])
  })

  it('records what it was given, with the handle intact', async () => {
    await recent.remember(handle('world.mvm'))
    expect(await recent.list()).toEqual([
      { handle: handle('world.mvm'), name: 'world.mvm', lastOpenedAt: expect.any(Number) },
    ])
  })

  it('is most-recently-used, newest first', async () => {
    await recent.remember(handle('first.mvm'))
    await recent.remember(handle('second.mvm'))
    expect(await names()).toEqual(['second.mvm', 'first.mvm'])
  })

  // Reopening an old file moves it up rather than adding a second row for it.
  it('moves a file already in the list to the front', async () => {
    await recent.remember(handle('a.mvm'))
    await recent.remember(handle('b.mvm'))
    await recent.remember(handle('a.mvm'))
    expect(await names()).toEqual(['a.mvm', 'b.mvm'])
  })

  // Same name, different folder. Merging them would make one entry open the
  // other's file, which is the worst thing a recent list can do.
  it('keeps two files with the same name apart', async () => {
    await recent.remember(handle('world.mvm', '/maps/world.mvm'))
    await recent.remember(handle('world.mvm', '/backup/world.mvm'))
    const listed = await recent.list()
    expect(listed).toHaveLength(2)
    expect((listed[0].handle as Marked).at).toBe('/backup/world.mvm')
  })

  it('drops the oldest once it is full', async () => {
    for (let i = 0; i < 13; i++) await recent.remember(handle(`p${i}.mvm`))
    const listed = await names()
    expect(listed).toHaveLength(10)
    expect(listed[0]).toBe('p12.mvm')
    expect(listed).not.toContain('p2.mvm')
  })

  // Reading caps too, which would hide an uncapped write behind a menu that
  // looks right while storage grows without limit.
  it('stores no more than it lists', async () => {
    for (let i = 0; i < 13; i++) await recent.remember(handle(`p${i}.mvm`))
    expect(await raw.get<unknown[]>('recent')).toHaveLength(10)
  })

  it('forgets an entry on request, leaving the rest in order', async () => {
    await recent.remember(handle('a.mvm'))
    await recent.remember(handle('b.mvm'))
    await recent.remember(handle('c.mvm'))

    await recent.forget(handle('b.mvm'))
    expect(await names()).toEqual(['c.mvm', 'a.mvm'])
  })

  it('says nothing about forgetting something it never had', async () => {
    await recent.remember(handle('a.mvm'))
    await expect(recent.forget(handle('z.mvm'))).resolves.toBeUndefined()
    expect(await names()).toEqual(['a.mvm'])
  })

  // The list is one value under one key, so every change is one transaction
  // and a reorder cannot half-apply.
  it('is stored whole, under a single key', async () => {
    await recent.remember(handle('a.mvm'))
    await recent.remember(handle('b.mvm'))
    expect(await raw.keys()).toEqual(['recent'])
  })
})

describe('a recent list that has been damaged', () => {
  it('reads as empty when the stored value is not a list', async () => {
    await raw.put('recent', { nope: true })
    expect(await recent.list()).toEqual([])
  })

  // One unreadable row must not cost the rest of the list.
  it.each([
    ['not an object', 42],
    ['null', null],
    ['no handle', { name: 'a.mvm', lastOpenedAt: 1 }],
    ['no name', { handle: handle('a.mvm'), lastOpenedAt: 1 }],
    ['no timestamp', { handle: handle('a.mvm'), name: 'a.mvm' }],
    [
      'a timestamp that is not a number',
      { handle: handle('a.mvm'), name: 'a.mvm', lastOpenedAt: 'x' },
    ],
  ])('drops a row that is %s and keeps the others', async (_label, row) => {
    await raw.put('recent', [
      row,
      { handle: handle('good.mvm'), name: 'good.mvm', lastOpenedAt: 5 },
    ])
    expect(await names()).toEqual(['good.mvm'])
  })

  // A handle that will not structured-clone cannot be stored, and the write
  // that tries takes the whole list with it if it is not one transaction.
  // What must survive is the list that was already there.
  it('keeps the list it had when a handle will not store', async () => {
    await recent.remember(handle('good.mvm'))
    const uncloneable = { ...handle('bad.mvm'), open: () => {} } as StorageHandle

    await expect(recent.remember(uncloneable)).resolves.toBeUndefined()
    expect(await names()).toEqual(['good.mvm'])
  })

  it('trims a list that grew past the cap in storage', async () => {
    const rows = Array.from({ length: 25 }, (_unused, i) => ({
      handle: handle(`p${i}.mvm`),
      name: `p${i}.mvm`,
      lastOpenedAt: i,
    }))
    await raw.put('recent', rows)
    expect(await recent.list()).toHaveLength(10)
  })
})

// Every call resolves, so a browser with IndexedDB blocked gets no recent
// menu rather than no app.
describe('with storage unavailable', () => {
  function deadStore(): KeyValueStore {
    return {
      async put() {},
      async get<T>() {
        return null as T | null
      },
      async remove() {},
      async keys() {
        return []
      },
      async entries<T>() {
        return [] as { key: string; value: T }[]
      },
      async clear() {},
    }
  }

  it('lists nothing, and remembering it is not an error', async () => {
    const blind = createRecentFiles(sameFile, deadStore())
    await expect(blind.remember(handle('a.mvm'))).resolves.toBeUndefined()
    await expect(blind.forget(handle('a.mvm'))).resolves.toBeUndefined()
    expect(await blind.list()).toEqual([])
  })
})
