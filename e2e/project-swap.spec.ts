import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { join } from 'node:path'
import { openApp } from './support/canvas'

// Opening one real project over another, through the real file input.
//
// The unit suite proves the stores reset. This proves the chrome does: the tab
// bar, the title, the hierarchy and the area picker all describe the project
// that is actually loaded, and none of them still shows something from the one
// before it. The samples are built to share no names, so anything left over is
// visible rather than subtle.
//
// Firefox only, because it is the engine whose picker Playwright can drive.

const SAMPLES = join(import.meta.dirname, '..', 'samples')

async function openSample(page: Page, file: string, discard = false) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Open…', exact: true }).click()
  if (discard) await page.getByRole('button', { name: "Don't Save", exact: true }).click()
  await (await chooser).setFiles(join(SAMPLES, file))
  await expect(page.locator('.project-file')).toHaveText(file)
}

test.describe('opening one project over another', () => {
  test.skip(({ browserName }) => browserName !== 'firefox', 'needs a drivable picker')

  test('replaces the tabs, the title and the file', async ({ page }) => {
    await openApp(page)

    await openSample(page, 'one-of-everything.mvm')
    await expect(page.locator('.project-title-button')).toHaveText('One Of Everything')
    await expect(page.locator('.tab')).toHaveText(['Surface', 'Caves'])

    await openSample(page, 'sunken-city.mvm')
    await expect(page.locator('.project-title-button')).toHaveText('Sunken City')
    await expect(page.locator('.tab')).toHaveText(['Harbour', 'The Depths', 'Vault'])

    // Nothing from the project before it is still on screen.
    await expect(page.getByText('Surface', { exact: true })).toBeHidden()
    await expect(page.getByText('Caves', { exact: true })).toBeHidden()
  })

  test('leaves no areas from the project that was replaced', async ({ page }) => {
    await openApp(page)

    // Both surfaces that list areas: the tree, and the Draw toolbar's picker.
    // The picker is the one that matters most, because an `AreaId` left in it
    // is what a later paint would write into a room.
    const treeLabels = page.getByLabel('Areas and rooms').locator('.hierarchy-label')
    const areaOptions = page.getByLabel('Area', { exact: true }).locator('option')

    await openSample(page, 'sunken-city.mvm')
    await expect(treeLabels.filter({ hasText: 'Drowned Quarter' })).toHaveCount(1)
    await expect(areaOptions.filter({ hasText: 'Drowned Quarter' })).toHaveCount(1)
    await expect(areaOptions.filter({ hasText: 'Spires' })).toHaveCount(1)

    // One Room has World and nothing else, so every area from the last project
    // has to be gone from both rather than merely scrolled out of view.
    await openSample(page, 'one-room.mvm')
    await expect(treeLabels.filter({ hasText: 'Drowned Quarter' })).toHaveCount(0)
    await expect(areaOptions.filter({ hasText: 'Drowned Quarter' })).toHaveCount(0)
    await expect(areaOptions.filter({ hasText: 'Spires' })).toHaveCount(0)
    await expect(areaOptions).toHaveText(['World'])
    await expect(page.locator('.tab')).toHaveText(['Map 1'])
  })

  test('opens the same project repeatedly without accumulating anything', async ({ page }) => {
    await openApp(page)

    for (let i = 0; i < 3; i++) {
      await openSample(page, 'sunken-city.mvm')
      await expect(page.locator('.tab')).toHaveText(['Harbour', 'The Depths', 'Vault'])
      await expect(page.locator('.project-title-button')).toHaveText('Sunken City')
    }
  })

  test('starts each load with an empty undo stack', async ({ page }) => {
    await openApp(page)
    await openSample(page, 'sunken-city.mvm')

    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    // A bare "Undo" with no step named after it is an empty stack; a project
    // carried over from the last load would name its last edit here.
    await expect(page.getByRole('menuitem', { name: 'Undo', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
  })
})
