import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { setStorageProvider } from '@/storage'
import type { StorageProvider } from '@/storage'
import { clearToasts, dismissToast, notify, toasts } from '@/notify'
import type { Toast, ToastAction } from '@/notify'
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
    saveBytes: async () => 'written' as const,
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

// The offer is the only toast any of these tests raises.
function offer(): Toast | undefined {
  return toasts.value[0]
}

function reloadAction(): ToastAction {
  const action = offer()?.actions?.[0]
  if (!action) throw new Error('the offer carries no action')
  return action
}

// A click on the action starts `install` without handing back its promise, so
// a macrotask is what lets it run to the end.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  setActivePinia(createTestPinia())
  setStorageProvider(provider())
})

afterEach(() => {
  setStorageProvider(null)
  // Module-level state, shared by every test that raises a toast.
  clearToasts()
})

describe('an update waiting to be installed', () => {
  it('is not offered until there is one', () => {
    const { register } = fakeWorker()
    const update = useAppUpdateStore()
    update.watchForUpdates(register)
    expect(toasts.value).toHaveLength(0)
  })

  // An offer, not a warning: nothing is wrong, and the update keeps.
  it('says a new build is available, and what taking it involves', () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    update.watchForUpdates(register)

    state.announce()
    expect(offer()).toMatchObject({
      severity: 'info',
      titleKey: 'update.title',
      bodyKey: 'update.body',
    })
  })

  // A notice that vanished before it was read would be the same as no notice,
  // and this one interrupts nothing by staying.
  it('stays until something closes it', () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    update.watchForUpdates(register)

    state.announce()
    expect(offer()?.sticky).toBe(true)
  })

  // The × on every toast is the other half of the choice, so a labelled
  // "Later" beside it would say the same thing twice.
  it('offers reloading as its one action', () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    update.watchForUpdates(register)

    state.announce()
    expect(offer()?.actions).toHaveLength(1)
    expect(reloadAction()).toMatchObject({ labelKey: 'update.reload', primary: true })
  })

  // Two registrations would leave two workers racing to claim the page.
  it('registers once however many times it is asked to watch', () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    update.watchForUpdates(register)
    update.watchForUpdates(register)
    expect(state.registrations).toBe(1)
  })

  // One offer at a time: a second announcement while one stands would leave
  // two notices saying the same thing, and only one of them closable through
  // the handle the store holds.
  it('raises one offer however often a new build is announced', () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    update.watchForUpdates(register)

    state.announce()
    state.announce()
    expect(toasts.value).toHaveLength(1)
  })

  // The corner button closes a toast without telling whoever raised it, so an
  // offer can be gone while the store still holds its handle. A later build
  // has to be announced anyway, or dismissing one offer would silence every
  // offer after it for the life of the tab.
  it('announces a later build after the offer was closed from the toast itself', () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    update.watchForUpdates(register)

    state.announce()
    dismissToast(toasts.value[0].id)
    expect(toasts.value).toHaveLength(0)

    state.announce()
    expect(toasts.value).toHaveLength(1)
  })

  it('installs by reloading, and takes the offer down', async () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    update.watchForUpdates(register)
    state.announce()

    await update.install()
    expect(state.reloads).toEqual([true])
    expect(toasts.value).toHaveLength(0)
  })

  // The store closes the offer through the handle it kept, so it takes down
  // that offer and nothing else on the queue.
  it('leaves other messages alone when the offer goes', () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    update.watchForUpdates(register)
    state.announce()
    notify({ severity: 'error', bodyKey: 'modal.export.failed', params: { message: 'disk full' } })

    update.dismiss()

    expect(toasts.value.map((toast) => toast.bodyKey)).toEqual(['modal.export.failed'])
  })

  it("installs when the offer's own action is taken", async () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    update.watchForUpdates(register)
    state.announce()

    reloadAction().onClick()
    await settle()
    expect(state.reloads).toEqual([true])
  })

  // Nothing is watching in a browser with no service worker, and asking to
  // install must not be an error there.
  it('does nothing, quietly, when nothing was ever registered', async () => {
    const update = useAppUpdateStore()
    await expect(update.install()).resolves.toBeUndefined()
  })

  it('goes away when it is put off, without installing', () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    update.watchForUpdates(register)
    state.announce()

    update.dismiss()
    expect(toasts.value).toHaveLength(0)
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
  // be the app deciding the user meant "never". It is still up while the
  // question is open, too, which is what a toast closing on its own action
  // would have taken away.
  it('reloads nothing when the question is cancelled, and keeps offering', async () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    const file = useFileStore()
    update.watchForUpdates(register)
    state.announce()
    makeDirty()

    const installing = update.install()
    expect(toasts.value).toHaveLength(1)

    file.chooseUnsaved('cancel')
    await installing

    expect(state.reloads).toEqual([])
    expect(toasts.value).toHaveLength(1)
  })

  // Same refusal, reached through the button the user actually presses.
  it('keeps the offer standing when its action is refused', async () => {
    const { register, state } = fakeWorker()
    const update = useAppUpdateStore()
    const file = useFileStore()
    update.watchForUpdates(register)
    state.announce()
    makeDirty()

    reloadAction().onClick()
    await settle()
    file.chooseUnsaved('cancel')
    await settle()

    expect(state.reloads).toEqual([])
    expect(toasts.value).toHaveLength(1)
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
    expect(toasts.value).toHaveLength(1)
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
