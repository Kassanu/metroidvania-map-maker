import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import {
  FileMissingError,
  PermissionDeniedError,
  StorageError,
  setStorageProvider,
} from '@/storage'
import type { OpenedProject, StorageEntry, StorageHandle, StorageProvider } from '@/storage'
import { FileTooLargeError } from '@/core/serialize/limits'
import { toJSON } from '@/core/serialize'
import { PROJECT_SCOPE, useModelStore } from './model'
import { useFileStore } from './file'
import { renameProject } from '@/core/ops/project'
import { createProject } from '@/core/factory'

// A provider whose every answer the test dictates. The real ones are covered
// in `src/storage`; what matters here is what this store does with each answer.
function fakeProvider(over: Partial<StorageProvider> = {}): StorageProvider {
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
    saveAs: async () => null,
    ...over,
  }
}

function handle(name = 'world.mvm'): StorageHandle {
  return { providerId: 'fake', name }
}

// A clean file the loader accepts with nothing to repair.
function cleanFile(): unknown {
  return toJSON(
    createProject({
      projectName: 'From disk',
      firstMapName: 'Map 1',
      worldAreaName: 'World',
      openLockName: 'Open',
      lockedLockName: 'Locked',
    }),
  )
}

// A file that loads but needs repairing, so `requiresConfirmation` is true.
function repairableFile(): unknown {
  const file = cleanFile() as { project: { maps: { rooms: unknown[] }[] } }
  file.project.maps[0].rooms = [{ id: 'r1', areaId: 'nope', cells: [[0, 0]] }]
  return file
}

// Lets a fire-and-forget call and everything it awaits finish. The dialog
// handlers are synchronous, so remembering and forgetting are started rather
// than awaited.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function makeDirty(): void {
  const model = useModelStore()
  model.run('rename', PROJECT_SCOPE, (tx) => renameProject(tx, model.project, 'Edited'))
}

beforeEach(() => {
  setActivePinia(createTestPinia())
})

afterEach(() => {
  setStorageProvider(null)
})

describe('markSaved follows the bytes', () => {
  it('marks clean when the write comes back', async () => {
    setStorageProvider(fakeProvider({ saveAs: async () => handle() }))
    const model = useModelStore()
    const file = useFileStore()
    makeDirty()
    expect(model.status.isDirty).toBe(true)

    expect(await file.saveAs()).toBe(true)
    expect(model.status.isDirty).toBe(false)
    expect(file.fileName).toBe('world.mvm')
  })

  // Every one of these leaves the work only in memory, so the title bar must
  // keep saying so.
  it('leaves the project dirty when the picker is dismissed', async () => {
    setStorageProvider(fakeProvider({ saveAs: async () => null }))
    const model = useModelStore()
    const file = useFileStore()
    makeDirty()

    expect(await file.saveAs()).toBe(false)
    expect(model.status.isDirty).toBe(true)
    expect(file.fileName).toBeNull()
  })

  it('leaves the project dirty when the write fails', async () => {
    setStorageProvider(
      fakeProvider({
        saveAs: async () => handle(),
        save: async () => {
          throw new StorageError('disk full')
        },
      }),
    )
    const model = useModelStore()
    const file = useFileStore()
    await file.saveAs()
    makeDirty()

    expect(await file.save()).toBe(false)
    expect(model.status.isDirty).toBe(true)
    expect(file.outcome?.kind).toBe('failed')
  })

  it('writes back to the same handle once there is one', async () => {
    const save = vi.fn(async (h: StorageHandle) => h)
    setStorageProvider(fakeProvider({ saveAs: async () => handle(), save }))
    const file = useFileStore()

    await file.saveAs()
    makeDirty()
    await file.save()

    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].name).toBe('world.mvm')
  })

  it('falls through to Save As while there is no file', async () => {
    const saveAs = vi.fn(async () => handle())
    setStorageProvider(fakeProvider({ saveAs }))
    const file = useFileStore()

    await file.save()
    expect(saveAs).toHaveBeenCalledTimes(1)
  })
})

