import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { openApp } from './support/canvas'

// The claim autosave actually makes: work that was never written to a file
// survives the tab dying. jsdom can show the scheduling and the store; only a
// real browser can show a snapshot outliving the page that wrote it.

const DOWNLOAD_ONLY = 'firefox'

async function renameProject(page: Page, to: string) {
  await page.locator('.project-title-button').click()
  await page.locator('.project-title-input').fill(to)
  await page.keyboard.press('Enter')
}

// The project names in the recovery store, read straight out of IndexedDB.
// What the app is about to offer, before it is asked to offer it.
function snapshotNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mmm')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    if (!database.objectStoreNames.contains('recovery')) {
      database.close()
      return []
    }
    const values = await new Promise<{ projectName?: string }[]>((resolve) => {
      const transaction = database.transaction('recovery', 'readonly')
      const request = transaction.objectStore('recovery').getAll()
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => resolve([])
    })
    database.close()
    return values.map((record) => record.projectName ?? '')
  })
}

// Autosave is debounced, so the snapshot lands a beat after the edit.
async function waitForSnapshot(page: Page, name: string) {
  await expect.poll(() => snapshotNames(page), { timeout: 20_000 }).toContain(name)
}

test.describe('crash recovery', () => {
  test('offers work back after the page is gone, and hands it over unsaved', async ({ page }) => {
    await openApp(page)
    await renameProject(page, 'Crashed Session')
    await waitForSnapshot(page, 'Crashed Session')

    // A fresh load with no sample, so anything on screen afterwards came out
    // of the store rather than out of the URL.
    await page.goto('/')

    await expect(page.getByText('Recover unsaved work?')).toBeVisible()
    await expect(page.getByText('Crashed Session')).toBeVisible()
    await page.getByRole('button', { name: 'Recover', exact: true }).click()

    // Recovered, and still unsaved work in no file: the dirty marker and the
    // indicator both have to say so.
    await expect(page.locator('.project-title-button')).toHaveText('Crashed Session •')
    await expect(page.getByText('Not saved to a file')).toBeVisible()
    await expect(page.getByText('Recover unsaved work?')).toBeHidden()
  })

  test('does not ask again once the work is discarded', async ({ page }) => {
    await openApp(page)
    await renameProject(page, 'Throwaway Session')
    await waitForSnapshot(page, 'Throwaway Session')

    await page.goto('/')
    await expect(page.getByText('Recover unsaved work?')).toBeVisible()
    await page.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect(page.getByText('Recover unsaved work?')).toBeHidden()

    await page.goto('/')
    await expect(page.locator('.project-title-button')).toBeVisible()
    await expect(page.getByText('Recover unsaved work?')).toBeHidden()
    expect(await snapshotNames(page)).toEqual([])
  })

  // Putting the offer off is not answering it: the work is still there, so it
  // is still offered. Discarding is the only thing that stops the question.
  test('asks again after the offer is only put off', async ({ page }) => {
    await openApp(page)
    await renameProject(page, 'Undecided Session')
    await waitForSnapshot(page, 'Undecided Session')

    await page.goto('/')
    await page.getByRole('button', { name: 'Not Now', exact: true }).click()
    await expect(page.getByText('Recover unsaved work?')).toBeHidden()

    await page.goto('/')
    await expect(page.getByText('Undecided Session')).toBeVisible()
  })

  test('has nothing to offer once the work is in a file', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DOWNLOAD_ONLY, 'needs the download provider')
    await openApp(page)
    await renameProject(page, 'Saved Session')
    await waitForSnapshot(page, 'Saved Session')

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Save As…', exact: true }).click()
    await downloadPromise

    // Written, so there is nothing left to recover.
    await expect.poll(() => snapshotNames(page)).toEqual([])

    await page.goto('/')
    await expect(page.locator('.project-title-button')).toBeVisible()
    await expect(page.getByText('Recover unsaved work?')).toBeHidden()
  })
})
