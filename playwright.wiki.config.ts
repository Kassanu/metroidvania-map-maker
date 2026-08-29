import { defineConfig, devices } from '@playwright/test'
import { baseURL, webServer } from './playwright.config'

// The wiki image pipeline, run by `npm run wiki:images`. Separate from
// playwright.config.ts because its capture settings are the image format
// rather than test settings, and because collecting it into `npm run test:e2e`
// would make the normal suite write PNGs into the wiki clone.
//
// `*.wiki.ts` is outside the default testMatch (`*.spec.ts`, `*.test.ts`), so
// the separation holds from both directions.
//
// Chromium only: these are published images, not a compatibility check, and two
// engines would mean two renderings of the same file racing to be last.
export default defineConfig({
  testDir: './e2e/wiki',
  testMatch: '**/*.wiki.ts',
  // One worker, because the runner deletes whatever the manifest does not name
  // and a second worker's half-written output would look like an orphan.
  workers: 1,
  fullyParallel: false,
  // Every image is captured inside one test, so the budget is the whole
  // manifest rather than one shot: a GIF is a screenshot per pointer step, and
  // the list only grows. Generous rather than tuned, because the failure this
  // guards against is a hung page, not a slow one.
  timeout: 15 * 60 * 1000,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    // Region crops depend on window size, so the viewport is pinned rather
    // than inherited. Stills are captured at twice the width they display at:
    // GitHub sets max-width 100% on wiki images, so one wider than the content
    // column scales down and one narrower never scales up.
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  },
  webServer,
})
