// A new build waiting to be installed, and the offer to take it.
//
// Nothing swaps under a session that is mid-edit: the new worker waits until
// it is taken. Taking it means reloading, which loses the project as surely
// as opening another one does, so it asks the same question in the same
// place, `file.confirmDiscard()`.
//
// One offer stands at a time. The store keeps the handle `notify` returned
// and closes the offer only through that handle, so a second announcement
// while one stands adds nothing.
//
// Refusing the unsaved-work prompt leaves the offer standing: the update has
// not gone anywhere, and hiding it would be the app deciding for the user
// that they meant "never". The toast's action does not close its own toast,
// so what survives the refusal is the offer as it was.

import { defineStore } from 'pinia'
import { notify } from '@/notify'
import type { ToastHandle } from '@/notify'
import { useFileStore } from './file'

// Starts watching, and hands back the way to install what is found. Taken as
// a function rather than imported so the module that names the virtual
// `virtual:pwa-register` is reached only by the app shell.
export type ServiceWorkerRegistrar = (
  onNeedRefresh: () => void,
) => (reload: boolean) => Promise<void>

export const useAppUpdateStore = defineStore('appUpdate', () => {
  // Set once the registrar answers. Null means nothing is watching, which is
  // every browser without a service worker and every development build.
  let apply: ((reload: boolean) => Promise<void>) | null = null

  // The standing offer, or null when none is up.
  let offer: ToastHandle | null = null

  function watchForUpdates(register: ServiceWorkerRegistrar): void {
    // Registering twice would leave two workers racing to claim the page.
    if (apply) return
    apply = register(raiseOffer)
  }

  function raiseOffer(): void {
    // Supersede rather than skip. The user can close the offer with the
    // toast's own corner button, which the store never hears about, so a guard
    // on the handle being set would swallow the announcement of every later
    // build. Dismissing a toast that has already gone does nothing.
    closeOffer()
    offer = notify({
      severity: 'info',
      titleKey: 'update.title',
      bodyKey: 'update.body',
      // The update keeps as long as it takes, and a notice that vanished
      // before it was read would be the same as no notice.
      sticky: true,
      actions: [{ labelKey: 'update.reload', primary: true, onClick: () => void install() }],
    })
  }

  function closeOffer(): void {
    offer?.dismiss()
    offer = null
  }

  // Takes the update. Nothing is returned because there is nothing the caller
  // can do either way: a refused save leaves the offer standing, and a
  // successful one is followed by the page going away.
  async function install(): Promise<void> {
    const file = useFileStore()
    if (!(await file.confirmDiscard())) return

    closeOffer()
    await apply?.(true)
  }

  // Not now. The waiting worker takes over at the next ordinary load, so
  // nothing is lost by leaving it; only the offer goes.
  function dismiss(): void {
    closeOffer()
  }

  return {
    watchForUpdates,
    install,
    dismiss,
  }
})
