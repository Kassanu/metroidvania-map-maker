// Boots the app into the state every wiki screenshot is taken from.
//
// Theme and the welcome modal are seeded as stored preferences rather than
// driven through the UI. A preference read before mount needs no selector and
// no settled pointer, so it cannot capture a dialog mid-open or a frame the
// click landed in.
//
// The theme seed is what puts the app in Dark, as opposed to System Default
// resolving to dark. It carries native widget chrome with it, so the captures
// do not depend on the emulated OS preference.
//
// Not a `.spec.ts`, so Playwright collects no tests from it.

import type { Page } from '@playwright/test'

// Mirrors PREFS_VERSION in src/config/preferences.ts. A mismatch makes the
// plugin fall back to defaults, which would silently capture the light theme.
const PREFS_VERSION = 1

const NAMESPACE = 'mmm:'

const SEEDED_PREFS: Record<string, unknown> = {
  theme: { mode: 'dark' },
  // Stated rather than left out: the persistence plugin derives `welcomeOpen`
  // from this only when a stored value exists, and the store's default leaves
  // the modal open. Behind it a gesture aims at NaN, because `gridMapping`
  // reads a coords overlay the modal stops updating.
  welcome: { hideWelcomeOnStartup: true },
}

export interface CaptureOptions {
  // A file in samples/, by basename. Omitted boots the app's own project:
  // Untitled Project, one map, and the World area.
  sample?: string
  // Which sidebars start collapsed. Seeded rather than clicked, for the reason
  // the theme is: a preference read before mount cannot capture a panel
  // mid-animation. Omitted leaves both open, which is the app's own default.
  collapse?: { left?: boolean; right?: boolean }
}

export async function openForCapture(page: Page, options: CaptureOptions = {}) {
  // Only the collapse flags: the persistence plugin keeps the default for any
  // field a stored value omits, so the sidebar widths stay the app's own.
  const prefs: Record<string, unknown> = {
    ...SEEDED_PREFS,
    sidebarLayout: {
      leftSidebarCollapsed: options.collapse?.left ?? false,
      rightSidebarCollapsed: options.collapse?.right ?? false,
    },
  }

  await page.addInitScript(
    ({ namespace, version, prefs }) => {
      for (const [key, data] of Object.entries(prefs)) {
        localStorage.setItem(namespace + key, JSON.stringify({ v: version, data }))
      }
    },
    { namespace: NAMESPACE, version: PREFS_VERSION, prefs },
  )

  // Relative, so it resolves under the Vite base rather than relying on the
  // dev server to redirect a root path and keep the query string. `.` is the
  // base itself, which is the app with nothing asked of it.
  await page.goto(options.sample ? `?sample=${encodeURIComponent(options.sample)}` : '.')

  await page.locator('.app-shell').waitFor()
  // The canvas is sized from its container's rect on mount, so a non-zero
  // backing store is the signal that layout settled and the first draw ran.
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.canvas')
    return !!canvas && canvas.width > 0 && canvas.height > 0
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}