describe('the unsaved-work guard', () => {
  it('asks nothing of a clean project', async () => {
    setStorageProvider(fakeProvider())
    const file = useFileStore()
    expect(await file.confirmDiscard()).toBe(true)
    expect(file.unsavedPromptOpen).toBe(false)
  })

  it('discards without saving when told to', async () => {
    const saveAs = vi.fn(async () => handle())
    setStorageProvider(fakeProvider({ saveAs }))
    const file = useFileStore()
    makeDirty()

    const answer = file.confirmDiscard()
    expect(file.unsavedPromptOpen).toBe(true)
    file.chooseUnsaved('discard')

    expect(await answer).toBe(true)
    expect(saveAs).not.toHaveBeenCalled()
  })

  it('refuses when cancelled', async () => {
    setStorageProvider(fakeProvider())
    const file = useFileStore()
    makeDirty()

    const answer = file.confirmDiscard()
    file.chooseUnsaved('cancel')
    expect(await answer).toBe(false)
  })

  it('saves first when told to, and then allows the replacement', async () => {
    setStorageProvider(fakeProvider({ saveAs: async () => handle() }))
    const model = useModelStore()
    const file = useFileStore()
    makeDirty()

    const answer = file.confirmDiscard()
    file.chooseUnsaved('save')

    expect(await answer).toBe(true)
    expect(model.status.isDirty).toBe(false)
  })

  // The composition that matters, and the one no half of this tests alone.
  it('cancels the whole operation when the save it triggered is dismissed', async () => {
    setStorageProvider(fakeProvider({ saveAs: async () => null }))
    const model = useModelStore()
    const file = useFileStore()
    makeDirty()

    const answer = file.confirmDiscard()
    file.chooseUnsaved('save')

    expect(await answer).toBe(false)
    expect(model.status.isDirty).toBe(true)
  })

  it('cancels the whole operation when the save it triggered fails', async () => {
    setStorageProvider(
      fakeProvider({
        saveAs: async () => {
          throw new StorageError('nope')
        },
      }),
    )
    const file = useFileStore()
    makeDirty()

    const answer = file.confirmDiscard()
    file.chooseUnsaved('save')
    expect(await answer).toBe(false)
  })
})

describe('New', () => {
  it('replaces the project with a blank one and forgets the file', async () => {
    setStorageProvider(fakeProvider({ saveAs: async () => handle() }))
    const model = useModelStore()
    const file = useFileStore()
    await file.saveAs()

    expect(await file.newProject()).toBe(true)
    expect(file.fileName).toBeNull()
    expect(model.project.maps).toHaveLength(1)
    expect(model.status.isDirty).toBe(false)
    expect(model.status.canUndo).toBe(false)
  })

  it('keeps the project when the guard is cancelled', async () => {
    setStorageProvider(fakeProvider())
    const model = useModelStore()
    const file = useFileStore()
    makeDirty()
    const before = model.projectName

    const answer = file.newProject()
    file.chooseUnsaved('cancel')

    expect(await answer).toBe(false)
    expect(model.projectName).toBe(before)
    expect(model.status.isDirty).toBe(true)
  })
})

