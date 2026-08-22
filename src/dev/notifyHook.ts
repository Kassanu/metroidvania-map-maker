// Reaches notify() from outside the app, in development only.
//
// The end-to-end suite is why this exists. A toast is raised by an operation
// failing or by a service worker waiting, and neither is something Playwright
// can arrange, so without a way in the one test that can see a toast's layout
// has nothing to look at. Unit tests cannot stand in: jsdom never loads
// style.css, so it cannot see whether the viewport is positioned at all.
//
// `import.meta.env.DEV` keeps it out of a production build, the same way the
// sample loader is kept out.

import { notify } from '@/notify'
import type { ToastSpec } from '@/notify'

declare global {
  interface Window {
    __notify?: (spec: ToastSpec) => void
  }
}

export function installNotifyHook(): void {
  if (!import.meta.env.DEV) return
  window.__notify = (spec) => void notify(spec)
}
