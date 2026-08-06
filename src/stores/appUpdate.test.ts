import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { setStorageProvider } from '@/storage'
import type { StorageProvider } from '@/storage'
import { renameProject } from '@/core/ops/project'
import { PROJECT_SCOPE, useModelStore } from './model'
import { useFileStore } from './file'
import { useAppUpdateStore } from './appUpdate'
import type { ServiceWorkerRegistrar } from './appUpdate'

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

// A service worker registration the test drives: it hands back the way to
// install, and keeps the callback so a new build can be announced on demand.
function fakeWorker() {
  const state = {
    announce: () => {},
    reloads: [] as boolean[],
    registrations: 0,
  }
  const register: ServiceWorkerRegistrar = (onNeedRefresh) => {
    state.registrations += 1
    state.announce = onNeedRefresh
    return async (reload: boolean) => {
      state.reloads.push(reload)
    }
  }
  return { register, state }
}

function makeDirty(): void {
  const model = useModelStore()
  model.run('rename', PROJECT_SCOPE, (tx) => renameProject(tx, model.project, 'Edited'))
}

beforeEach(() => {
  setActivePinia(createTestPinia())
  setStorageProvider(provider())
})

afterEach(() => {
  setStorageProvider(null)
})

describe('an update waiting to be installed', () => {
  it('is not offered until there is one', () => {
    const { register } = fakeWorker()
    const update = useAppUpdateStore()
    update.watchForUpdates(register)
    expect(update.available).toBe(false)
  })

  it('is offered once the worker says a new build is ready', () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    update.watchForUpdates(register)

    state.announce()
    expect(update.available).toBe(true)
  })

  // Two registrations would leave two workers racing to claim the page.
  it('registers once however many times it is asked to watch', () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    update.watchForUpdates(register)
    update.watchForUpdates(register)
    expect(state.registrations).toBe(1)
  })

  it('installs by reloading, and stops offering', async () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    update.watchForUpdates(register)
    state.announce()

    await update.install()
    expect(state.reloads).toEqual([true])
    expect(update.available).toBe(false)
  })

  // Nothing is watching in a browser with no service worker, and asking to
  // install must not be an error there.
  it('does nothing, quietly, when nothing was ever registered', async () => {
    const update = useAppUpdateStore()
    await expect(update.install()).resolves.toBeUndefined()
  })

  it('goes away when it is put off, without installing', async () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    update.watchForUpdates(register)
    state.announce()

    update.dismiss()
    expect(update.available).toBe(false)
    expect(state.reloads).toEqual([])
  })
})

// Installing means reloading, which loses the project as surely as opening
// another one does. It is the same question, asked in the same place.
describe('an update that would discard unsaved work', () => {
  it('asks before reloading', async () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    const file = useFileStore()
    update.watchForUpdates(register)
    state.announce()
    makeDirty()

    const installing = update.install()
    expect(file.unsavedPromptOpen).toBe(true)
    expect(state.reloads).toEqual([])

    file.chooseUnsaved('discard')
    await installing
    expect(state.reloads).toEqual([true])
  })

  it('saves first when told to, and only then reloads', async () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    const model = useModelStore()
    const file = useFileStore()
    update.watchForUpdates(register)
    state.announce()
    makeDirty()

    const installing = update.install()
    file.chooseUnsaved('save')
    await installing

    expect(model.status.isDirty).toBe(false)
    expect(state.reloads).toEqual([true])
  })

  // The offer stays up: the update has not gone anywhere, and hiding it would
  // be the app deciding the user meant "never".
  it('reloads nothing when the question is cancelled, and keeps offering', async () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    const file = useFileStore()
    update.watchForUpdates(register)
    state.announce()
    makeDirty()

    const installing = update.install()
    file.chooseUnsaved('cancel')
    await installing

    expect(state.reloads).toEqual([])
    expect(update.available).toBe(true)
  })

  it('reloads nothing when the save it triggered was dismissed', async () => {
    setStorageProvider(provider({ saveAs: async () => null }))
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    const model = useModelStore()
    const file = useFileStore()
    update.watchForUpdates(register)
    state.announce()
    makeDirty()

    const installing = update.install()
    file.chooseUnsaved('save')
    await installing

    expect(state.reloads).toEqual([])
    expect(model.status.isDirty).toBe(true)
    expect(update.available).toBe(true)
  })

  it('asks nothing of a clean project', async () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    const file = useFileStore()
    update.watchForUpdates(register)
    state.announce()

    await update.install()
    expect(file.unsavedPromptOpen).toBe(false)
    expect(state.reloads).toEqual([true])
  })
})
