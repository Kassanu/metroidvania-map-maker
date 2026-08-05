import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { openApp } from './support/canvas'

// What jsdom cannot answer about the recent list: that it survives a real
// reload in real IndexedDB, and that the menu is absent on the engine that has
// no handles to list.
//
// The one thing no automated test can reach is a real `FileSystemFileHandle`,
// which only an OS picker produces. Reopening from Recent with permission
// re-requested is checked by hand.

const DOWNLOAD_ONLY = 'firefox'
const FSA_ONLY = 'chromium'

async function openFileMenu(page: Page) {
  await page.getByRole('button', { name: 'File', exact: true }).click()
}

// Not an exact match: the submenu marker is a CSS `::after`, and Chromium
// folds generated content into the accessible name, so the item answers to
// "Recent \u25b8" there and to "Recent" elsewhere.
function recentTrigger(page: Page) {
  return page.getByRole('menuitem', { name: 'Recent' })
}

// A fresh load with no sample, so what is on screen came out of storage. The
// welcome screen is shown on every launch until it is switched off, so getting
// past it is part of loading the app.
async function reopen(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Get started' }).click()
}

// A recent entry written straight into storage. Its handle is a plain object
// rather than a real one, which is enough to render the menu and reach the
// open path, and not enough to actually open anything.
async function seedEntry(page: Page, name: string) {
  await page.evaluate(async (fileName) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mmm')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('handles', 'readwrite')
      transaction
        .objectStore('handles')
        .put(
          [{ handle: { providerId: 'fsa', name: fileName }, name: fileName, lastOpenedAt: 1 }],
          'recent',
        )
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  }, name)
}

test.describe('the Recent menu', () => {
  // The whole of what a download-only provider gets. It issues no handle that
  // survives the call, so an empty submenu would be a promise it cannot keep.
  test('is absent where the provider cannot reopen a file', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DOWNLOAD_ONLY, 'needs the download provider')
    await openApp(page)
    await openFileMenu(page)

    await expect(page.getByRole('menuitem', { name: 'Save As…', exact: true })).toBeVisible()
    await expect(recentTrigger(page)).toBeHidden()
  })

  test('is absent before anything has been opened', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== FSA_ONLY, 'needs the file system access provider')
    await openApp(page)
    await openFileMenu(page)
    await expect(recentTrigger(page)).toBeHidden()
  })

  test('lists what storage kept, across a real reload', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== FSA_ONLY, 'needs the file system access provider')
    await openApp(page)
    await seedEntry(page, 'sunken-city.mvm')

    await reopen(page)
    await openFileMenu(page)
    await recentTrigger(page).click()
    await expect(page.getByRole('menuitem', { name: 'sunken-city.mvm' })).toBeVisible()
  })

  // The failure mode this API makes easy: a handle that no longer works, and
  // a click that appears to do nothing at all.
  test('reports an entry that cannot be opened rather than doing nothing', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== FSA_ONLY, 'needs the file system access provider')
    await openApp(page)
    await seedEntry(page, 'broken.mvm')
    await reopen(page)

    await openFileMenu(page)
    await recentTrigger(page).click()
    await page.getByRole('menuitem', { name: 'broken.mvm' }).click()

    await expect(page.getByText('Could not open that file')).toBeVisible()
  })
})
