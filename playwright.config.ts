import { defineConfig, devices } from '@playwright/test'

// Vite serves under the GH Pages base subpath, so the dev URL includes it.
const PORT = 5173

// Exported because playwright.wiki.config.ts runs the same dev server against
// the same URL. Stated once, so the two configs cannot drift onto different
// ports and race each other for one.
export const baseURL = `http://localhost:${PORT}/metroidvania-map-maker/`

export const webServer = {
  command: 'npm run dev',
  url: baseURL,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
}

// Target browsers per the design docs: latest Chromium + Firefox.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer,
})
