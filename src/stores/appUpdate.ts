// A new build waiting to be installed, and the offer to take it.
//
// The rule that shapes all of this: a service worker never swaps under a
// session that is mid-edit. The build is configured to let the new worker
// wait, so what is running stays running until the user says otherwise. That
// matters beyond tidiness. A build that reads file version 2 opening a file
// version 3 wrote is a corruption path, and the reason it is currently a loud
// one is that the loader refuses outright.
//
// And installing means reloading, which loses the project as surely as
// opening another one does. So it asks the same question, in the same place:
// an update that quietly discarded an afternoon would be the data loss this
// whole pass exists to prevent, arriving from the other direction.

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useFileStore } from './file'

// Starts watching, and hands back the way to install what is found. Taken as
// a function rather than imported so the module that names the virtual
// `virtual:pwa-register` is reached only by the app shell.
export type ServiceWorkerRegistrar = (
  onNeedRefresh: () => void,
) => (reload: boolean) => Promise<void>

export const useAppUpdateStore = defineStore('appUpdate', () => {
  const available = ref(false)

  // Set once the registrar answers. Null means nothing is watching, which is
  // every browser without a service worker and every development build.
  let apply: ((reload: boolean) => Promise<void>) | null = null

  function watchForUpdates(register: ServiceWorkerRegistrar): void {
    // Registering twice would leave two workers racing to claim the page.
    if (apply) return
    apply = register(() => {
      available.value = true
    })
  }

  // Takes the update. Nothing is returned because there is nothing the caller
  // can do either way: a refused save leaves the offer standing, and a
  // successful one is followed by the page going away.
  async function install(): Promise<void> {
    const file = useFileStore()
    // The offer stays up when this is refused. The update has not gone
    // anywhere, and hiding it would be the app deciding for the user that
    // they meant "never".
    if (!(await file.confirmDiscard())) return

    available.value = false
    await apply?.(true)
  }

  // Not now. The waiting worker takes over at the next ordinary load, so
  // nothing is lost by leaving it; only the offer goes.
  function dismiss(): void {
    available.value = false
  }

  return {
    available: computed(() => available.value),
    watchForUpdates,
    install,
    dismiss,
  }
})
