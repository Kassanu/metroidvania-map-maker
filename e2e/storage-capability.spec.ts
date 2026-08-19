import { test, expect } from '@playwright/test'

// The platform assumption the two-provider design rests on, checked rather
// than believed. Chromium can save in place; Firefox cannot and gets the
// download fallback, and the app picks between them by feature detection.
//
// If the Firefox case ever fails, it is not a broken test: it means Firefox
// has shipped File System Access and the download provider could retire.
// Read it that way rather than deleting the assertion.

test('the engine has the file capability the provider selection expects', async ({ page }) => {
  await page.goto('/')

  const capability = await page.evaluate(() => ({
    savePicker: 'showSaveFilePicker' in window,
    openPicker: 'showOpenFilePicker' in window,
    // Both engines have this one, which is why recovery and recent files work
    // everywhere even though saving in place does not.
    indexedDb: typeof indexedDB !== 'undefined',
    // What the export's zip is built on. Both engines have it, which is why
    // per-room packaging can promise a single artefact everywhere rather than
    // degrading to one download per room on the engine that cannot save in
    // place.
    deflateRaw: (() => {
      try {
        new CompressionStream('deflate-raw')
        return true
      } catch {
        return false
      }
    })(),
  }))

  expect(capability.indexedDb).toBe(true)
  expect(capability.deflateRaw).toBe(true)

  const expected = test.info().project.name === 'chromium'
  expect(capability.savePicker).toBe(expected)
  expect(capability.openPicker).toBe(expected)
})
