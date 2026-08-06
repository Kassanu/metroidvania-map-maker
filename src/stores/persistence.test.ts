import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { createTestPinia } from '@/test-setup'
import { closeDatabase, idbStore } from '@/lib/idb'
import { setRecoveryStore, setStorageProvider } from '@/storage'
import type { StorageEntry, StorageHandle, StorageProvider } from '@/storage'
import { checkInvariants } from '@/core/testUtils'
import { renameProject } from '@/core/ops/project'
import { paintCells } from '@/core/ops/rooms'
import { WORLD_AREA_ID } from '@/core/ids'
import { PROJECT_SCOPE, mapScope, useModelStore } from './model'
import { useFileStore } from './file'
import { useRecoveryStore } from './recovery'

// The seams between the pass's parts, which no chunk owned on its own.
//
// Everything here runs against the real serializer and the real IndexedDB
// stores; only the storage provider is a double, because a real one needs an
// operating system picker. So a "crash and reload" is a fresh pinia over
// storage that survived, which is what the app actually does.

const recoveryTable = idbStore('recovery')
const handlesTable = idbStore('handles')

function provider(over: Partial<StorageProvider> = {}): StorageProvider {
  const entries: StorageEntry[] = []
  return {
    id: 'fake',
    label: 'Fake',
    canSaveInPlace: true,
    list: async () => [...entries],
    remember: async (handle) => {
      const at = entries.findIndex((entry) => entry.handle.name === handle.name)
      if (at >= 0) entries.splice(at, 1)
      entries.unshift({ handle, name: handle.name, lastOpenedAt: Date.now() })
    },
    forget: async (handle) => {
      const at = entries.findIndex((entry) => entry.handle.name === handle.name)
      if (at >= 0) entries.splice(at, 1)
    },
    adoptFileHandle: () => null,
    open: async () => null,
    save: async (handle) => handle,
    saveAs: async () => ({ providerId: 'fake', name: 'world.mvm' }),
    ...over,
  }
}

function handle(name = 'world.mvm'): StorageHandle {
  return { providerId: 'fake', name }
}

// A real edit, not a rename: cells are what the serializer and the loader do
// the most work on, and what a snapshot has to carry back intact.
function drawSomething(name: string): void {
  const model = useModelStore()
  model.run('rename', PROJECT_SCOPE, (tx) => renameProject(tx, model.project, name))
  const map = model.project.mapsById.get(model.project.maps[0])!
  model.run('paint', mapScope(map.id), (tx) =>
    paintCells(tx, model.project, map, ['0,0', '1,0', '1,1', '2,1'], { areaId: WORLD_AREA_ID }),
  )
}

function roomCount(): number {
  const model = useModelStore()
  const map = model.project.mapsById.get(model.project.maps[0])!
  return map.rooms.size
}

function cellCount(): number {
  const model = useModelStore()
  const map = model.project.mapsById.get(model.project.maps[0])!
  return [...map.rooms.values()].reduce((total, room) => total + room.cells.size, 0)
}

// A fresh session over storage that outlived the last one.
function reload(): void {
  useRecoveryStore().$dispose()
  setActivePinia(createTestPinia())
}

// Only `setTimeout`, which is the autosave debounce. IndexedDB schedules its
// own work with `setImmediate`, and freezing that stops the database dead: the
// first version of this file faked everything and all nine tests timed out.
const FAKE_TIMERS: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: ['setTimeout', 'clearTimeout'],
}

async function settle(ms = 3_000) {
  await vi.advanceTimersByTimeAsync(ms)
  await nextTick()
}

beforeEach(async () => {
  vi.useRealTimers()
  await recoveryTable.clear()
  await handlesTable.clear()
  vi.useFakeTimers(FAKE_TIMERS)
  setActivePinia(createTestPinia())
  // The real store over the real (test) database, so what is asserted is what
  // would actually be on disk.
  setRecoveryStore(null)
  setStorageProvider(provider())
})

afterEach(() => {
  useRecoveryStore().$dispose()
  vi.useRealTimers()
  setRecoveryStore(null)
  setStorageProvider(null)
  closeDatabase()
})

