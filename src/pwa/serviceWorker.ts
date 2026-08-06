// The one place `virtual:pwa-register` is named.
//
// It is a build-time virtual module, so importing it anywhere the test runner
// reaches would tie the suite to the plugin being in the chain. Everything
// above this takes a registrar function instead, and only the app shell wires
// this one in.

import { registerSW } from 'virtual:pwa-register'
import type { ServiceWorkerRegistrar } from '@/stores/appUpdate'

export const registerServiceWorker: ServiceWorkerRegistrar = (onNeedRefresh) => {
  // `immediate` registers on load rather than waiting for the window's own
  // load event, so an update is noticed in the session it appears in.
  //
  // The build is configured `registerType: 'prompt'`, which is what makes
  // `onNeedRefresh` fire at all: the new worker waits, and nothing swaps
  // under a session that is mid-edit until someone says so.
  return registerSW({ immediate: true, onNeedRefresh })
}