describe('Open', () => {
  it('adopts a clean file and remembers where it came from', async () => {
    const opened: OpenedProject = { data: cleanFile(), handle: handle('loaded.mvm') }
    setStorageProvider(fakeProvider({ open: async () => opened }))
    const model = useModelStore()
    const file = useFileStore()

    expect(await file.open()).toBe(true)
    expect(model.projectName).toBe('From disk')
    expect(file.fileName).toBe('loaded.mvm')
    expect(model.status.isDirty).toBe(false)
  })

  it('leaves everything alone when the picker is dismissed', async () => {
    setStorageProvider(fakeProvider({ open: async () => null }))
    const model = useModelStore()
    const file = useFileStore()
    const before = model.projectName

    expect(await file.open()).toBe(false)
    expect(model.projectName).toBe(before)
    expect(file.outcome).toBeNull()
  })

  // The structural gate: a repaired project is unconfirmed data and does not
  // become the live project until someone says so.
  it('holds a repaired file behind the outcome until it is accepted', async () => {
    const opened: OpenedProject = { data: repairableFile(), handle: handle() }
    setStorageProvider(fakeProvider({ open: async () => opened }))
    const model = useModelStore()
    const file = useFileStore()
    const before = model.projectName

    expect(await file.open()).toBe(false)
    expect(model.projectName).toBe(before)
    expect(file.outcome?.kind).toBe('repaired')

    if (file.outcome?.kind === 'repaired') {
      expect(file.outcome.counts.get('area-remapped')).toBe(1)
      file.outcome.accept()
    }
    expect(model.projectName).toBe('From disk')
    expect(file.fileName).toBe('world.mvm')
  })

  it('never touches the current project when the load fails', async () => {
    const model = useModelStore()
    makeDirty()
    const before = model.projectName

    for (const error of [
      new StorageError('too big', new FileTooLargeError('bytes', 1)),
      new StorageError('bad', new SyntaxError('unexpected token')),
      new StorageError('gone'),
    ]) {
      setStorageProvider(
        fakeProvider({
          open: async () => {
            throw error
          },
        }),
      )
      const fresh = useFileStore()
      // Discarding gets past the guard, so what is asserted below is the load
      // failing rather than the guard refusing.
      const answer = fresh.open()
      fresh.chooseUnsaved('discard')

      expect(await answer).toBe(false)
      expect(model.projectName).toBe(before)
      expect(model.status.isDirty).toBe(true)
      fresh.dismissOutcome()
    }
  })

  it('tells the three refusals apart by type, not by message', async () => {
    const cases: [unknown, string][] = [
      [new StorageError('x', new FileTooLargeError('cellsPerRoom', 1)), 'too-large'],
      [new StorageError('x', new SyntaxError('bad')), 'invalid'],
      [new StorageError('x'), 'failed'],
    ]
    for (const [error, kind] of cases) {
      setStorageProvider(
        fakeProvider({
          open: async () => {
            throw error
          },
        }),
      )
      setActivePinia(createTestPinia())
      const file = useFileStore()
      await file.open()
      expect(file.outcome?.kind).toBe(kind)
    }
  })

  it('asks about unsaved work before it opens the picker', async () => {
    const open = vi.fn(async () => null)
    setStorageProvider(fakeProvider({ open }))
    const file = useFileStore()
    makeDirty()

    const answer = file.open()
    expect(open).not.toHaveBeenCalled()
    file.chooseUnsaved('cancel')

    expect(await answer).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})

describe('restoring a snapshot', () => {
  it('adopts the project the snapshot holds', async () => {
    const file = useFileStore()
    const model = useModelStore()

    expect(await file.restoreSnapshot(cleanFile(), 'proj_old')).toBe(true)
    expect(model.projectName).toBe('From disk')
  })

  // It is work that was never written anywhere, and the title bar, the unload
  // guard and autosave all read that off the dirty flag.
  it('adopts it as unsaved work in no file', async () => {
    const file = useFileStore()
    const model = useModelStore()
    await file.restoreSnapshot(cleanFile(), 'proj_old')

    expect(model.status.isDirty).toBe(true)
    expect(file.fileName).toBeNull()
  })

  // Autosave writes under this, so a snapshot that is recovered must go on
  // being the same snapshot rather than spawning a second one beside it.
  it('carries the snapshot identity onto the recovered project', async () => {
    const file = useFileStore()
    const model = useModelStore()
    await file.restoreSnapshot(cleanFile(), 'proj_old')
    expect(model.projectKey).toBe('proj_old')
  })

  // A snapshot is written by this build, which is the argument people use to
  // skip validation and exactly why a corrupted store would load unchecked.
  it('runs the full loader over it, gate and all', async () => {
    const file = useFileStore()
    const model = useModelStore()
    const before = model.projectName

    expect(await file.restoreSnapshot(repairableFile(), 'proj_old')).toBe(false)
    expect(file.outcome?.kind).toBe('repaired')
    expect(model.projectName).toBe(before)
  })

  it('adopts a repaired snapshot as unsaved work once it is accepted', async () => {
    const file = useFileStore()
    const model = useModelStore()
    await file.restoreSnapshot(repairableFile(), 'proj_old')

    const outcome = file.outcome
    if (outcome?.kind !== 'repaired') throw new Error('expected a repaired outcome')
    outcome.accept()

    expect(model.projectName).toBe('From disk')
    expect(model.projectKey).toBe('proj_old')
    expect(model.status.isDirty).toBe(true)
    expect(file.fileName).toBeNull()
  })

  it('refuses a snapshot that is not a project, and keeps the one in hand', async () => {
    const file = useFileStore()
    const model = useModelStore()
    const before = model.projectName

    expect(await file.restoreSnapshot({ format: 'something else' }, 'proj_old')).toBe(false)
    expect(file.outcome?.kind).toBe('invalid')
    expect(model.projectName).toBe(before)
  })

  it('asks about unsaved work before replacing it', async () => {
    const file = useFileStore()
    const model = useModelStore()
    makeDirty()
    const before = model.projectName

    const answer = file.restoreSnapshot(cleanFile(), 'proj_old')
    file.chooseUnsaved('cancel')

    expect(await answer).toBe(false)
    expect(model.projectName).toBe(before)
  })
})

describe('the recent list', () => {
  // An in-memory provider list, so what the store did with it is visible.
  function withRecent(over: Partial<StorageProvider> = {}) {
    const entries: StorageEntry[] = []
    const provider = fakeProvider({
      list: async () => [...entries],
      remember: async (from) => {
        const at = entries.findIndex((entry) => entry.handle.name === from.name)
        if (at >= 0) entries.splice(at, 1)
        entries.unshift({ handle: from, name: from.name, lastOpenedAt: entries.length })
      },
      forget: async (from) => {
        const at = entries.findIndex((entry) => entry.handle.name === from.name)
        if (at >= 0) entries.splice(at, 1)
      },
      ...over,
    })
    setStorageProvider(provider)
    return entries
  }

  it('is empty until something is asked of storage', () => {
    withRecent()
    expect(useFileStore().recent).toEqual([])
  })

  it('reads what storage has when asked', async () => {
    const entries = withRecent()
    entries.push({ handle: handle('old.mvm'), name: 'old.mvm', lastOpenedAt: 1 })

    const file = useFileStore()
    await file.refreshRecent()
    expect(file.recent.map((entry) => entry.name)).toEqual(['old.mvm'])
  })

  // A handle is worth offering again only once it has proved it works, which
  // is the same rule `markSaved` follows: the far side of real bytes.
  it('records a file that opened', async () => {
    withRecent({ open: async () => ({ data: cleanFile(), handle: handle('opened.mvm') }) })
    const file = useFileStore()

    await file.open()
    expect(file.recent.map((entry) => entry.name)).toEqual(['opened.mvm'])
  })

  it('records a file that was written', async () => {
    withRecent({ saveAs: async () => handle('written.mvm') })
    const file = useFileStore()

    await file.saveAs()
    expect(file.recent.map((entry) => entry.name)).toEqual(['written.mvm'])
  })

  it('records nothing for an open that failed', async () => {
    withRecent({
      open: async () => {
        throw new StorageError('nope')
      },
    })
    const file = useFileStore()

    await file.open()
    expect(file.recent).toEqual([])
  })

  it('records nothing for a picker that was dismissed', async () => {
    withRecent({ saveAs: async () => null })
    const file = useFileStore()

    await file.saveAs()
    expect(file.recent).toEqual([])
  })

  // The repaired project only exists once it is accepted, and so does the
  // reason to remember where it came from.
  it('records a repaired file only once the repair is accepted', async () => {
    withRecent({ open: async () => ({ data: repairableFile(), handle: handle('hurt.mvm') }) })
    const file = useFileStore()

    await file.open()
    expect(file.recent).toEqual([])

    const outcome = file.outcome
    if (outcome?.kind !== 'repaired') throw new Error('expected a repaired outcome')
    // The dialog's accept handler is synchronous, so remembering is started
    // rather than awaited.
    outcome.accept()
    await settle()
    expect(file.recent.map((entry) => entry.name)).toEqual(['hurt.mvm'])
  })

  it('drops an entry when told to forget it', async () => {
    const entries = withRecent()
    entries.push({ handle: handle('gone.mvm'), name: 'gone.mvm', lastOpenedAt: 1 })
    const file = useFileStore()
    await file.refreshRecent()

    await file.forgetRecent(handle('gone.mvm'))
    expect(file.recent).toEqual([])
  })
})

// A file the app already knew about that has stopped opening. Both cases have
// their own sentence and their own way out, and both are told apart by type.
describe('a recent file that no longer opens', () => {
  it('reports a file that has moved, and offers to drop the entry', async () => {
    const forget = vi.fn(async () => {})
    setStorageProvider(
      fakeProvider({
        forget,
        open: async () => {
          throw new FileMissingError()
        },
      }),
    )
    const file = useFileStore()

    expect(await file.open(handle('moved.mvm'))).toBe(false)
    const outcome = file.outcome
    if (outcome?.kind !== 'missing') throw new Error('expected a missing outcome')
    expect(outcome.name).toBe('moved.mvm')

    outcome.forget()
    await settle()
    expect(forget).toHaveBeenCalledTimes(1)
  })

  it('reports a refused permission separately from a missing file', async () => {
    setStorageProvider(
      fakeProvider({
        open: async () => {
          throw new PermissionDeniedError()
        },
      }),
    )
    const file = useFileStore()

    await file.open(handle('locked.mvm'))
    expect(file.outcome?.kind).toBe('permission-refused')
  })

  // The same failures reaching a save, where the handle is the one being
  // written to rather than one picked off the list.
  it('names the file a failed save was writing to', async () => {
    setStorageProvider(
      fakeProvider({
        saveAs: async () => handle('vanished.mvm'),
        save: async () => {
          throw new FileMissingError()
        },
      }),
    )
    const file = useFileStore()
    await file.saveAs()
    makeDirty()

    expect(await file.save()).toBe(false)
    const outcome = file.outcome
    if (outcome?.kind !== 'missing') throw new Error('expected a missing outcome')
    expect(outcome.name).toBe('vanished.mvm')
  })

  // Nothing was picked off a list, so there is no entry to offer to drop and
  // the shared wording is what is left.
  it('falls back to the general failure when no file was named', async () => {
    setStorageProvider(
      fakeProvider({
        open: async () => {
          throw new PermissionDeniedError()
        },
      }),
    )
    const file = useFileStore()

    await file.open()
    expect(file.outcome?.kind).toBe('failed')
  })
})

// A `.mvm` double-clicked in the operating system. Only the arrival is
// different; everything after it is Open.
describe('a launched file', () => {
  const launched = { name: 'launched.mvm' } as FileSystemFileHandle

  it('opens through the provider handle it was turned into', async () => {
    const opened: (StorageHandle | undefined)[] = []
    setStorageProvider(
      fakeProvider({
        adoptFileHandle: (file) => handle(file.name),
        open: async (from) => {
          opened.push(from)
          return { data: cleanFile(), handle: handle(from?.name ?? '') }
        },
      }),
    )
    const file = useFileStore()

    expect(await file.openLaunched(launched)).toBe(true)
    expect(opened.map((from) => from?.name)).toEqual(['launched.mvm'])
    expect(useModelStore().projectName).toBe('From disk')
  })

  // The launch arrives at a window that is already open as well as a cold
  // one, and that is the window where unsaved work exists.
  it('asks about unsaved work like any other replacement', async () => {
    const open = vi.fn(async () => null)
    setStorageProvider(fakeProvider({ adoptFileHandle: () => handle(), open }))
    const file = useFileStore()
    makeDirty()

    const answer = file.openLaunched(launched)
    expect(file.unsavedPromptOpen).toBe(true)
    file.chooseUnsaved('cancel')

    expect(await answer).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  // Only the provider knows what to make of the platform's handle, and the
  // one that cannot use it says so.
  it('does nothing where the provider cannot hold a file handle', async () => {
    const open = vi.fn(async () => null)
    setStorageProvider(fakeProvider({ adoptFileHandle: () => null, open }))
    const file = useFileStore()

    expect(await file.openLaunched(launched)).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(file.outcome).toBeNull()
  })

  it('reports a launched file that will not open', async () => {
    setStorageProvider(
      fakeProvider({
        adoptFileHandle: () => handle('gone.mvm'),
        open: async () => {
          throw new FileMissingError()
        },
      }),
    )
    const file = useFileStore()

    expect(await file.openLaunched(launched)).toBe(false)
    expect(file.outcome?.kind).toBe('missing')
  })
})

describe('the current file indicator', () => {
  it('has nothing to name until a project has been written or opened', async () => {
    setStorageProvider(fakeProvider({ saveAs: async () => handle('named.mvm') }))
    const file = useFileStore()
    expect(file.fileName).toBeNull()

    await file.saveAs()
    expect(file.fileName).toBe('named.mvm')
  })

  it('reports what the provider can do rather than which browser this is', () => {
    setStorageProvider(fakeProvider({ canSaveInPlace: false }))
    expect(useFileStore().canSaveInPlace).toBe(false)
  })
})