// The promise the whole pass exists to keep, exercised end to end rather than
// a piece at a time.
describe('work that was never saved, across a crash', () => {
  it('comes back through the real serializer with its rooms intact', async () => {
    useRecoveryStore()
    drawSomething('Sunken City')
    const rooms = roomCount()
    const cells = cellCount()
    await settle()

    reload()
    const recovery = useRecoveryStore()
    const model = useModelStore()
    await recovery.scan()

    expect(recovery.offered.map((info) => info.projectName)).toEqual(['Sunken City'])
    await recovery.recover(recovery.offered[0].key)

    expect(model.projectName).toBe('Sunken City')
    expect(roomCount()).toBe(rooms)
    expect(cellCount()).toBe(cells)
    // A snapshot is a `.mvm` and gets every guard a file gets, so what comes
    // back has to satisfy the model's own invariants.
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('comes back as unsaved work, in no file, still being autosaved', async () => {
    useRecoveryStore()
    drawSomething('Sunken City')
    await settle()

    reload()
    const recovery = useRecoveryStore()
    const model = useModelStore()
    const file = useFileStore()
    await recovery.scan()
    const key = recovery.offered[0].key
    await recovery.recover(key)

    expect(model.status.isDirty).toBe(true)
    expect(file.fileName).toBeNull()

    // Under the same key, so a second crash leaves one snapshot rather than
    // two of the same work.
    drawSomething('Sunken City Revisited')
    await settle()
    expect(await recoveryTable.keys()).toEqual([key])
  })
})

// One action with two consequences, owned by two different chunks and never
// checked together.
describe('saving', () => {
  it('clears the snapshot and records the file in one go', async () => {
    useRecoveryStore()
    const file = useFileStore()
    drawSomething('Sunken City')
    await settle()
    expect(await recoveryTable.keys()).toHaveLength(1)

    expect(await file.saveAs()).toBe(true)
    await settle()

    expect(await recoveryTable.keys()).toEqual([])
    expect(file.recent.map((entry) => entry.name)).toEqual(['world.mvm'])
  })

  // The ordering that would resurrect a snapshot for a project that is now
  // saved: a write already in flight landing after the clear.
  it('leaves no snapshot behind when a write was already in flight', async () => {
    useRecoveryStore()
    const file = useFileStore()
    drawSomething('Sunken City')

    // The autosave comes due and the save lands in the same turn.
    await vi.advanceTimersByTimeAsync(2_100)
    await file.saveAs()
    await settle()

    expect(await recoveryTable.keys()).toEqual([])

    reload()
    const recovery = useRecoveryStore()
    await recovery.scan()
    expect(recovery.offered).toEqual([])
  })

  it('offers nothing to recover on the next launch', async () => {
    useRecoveryStore()
    const file = useFileStore()
    drawSomething('Sunken City')
    await settle()
    await file.saveAs()
    await settle()

    reload()
    const recovery = useRecoveryStore()
    await recovery.scan()
    expect(recovery.offered).toEqual([])
  })
})

describe('replacing a project', () => {
  it('takes the outgoing snapshot with it and keeps the incoming one apart', async () => {
    useRecoveryStore()
    const model = useModelStore()
    const file = useFileStore()

    drawSomething('First')
    await settle()
    const first = model.projectKey
    expect(await recoveryTable.keys()).toEqual([first])

    const replacing = file.newProject()
    file.chooseUnsaved('discard')
    await replacing
    await settle()

    drawSomething('Second')
    await settle()

    const keys = await recoveryTable.keys()
    expect(keys).toEqual([model.projectKey])
    expect(keys).not.toContain(first)
  })
})

// Autosave writes a snapshot every couple of seconds; the recent list is
// written on every open and save. Both are IndexedDB, and a busy session runs
// them against each other.
describe('the two storage channels', () => {
  it('do not disturb one another', async () => {
    useRecoveryStore()
    const file = useFileStore()

    await file.saveAs()
    drawSomething('Sunken City')
    await settle()

    expect(await recoveryTable.keys()).toHaveLength(1)
    expect(file.recent.map((entry) => entry.name)).toEqual(['world.mvm'])

    // The snapshot names the file it belongs to, which is what the offer
    // shows and the only place the two channels meet.
    const [key] = await recoveryTable.keys()
    const record = await recoveryTable.get<{ fileName: string | null }>(key)
    expect(record?.fileName).toBe('world.mvm')
  })

  it('survive a save that failed, leaving the work recoverable', async () => {
    setStorageProvider(
      provider({
        saveAs: async () => {
          throw new Error('the disk caught fire')
        },
      }),
    )
    useRecoveryStore()
    const model = useModelStore()
    const file = useFileStore()
    drawSomething('Sunken City')
    await settle()

    expect(await file.saveAs()).toBe(false)
    await settle()

    // Nothing was written, so the project is still dirty and the snapshot is
    // still the only copy of the work.
    expect(model.status.isDirty).toBe(true)
    expect(await recoveryTable.keys()).toEqual([model.projectKey])
    expect(file.recent).toEqual([])
  })
})

describe('opening a project over unsaved work', () => {
  it('records the file it opened and forgets the work it replaced', async () => {
    const opened = { data: null as unknown, handle: handle('opened.mvm') }
    useRecoveryStore()
    const model = useModelStore()
    const file = useFileStore()

    drawSomething('Doomed')
    await settle()
    const doomed = model.projectKey

    // A real file, produced by the real serializer from a real project.
    const { toJSON } = await import('@/core/serialize')
    opened.data = toJSON(model.project)
    setStorageProvider(provider({ open: async () => opened }))

    const opening = file.open()
    file.chooseUnsaved('discard')
    expect(await opening).toBe(true)
    await settle()

    expect(file.fileName).toBe('opened.mvm')
    expect(file.recent.map((entry) => entry.name)).toEqual(['opened.mvm'])
    expect(await recoveryTable.keys()).not.toContain(doomed)
    expect(model.status.isDirty).toBe(false)
    expect(checkInvariants(model.project)).toEqual([])
  })
})
