import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { createTestPinia } from '@/test-setup'
import { setStorageProvider, setRecoveryStore } from '@/storage'
import type { RecoveryStore, SnapshotAbout, SnapshotInfo, StorageProvider } from '@/storage'
import { toJSON } from '@/core/serialize'
import { createProject } from '@/core/factory'
import { renameProject } from '@/core/ops/project'
import { PROJECT_SCOPE, mapScope, useModelStore } from './model'
import { useFileStore } from './file'
import { useRecoveryStore } from './recovery'

interface Record {
  data: unknown
  about: SnapshotAbout
  savedAt: number
}

// An in-memory recovery store, so a test can see exactly what autosave wrote
// and how often. `writes` counts puts rather than records, which is what the
// debounce is measured in.
interface Fake extends RecoveryStore {
  records: Map<string, Record>
  writes: number
}

function makeFake(): Fake {
  const records = new Map<string, Record>()
  const fake: Fake = {
    records,
    writes: 0,
    async put(key, data, about) {
      fake.writes++
      records.set(key, { data, about, savedAt: Date.now() })
    },
    async get(key) {
      return records.get(key)?.data ?? null
    },
    async remove(key) {
      records.delete(key)
    },
    async list() {
      return [...records]
        .map(([key, record]) => ({ key, savedAt: record.savedAt, ...record.about }))
        .sort((a, b) => b.savedAt - a.savedAt)
    },
  }
  return fake
}

function provider(over: Partial<StorageProvider> = {}): StorageProvider {
  return {
    id: 'fake',
    label: 'Fake',
    canSaveInPlace: true,
    list: async () => [],
    remember: async () => {},
    forget: async () => {},
    adoptFileHandle: () => null,
    open: async () => null,
    save: async (handle) => handle,
    saveAs: async () => ({ providerId: 'fake', name: 'world.mvm' }),
    ...over,
  }
}

function makeDirty(name = 'Edited'): void {
  const model = useModelStore()
  model.run('rename', PROJECT_SCOPE, (tx) => renameProject(tx, model.project, name))
}

// Swaps in a blank project, answering the guard the way a user who does not
// want the old work would.
async function replaceProject(): Promise<void> {
  const file = useFileStore()
  const done = file.newProject()
  file.chooseUnsaved('discard')
  await done
}

function cleanFile(name = 'From a snapshot'): unknown {
  return toJSON(
    createProject({
      projectName: name,
      firstMapName: 'Map 1',
      worldAreaName: 'World',
      openLockName: 'Open',
      lockedLockName: 'Locked',
    }),
  )
}

let store: Fake

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createTestPinia())
  store = makeFake()
  setRecoveryStore(store)
  setStorageProvider(provider())
})

