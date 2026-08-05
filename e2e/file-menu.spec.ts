import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { openApp } from './support/canvas'

// The first end-to-end coverage of a real save and a real open.
//
// Playwright cannot drive an OS file picker, so the File System Access path
// has no automated coverage in Chromium and is checked by hand. The download
// provider can be driven completely: a real download event, and a real file
// handed to a real `<input type="file">`. That is Firefox's whole story, and
// it is the half no unit test can speak for.

const DOWNLOAD_ONLY = 'firefox'

async function openFileMenu(page: Page) {
  await page.getByRole('button', { name: 'File', exact: true }).click()
}

async function pickFileItem(page: Page, name: string) {
  await openFileMenu(page)
  await page.getByRole('menuitem', { name, exact: true }).click()
}

// Renaming the project is the cheapest real edit that leaves the canvas alone,
// and it is what the dirty marker is read off.
async function renameProject(page: Page, to: string) {
  await page.locator('.project-title-button').click()
  await page.locator('.project-title-input').fill(to)
  await page.keyboard.press('Enter')
}

test.describe('the File menu', () => {
  test('offers all four verbs', async ({ page }) => {
    await openApp(page)
    await openFileMenu(page)
    for (const name of ['New', 'Open…', 'Save', 'Save As…']) {
      await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible()
    }
  })

  test('says the project is in no file until it is', async ({ page }) => {
    await openApp(page)
    await expect(page.getByText('Not saved to a file')).toBeVisible()
  })

  test('saves a real file and opens it back', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DOWNLOAD_ONLY, 'needs the download provider')
    await openApp(page)
    // The dev server seeds a fixture, so the starting name is whatever that
    // holds rather than a fresh project's. Read it instead of assuming it.
    const projectName = await page.locator('.project-title-button').innerText()

    const downloadPromise = page.waitForEvent('download')
    await pickFileItem(page, 'Save As…')
    const download = await downloadPromise

    // A real file, named from the project and holding the real format.
    expect(download.suggestedFilename()).toBe(`${projectName}.mvm`)
    // Kept under its real name rather than read from `download.path()`, which
    // is a temp file named with a UUID. Feeding that back to the input would
    // reopen a file genuinely called that, and the indicator would be right to
    // say so.
    const path = testInfo.outputPath(`${projectName}.mvm`)
    await download.saveAs(path)
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    expect(saved.format).toBe('metroidvania-map-maker')
    expect(saved.project.name).toBe(projectName)
    expect(saved.project.maps.length).toBeGreaterThan(0)

    // The indicator names the file once there is one.
    await expect(page.locator('.project-file')).toHaveText(`${projectName}.mvm`)

    // Something else, so the reopen has to actually replace it.
    await renameProject(page, 'Overwritten')
    await expect(page.locator('.project-title-button')).toHaveText('Overwritten •')

    // The same bytes back in through a real file input.
    const chooser = page.waitForEvent('filechooser')
    await pickFileItem(page, 'Open…')
    await page.getByRole('button', { name: "Don't Save", exact: true }).click()
    await (await chooser).setFiles(path)

    await expect(page.locator('.project-title-button')).toHaveText(projectName)
    await expect(page.locator('.project-file')).toHaveText(`${projectName}.mvm`)
  })

  test('refuses a file that is not a project, and keeps the current one', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== DOWNLOAD_ONLY, 'needs the download provider')
    await openApp(page)
    await renameProject(page, 'Keep Me')

    const chooser = page.waitForEvent('filechooser')
    await pickFileItem(page, 'Open…')
    // Dirty, so the guard asks first. Discarding gets past it, which makes
    // what follows a test of the load failing rather than of the guard.
    await page.getByRole('button', { name: "Don't Save", exact: true }).click()
    await (
      await chooser
    ).setFiles({
      name: 'not-a-project.mvm',
      mimeType: 'application/x-mvm+json',
      buffer: Buffer.from('{"format":"something else"}'),
    })

    await expect(page.getByText('Could not open that file')).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    // The project that was already open is untouched, dirty marker and all.
    await expect(page.locator('.project-title-button')).toHaveText('Keep Me •')
  })

  test('asks before replacing unsaved work, and cancelling keeps it', async ({ page }) => {
    await openApp(page)
    await renameProject(page, 'Work In Progress')
    await expect(page.locator('.project-title-button')).toHaveText('Work In Progress •')

    await pickFileItem(page, 'New')
    await expect(page.getByText('Save changes to Work In Progress?')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    await expect(page.locator('.project-title-button')).toHaveText('Work In Progress •')
  })

  // The path that had no coverage and was broken: Save inside the guard has to
  // actually write before the replacement goes ahead. Reka's own Action button
  // closed the dialog before running its handler, so the dismissal was
  // answered first and Save behaved as Cancel.
  test('saving from the guard writes the file and then replaces the project', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== DOWNLOAD_ONLY, 'needs the download provider')
    await openApp(page)
    await renameProject(page, 'Rescue Me')

    const downloadPromise = page.waitForEvent('download')
    await pickFileItem(page, 'New')
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    // The save really happened, under the name that was on screen.
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('Rescue Me.mvm')

    // ...and only then did the replacement go ahead.
    await expect(page.locator('.project-title-button')).toHaveText('Untitled Project')
  })

  test('discarding replaces the project and clears the marker', async ({ page }) => {
    await openApp(page)
    await renameProject(page, 'Throwaway')

    await pickFileItem(page, 'New')
    await page.getByRole('button', { name: "Don't Save", exact: true }).click()

    await expect(page.locator('.project-title-button')).toHaveText('Untitled Project')
    await expect(page.getByText('Not saved to a file')).toBeVisible()
  })

  test('a clean project is replaced without being asked about', async ({ page }) => {
    await openApp(page)
    await pickFileItem(page, 'New')
    await expect(page.getByText('Save changes to')).toBeHidden()
    await expect(page.locator('.project-title-button')).toHaveText('Untitled Project')
  })
})
