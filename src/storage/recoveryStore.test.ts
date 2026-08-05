import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, idbStore } from '@/lib/idb'
import type { KeyValueStore } from '@/lib/idb'
import { createRecoveryStore, getRecoveryStore, setRecoveryStore } from './recoveryStore'

const raw = idbStore('recovery')
const store = createRecoveryStore()

const about = { projectName: 'Sunken City', fileName: 'sunken-city.mvm' }

beforeEach(async () => {
  await raw.clear()
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
  setRecoveryStore(null)
  closeDatabase()
})

const DAY_MS = 24 * 60 * 60 * 1000

// Writes a record directly, so a test can dictate its age and its shape
// without waiting or reaching through `put`.
async function seed(key: string, record: unknown) {
  await raw.put(key, record)
}

// An in-memory store that writes down what it was asked to do, in order.
function recorder(asked: string[]): KeyValueStore {
  const values = new Map<string, unknown>()
  return {
    async put(key, value) {
      asked.push('put')
      values.set(key, value)
    },
    async get<T>(key: string) {
      asked.push('get')
      return (values.get(key) as T) ?? null
    },
    async remove(key) {
      asked.push('remove')
      values.delete(key)
    },
    async keys() {
      asked.push('keys')
      return [...values.keys()]
    },
    async entries<T>() {
      asked.push('entries')
      return [...values].map(([key, value]) => ({ key, value: value as T }))
    },
    async clear() {
      asked.push('clear')
      values.clear()
    },
  }
}

function recordAged(days: number, over: Record<string, unknown> = {}) {
  return {
    savedAt: Date.now() - days * DAY_MS,
    projectName: 'Old',
    fileName: null,
    data: { format: 'metroidvania-map-maker' },
    ...over,
  }
}

describe('a recovery snapshot', () => {
  it('gives back exactly the payload it was given', async () => {
    const data = { format: 'metroidvania-map-maker', version: 2, project: { name: 'Sunken City' } }
    await store.put('proj_a', data, about)
    expect(await store.get('proj_a')).toEqual(data)
  })

  it('is nothing for a project that has none', async () => {
    expect(await store.get('proj_missing')).toBeNull()
  })

  // The offer has to name what it is offering. Reading that out of the payload
  // would mean parsing every snapshot to find out what is there.
  it('carries what the offer needs beside the payload', async () => {
    await store.put('proj_a', { any: 'thing' }, about)
    expect(await store.list()).toEqual([{ key: 'proj_a', savedAt: expect.any(Number), ...about }])
  })

  it('records a project that was never in a file as having none', async () => {
    await store.put('proj_a', {}, { projectName: 'Untitled Project', fileName: null })
    expect((await store.list())[0].fileName).toBeNull()
  })

  it('is replaced rather than added to, so one project holds one snapshot', async () => {
    await store.put('proj_a', { n: 1 }, about)
    await store.put('proj_a', { n: 2 }, about)
    expect(await store.get('proj_a')).toEqual({ n: 2 })
    expect(await store.list()).toHaveLength(1)
  })

  // A crash mid-write must leave the previous snapshot whole, which is only
  // true while a write is one transaction. A remove-then-put would have a
  // window in it where there is nothing to recover.
  it('is written in one operation, never cleared first', async () => {
    const asked: string[] = []
    const recording = createRecoveryStore(recorder(asked))
    await recording.put('proj_a', { n: 1 }, about)
    await recording.put('proj_a', { n: 2 }, about)
    expect(asked).toEqual(['put', 'put'])
  })

  it('is forgotten on request', async () => {
    await store.put('proj_a', { n: 1 }, about)
    await store.remove('proj_a')
    expect(await store.get('proj_a')).toBeNull()
    expect(await store.list()).toEqual([])
  })

  it('keeps one project clear of another', async () => {
    await store.put('proj_a', { n: 1 }, { projectName: 'A', fileName: null })
    await store.put('proj_b', { n: 2 }, { projectName: 'B', fileName: null })
    await store.remove('proj_a')
    expect(await store.get('proj_b')).toEqual({ n: 2 })
  })
})

describe('listing snapshots', () => {
  it('answers newest first', async () => {
    await seed('old', recordAged(3, { projectName: 'Old' }))
    await seed('new', recordAged(0, { projectName: 'New' }))
    await seed('middle', recordAged(1, { projectName: 'Middle' }))
    expect((await store.list()).map((info) => info.projectName)).toEqual(['New', 'Middle', 'Old'])
  })

  it('is empty when nothing is stored', async () => {
    expect(await store.list()).toEqual([])
  })

  // Anything this build cannot read can never be recovered, so leaving it
  // would mean offering an unusable row for ever.
  it.each([
    ['not an object', 42],
    ['null', null],
    ['no timestamp', { projectName: 'A', fileName: null, data: {} }],
    ['a timestamp that is not a number', recordAged(0, { savedAt: 'yesterday' })],
    ['a timestamp that is not finite', recordAged(0, { savedAt: Number.NaN })],
    ['no name', { savedAt: Date.now(), fileName: null, data: {} }],
    ['a file name that is neither a string nor absent', recordAged(0, { fileName: 7 })],
    ['no payload', { savedAt: Date.now(), projectName: 'A', fileName: null }],
  ])('drops a record with %s', async (_label, record) => {
    await seed('bad', record)
    expect(await store.list()).toEqual([])
    expect(await raw.keys()).toEqual([])
  })

  it('gives nothing back for a record it dropped', async () => {
    await seed('bad', { savedAt: Date.now() })
    expect(await store.get('bad')).toBeNull()
  })

  it('drops snapshots old enough to belong to different work', async () => {
    await seed('ancient', recordAged(15, { projectName: 'Ancient' }))
    await seed('recent', recordAged(13, { projectName: 'Recent' }))
    expect((await store.list()).map((info) => info.projectName)).toEqual(['Recent'])
    expect(await raw.keys()).toEqual(['recent'])
  })

  // The ceiling is what keeps a startup scan bounded, since listing reads
  // every record and a record holds a whole project.
  it('keeps only the newest few, oldest first out', async () => {
    for (let i = 0; i < 8; i++) {
      await seed(`proj_${i}`, recordAged(i, { projectName: `P${i}` }))
    }
    const listed = await store.list()
    expect(listed.map((info) => info.projectName)).toEqual(['P0', 'P1', 'P2', 'P3', 'P4'])
    expect((await raw.keys()).sort()).toEqual(['proj_0', 'proj_1', 'proj_2', 'proj_3', 'proj_4'])
  })
})

// Every call into the layer below resolves rather than rejects, so a browser
// with IndexedDB blocked costs autosave and nothing else.
describe('with storage unavailable', () => {
  beforeEach(() => {
    closeDatabase()
    vi.stubGlobal('indexedDB', undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    closeDatabase()
  })

  it('writes, reads, lists and removes without throwing', async () => {
    const blind = createRecoveryStore()
    await expect(blind.put('proj_a', { n: 1 }, about)).resolves.toBeUndefined()
    expect(await blind.get('proj_a')).toBeNull()
    expect(await blind.list()).toEqual([])
    await expect(blind.remove('proj_a')).resolves.toBeUndefined()
  })
})

describe('the shared store', () => {
  it('is the same one on every call, so a snapshot is not written twice over', () => {
    expect(getRecoveryStore()).toBe(getRecoveryStore())
  })

  it('can be replaced, and put back', () => {
    const stub = createRecoveryStore()
    setRecoveryStore(stub)
    expect(getRecoveryStore()).toBe(stub)
    setRecoveryStore(null)
    expect(getRecoveryStore()).not.toBe(stub)
  })
})