afterEach(() => {
  // The store holds a document listener for as long as it lives, which in the
  // app is the session. Here it has to be torn down, or a later test's hidden
  // tab reaches every earlier test's store as well.
  useRecoveryStore().$dispose()
  vi.useRealTimers()
  setRecoveryStore(null)
  setStorageProvider(null)
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

// The tab going away, as the browser reports it.
function hide() {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

// Lets the debounce elapse and every promise it started settle.
async function settle(ms = 3_000) {
  await vi.advanceTimersByTimeAsync(ms)
  await nextTick()
}

describe('autosave', () => {
  it('writes a snapshot once editing pauses', async () => {
    useRecoveryStore()
    const model = useModelStore()
    makeDirty()
    expect(store.records.size).toBe(0)

    await settle()
    expect(store.records.get(model.projectKey)?.data).toEqual(toJSON(model.project))
  })

  // Never per keystroke. A stroke and its neighbours are one write.
  it('coalesces a burst of edits into a single write', async () => {
    useRecoveryStore()
    for (let i = 0; i < 5; i++) {
      makeDirty(`Edit ${i}`)
      await vi.advanceTimersByTimeAsync(500)
    }
    await settle()
    expect(store.writes).toBe(1)
  })

  // Continuous editing never pauses, and a trailing debounce alone would mean
  // no snapshot at all for as long as the user keeps working.
  it('writes anyway once the ceiling is reached', async () => {
    useRecoveryStore()
    for (let i = 0; i < 40; i++) {
      makeDirty(`Edit ${i}`)
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(store.writes).toBeGreaterThan(0)
  })

  it('names the project and the file it came from', async () => {
    useRecoveryStore()
    const model = useModelStore()
    const file = useFileStore()
    await file.saveAs()
    makeDirty('Sunken City')

    await settle()
    expect(store.records.get(model.projectKey)?.about).toEqual({
      projectName: 'Sunken City',
      fileName: 'world.mvm',
    })
  })

  it('records a project with no file as having none', async () => {
    useRecoveryStore()
    const model = useModelStore()
    makeDirty()
    await settle()
    expect(store.records.get(model.projectKey)?.about.fileName).toBeNull()
  })

  it('writes nothing for a project that matches its file', async () => {
    useRecoveryStore()
    await settle()
    expect(store.writes).toBe(0)
  })

  // A gesture mid-drag is holding state the user has not asked for and may
  // still cancel. Snapshotting it would store something that never happened.
  it('waits for a gesture in flight rather than snapshotting the ghost', async () => {
    useRecoveryStore()
    const model = useModelStore()
    makeDirty()

    const mapId = model.project.maps[0]
    const gesture = model.beginGesture('draw', mapScope(mapId))
    await settle()
    expect(store.writes).toBe(0)

    gesture.commit()
    await settle()
    expect(store.writes).toBe(1)
  })

  // Closes the window between the last edit and the debounce, on the last
  // event a tab reliably gets.
  it('writes what is pending the moment the tab is hidden', async () => {
    useRecoveryStore()
    const model = useModelStore()
    makeDirty()

    hide()
    await nextTick()
    expect(store.records.get(model.projectKey)?.about.projectName).toBe('Edited')
  })

  it('writes nothing on being hidden with nothing to save', async () => {
    useRecoveryStore()
    hide()
    await nextTick()
    expect(store.writes).toBe(0)
  })

  it('leaves a gesture alone when the tab is hidden mid-drag', async () => {
    useRecoveryStore()
    const model = useModelStore()
    makeDirty()
    const gesture = model.beginGesture('draw', mapScope(model.project.maps[0]))

    hide()
    await nextTick()
    expect(store.writes).toBe(0)

    // Still pending rather than dropped: hiding must not lose the write it
    // declined to make.
    gesture.commit()
    await settle()
    expect(store.writes).toBe(1)
  })

  it('goes ahead once a cancelled gesture has let go', async () => {
    useRecoveryStore()
    const model = useModelStore()
    makeDirty()

    const gesture = model.beginGesture('draw', mapScope(model.project.maps[0]))
    await settle()
    expect(store.writes).toBe(0)

    gesture.cancel()
    await settle()
    expect(store.writes).toBe(1)
  })
})

describe('a snapshot outliving its usefulness', () => {
  it('is dropped when the project is saved', async () => {
    useRecoveryStore()
    const model = useModelStore()
    const file = useFileStore()
    makeDirty()
    await settle()
    const key = model.projectKey
    expect(store.records.has(key)).toBe(true)

    await file.saveAs()
    await settle()
    expect(store.records.has(key)).toBe(false)
  })

  // Undoing back to the saved point matches the file just as exactly as
  // saving does.
  it('is dropped when the project is undone back to what is on disk', async () => {
    useRecoveryStore()
    const model = useModelStore()
    makeDirty()
    await settle()
    expect(store.records.size).toBe(1)

    model.undo()
    await settle()
    expect(store.records.size).toBe(0)
  })

  // The guard has already been answered by the time a project is replaced, so
  // the work was either written or its loss was explicitly chosen.
  it('is dropped when the project it belongs to is replaced', async () => {
    useRecoveryStore()
    const model = useModelStore()
    makeDirty()
    await settle()
    const key = model.projectKey

    await replaceProject()
    await settle()
    expect(store.records.has(key)).toBe(false)
  })

  // The write that was already due when the swap happened must not land, and
  // it must not land under the new project's identity either.
  it('does not write under the new project after a swap', async () => {
    useRecoveryStore()
    const model = useModelStore()
    makeDirty()

    await replaceProject()
    await settle()
    expect(store.records.has(model.projectKey)).toBe(false)
    expect(store.writes).toBe(0)
  })
})

describe('two projects', () => {
  // One key per project and never a global slot, so a second project cannot
  // overwrite the first one's unrecovered work.
  it('each keep their own snapshot', async () => {
    store.records.set('proj_first', {
      data: cleanFile(),
      about: { projectName: 'First', fileName: null },
      savedAt: 1_700_000_000_000,
    })
    useRecoveryStore()
    const model = useModelStore()

    makeDirty('Second')
    await settle()

    expect(model.projectKey).not.toBe('proj_first')
    expect(store.records.get('proj_first')?.about.projectName).toBe('First')
    expect(store.records.get(model.projectKey)?.about.projectName).toBe('Second')
  })
})

describe('the offer', () => {
  const info: SnapshotInfo = {
    key: 'proj_old',
    savedAt: 1_700_000_000_000,
    projectName: 'Sunken City',
    fileName: 'sunken-city.mvm',
  }

  it('is empty when nothing was left behind', async () => {
    const recovery = useRecoveryStore()
    await recovery.scan()
    expect(recovery.offered).toEqual([])
  })

  it('lists what a previous session left', async () => {
    store.records.set(info.key, {
      data: cleanFile(),
      about: { projectName: info.projectName, fileName: info.fileName },
      savedAt: info.savedAt,
    })
    const recovery = useRecoveryStore()
    await recovery.scan()
    expect(recovery.offered).toEqual([info])
  })

  it('hands the work back, as unsaved work in no file', async () => {
    store.records.set(info.key, {
      data: cleanFile('Sunken City'),
      about: { projectName: info.projectName, fileName: info.fileName },
      savedAt: info.savedAt,
    })
    const recovery = useRecoveryStore()
    const model = useModelStore()
    const file = useFileStore()
    await recovery.scan()
    await recovery.recover(info.key)

    expect(model.projectName).toBe('Sunken City')
    expect(model.status.isDirty).toBe(true)
    expect(file.fileName).toBeNull()
    expect(recovery.offered).toEqual([])
  })

  // Recovered work goes on being autosaved under the identity it was
  // recovered from, so a second crash does not leave two snapshots of it.
  it('keeps writing to the snapshot it was recovered from', async () => {
    store.records.set(info.key, {
      data: cleanFile(),
      about: { projectName: info.projectName, fileName: info.fileName },
      savedAt: info.savedAt,
    })
    const recovery = useRecoveryStore()
    const model = useModelStore()
    await recovery.scan()
    await recovery.recover(info.key)
    expect(model.projectKey).toBe(info.key)

    makeDirty('Edited again')
    await settle()
    expect(store.records.get(info.key)?.about.projectName).toBe('Edited again')
    expect(store.records.size).toBe(1)
  })

  // A snapshot is written by this build, which is the argument for trusting
  // it and exactly why a corrupted store would then load unchecked.
  it('runs the full loader over a snapshot rather than trusting it', async () => {
    store.records.set(info.key, {
      data: { format: 'metroidvania-map-maker', version: 2, project: 'not a project' },
      about: { projectName: info.projectName, fileName: info.fileName },
      savedAt: info.savedAt,
    })
    const recovery = useRecoveryStore()
    const file = useFileStore()
    await recovery.scan()
    await recovery.recover(info.key)

    expect(file.outcome?.kind).toBe('invalid')
    expect(recovery.offered).toEqual([])
  })

  it('says nothing when the snapshot is gone between the offer and the click', async () => {
    store.records.set(info.key, {
      data: cleanFile(),
      about: { projectName: info.projectName, fileName: info.fileName },
      savedAt: info.savedAt,
    })
    const recovery = useRecoveryStore()
    const file = useFileStore()
    await recovery.scan()
    store.records.delete(info.key)
    await recovery.recover(info.key)

    expect(file.outcome).toBeNull()
    expect(recovery.offered).toEqual([])
  })

  // Discarding is the only thing that stops the same prompt coming back for
  // ever.
  it('throws the work away when it is discarded', async () => {
    store.records.set(info.key, {
      data: cleanFile(),
      about: { projectName: info.projectName, fileName: info.fileName },
      savedAt: info.savedAt,
    })
    const recovery = useRecoveryStore()
    await recovery.scan()
    recovery.discard(info.key)

    expect(recovery.offered).toEqual([])
    expect(store.records.has(info.key)).toBe(false)
  })

  it('leaves the work alone when the offer is only closed', async () => {
    store.records.set(info.key, {
      data: cleanFile(),
      about: { projectName: info.projectName, fileName: info.fileName },
      savedAt: info.savedAt,
    })
    const recovery = useRecoveryStore()
    await recovery.scan()
    recovery.dismiss()

    expect(recovery.offered).toEqual([])
    expect(store.records.has(info.key)).toBe(true)
  })

  it('answers one row without touching the others', async () => {
    for (const key of ['proj_a', 'proj_b']) {
      store.records.set(key, {
        data: cleanFile(),
        about: { projectName: key, fileName: null },
        savedAt: info.savedAt,
      })
    }
    const recovery = useRecoveryStore()
    await recovery.scan()
    recovery.discard('proj_a')

    expect(recovery.offered.map((row) => row.key)).toEqual(['proj_b'])
    expect(store.records.has('proj_b')).toBe(true)
  })
})
