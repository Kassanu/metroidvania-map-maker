import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { openApp } from './support/canvas'

// The serializer, the write path and the dialog, driven together in a real
// browser. Nothing below reads a store: it clicks the menu, ticks boxes, and
// judges the file that lands.
//
// Firefox only, for the same reason the save specs are: Playwright cannot
// drive an OS file picker, so File System Access is checked by hand and the
// download provider is the half that can be driven end to end. It is also the
// engine the single-zip rule exists for.

const DOWNLOAD_ONLY = 'firefox'

async function openExportDialog(page: Page) {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  // Not an exact match: the submenu marker is a CSS `::after`, and Chromium
  // folds generated content into the accessible name, so the item answers to
  // "Export \u25b8" there and to "Export" elsewhere.
  await page.getByRole('menuitem', { name: 'Export' }).click()
  await page.getByRole('menuitem', { name: 'JSON…', exact: true }).click()
  await expect(page.getByRole('tree')).toBeVisible()
}

async function download(page: Page, testInfo: { outputPath: (name: string) => string }) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const file = await pending
  const path = testInfo.outputPath(file.suggestedFilename())
  await file.saveAs(path)
  return { name: file.suggestedFilename(), path }
}

test.describe('exporting', () => {
  // The dialog is open for a decision and closes once the decision is spent,
  // so what confirms the write is the message rather than the dialog.
  test('closes and says so once the bytes have landed', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DOWNLOAD_ONLY, 'needs the download provider')
    await openApp(page)

    await openExportDialog(page)
    await download(page, testInfo)

    // The dialog itself, not its tree: the Hierarchy panel is a tree too, and
    // it is still on screen once this one has gone.
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.locator('.toast.toast-success')).toHaveCount(1)
  })

  test('writes one JSON file holding the rooms that were ticked', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DOWNLOAD_ONLY, 'needs the download provider')
    await openApp(page)
    const projectName = await page.locator('.project-title-button').innerText()

    await openExportDialog(page)
    const file = await download(page, testInfo)

    expect(file.name).toBe(`${projectName}.json`)
    const exported = JSON.parse(readFileSync(file.path, 'utf8'))
    expect(exported.formatVersion).toBe(1)
    expect(exported.project.name).toBe(projectName)
    expect(exported.tabs.length).toBeGreaterThan(0)

    // Every convention the format promises to have resolved already: the area
    // inlined whole, the outline materialized, and coordinates left absolute.
    const room = exported.tabs[0].rooms[0]
    expect(room.area).toHaveProperty('cellColor')
    expect(room.cells.length).toBeGreaterThan(0)
    expect(room.walls.some((wall: { boundary: string }) => wall.boundary === 'outer')).toBe(true)
    expect(room.bounds.size[0]).toBeGreaterThan(0)
  })

  test('writes one zip per-room, which a real unzip can read', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DOWNLOAD_ONLY, 'needs the download provider')
    await openApp(page)
    const projectName = await page.locator('.project-title-button').innerText()

    await openExportDialog(page)
    await page.getByRole('radio', { name: 'One file per room' }).click()
    const file = await download(page, testInfo)

    // One artefact, whatever the engine can do: the whole reason per-room
    // packaging is zipped rather than downloaded room by room.
    expect(file.name).toBe(`${projectName}.zip`)

    // Judged by a tool that did not write it.
    const listing = execFileSync('python3', [
      '-c',
      `import zipfile,json,sys
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
names = z.namelist()
first = json.loads(z.read(names[0]))
print(json.dumps({'count': len(names), 'names': names, 'room': first['room']['id'], 'tab': first['tab']['id']}))`,
      file.path,
    ])
    const archive = JSON.parse(listing.toString()) as {
      count: number
      names: string[]
      room: string
      tab: string
    }

    expect(archive.count).toBeGreaterThan(0)
    // `<slug>--<room-id>.json`, or the id alone where the name slugs to
    // nothing. Every entry is one or the other.
    for (const name of archive.names) {
      expect(name).toMatch(/^([\p{L}\p{N}-]+--)?room_[0-9a-z]+\.json$/u)
    }
    expect(archive.names[0]).toContain(archive.room)
  })

  // The guard is on the entrance rather than inside the dialog, so it is read
  // from the menu without opening anything. Both engines: nothing about it is
  // download-provider work.
  test('says why from the menu when the project has nothing to export', async ({ page }) => {
    // Blank rather than a sample, which is the only state the guard is about.
    await page.goto('/')
    await page.getByRole('button', { name: 'Get started' }).click()

    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Export' }).click()

    const json = page.getByRole('menuitem', { name: 'JSON…', exact: true })
    await expect(json).toHaveAttribute('data-disabled', '')
    await expect(json).toHaveAttribute('title', 'Nothing to export: this project has no rooms.')

    await json.click({ force: true })
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('refuses to write an empty file when nothing is ticked', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DOWNLOAD_ONLY, 'needs the download provider')
    await openApp(page)
    await openExportDialog(page)

    for (const box of await page.getByRole('treeitem').getByRole('checkbox').all()) {
      if ((await box.getAttribute('aria-checked')) !== 'false') await box.click()
    }

    await expect(page.getByText('Nothing selected')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
  })
})
