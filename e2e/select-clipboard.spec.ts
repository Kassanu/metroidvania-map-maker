import { test, expect } from '@playwright/test'
import { openApp, gridMapping, undoLabel } from './support/canvas'

// The clipboard through the real keys, where the browser is the thing under
// test: Ctrl+C, Ctrl+X, Ctrl+V and Ctrl+D are all bound by the browser or the
// OS as well, and what jsdom cannot show is that the app gets them at all.

const IN_A_ROOM = { x: 1.5, y: 0.5 }
const BARE_GRID = { x: 9.5, y: 3.5 }

test.describe('Select mode clipboard', () => {
  test('copies a room and pastes it under the pointer', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)

    const room = grid.at(IN_A_ROOM.x, IN_A_ROOM.y)
    await page.mouse.click(room.x, room.y)
    await page.keyboard.press('ControlOrMeta+c')
    expect(await undoLabel(page)).not.toBe('Undo Paste')

    // The pointer decides where it lands, so it has to be somewhere before the
    // key: reading the menu above moved it away.
    const bare = grid.at(BARE_GRID.x, BARE_GRID.y)
    await page.mouse.move(bare.x, bare.y)
    await page.keyboard.press('ControlOrMeta+v')

    expect(await undoLabel(page)).toBe('Undo Paste')
    expect(errors).toEqual([])
  })

  test('cuts in one step and pastes what it took', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)

    const room = grid.at(IN_A_ROOM.x, IN_A_ROOM.y)
    await page.mouse.click(room.x, room.y)
    await page.keyboard.press('ControlOrMeta+x')
    expect(await undoLabel(page)).toBe('Undo Cut')

    const bare = grid.at(BARE_GRID.x, BARE_GRID.y)
    await page.mouse.move(bare.x, bare.y)
    await page.keyboard.press('ControlOrMeta+v')
    expect(await undoLabel(page)).toBe('Undo Paste')

    // What was pasted is selected, so Delete acts on it without another click.
    await page.keyboard.press('Delete')
    expect(await undoLabel(page)).toBe('Undo Delete Room')
    expect(errors).toEqual([])
  })

  test('duplicates with Ctrl+D, clear of the original', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)

    const room = grid.at(IN_A_ROOM.x, IN_A_ROOM.y)
    await page.mouse.click(room.x, room.y)
    await page.keyboard.press('ControlOrMeta+d')

    expect(await undoLabel(page)).toBe('Undo Duplicate')
    expect(errors).toEqual([])
  })

  // The menu items run the same action ids the keys do, so they are live now
  // that the handlers exist.
  test('offers the clipboard verbs in the context menu once a room is selected', async ({
    page,
  }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)

    const room = grid.at(IN_A_ROOM.x, IN_A_ROOM.y)
    await page.mouse.click(room.x, room.y, { button: 'right' })

    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: 'Copy' })).toBeEnabled()
    await menu.getByRole('menuitem', { name: 'Duplicate' }).click()

    expect(await undoLabel(page)).toBe('Undo Duplicate')
    expect(errors).toEqual([])
  })

  // The same four keys one granularity over, reaching different ops. The undo
  // entry is where the difference is readable outside the canvas.
  test('cuts and pastes a cell fragment', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    await page
      .getByRole('radiogroup', { name: 'Select' })
      .getByRole('radio', { name: 'Cells' })
      .click()
    const grid = await gridMapping(page)

    const cell = grid.at(IN_A_ROOM.x, IN_A_ROOM.y)
    await page.mouse.click(cell.x, cell.y)
    await page.keyboard.press('ControlOrMeta+x')
    expect(await undoLabel(page)).toBe('Undo Cut')

    const bare = grid.at(BARE_GRID.x, BARE_GRID.y)
    await page.mouse.move(bare.x, bare.y)
    await page.keyboard.press('ControlOrMeta+v')
    expect(await undoLabel(page)).toBe('Undo Paste')
    expect(errors).toEqual([])
  })

  // Two granularities, one key, two ops, and the undo entry says which ran.
  test('Delete erases cells where it deletes rooms', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)
    const granularity = page.getByRole('radiogroup', { name: 'Select' })

    const at = grid.at(IN_A_ROOM.x, IN_A_ROOM.y)
    await page.mouse.click(at.x, at.y)
    await page.keyboard.press('Delete')
    expect(await undoLabel(page)).toBe('Undo Delete Room')
    await page.keyboard.press('ControlOrMeta+z')

    await granularity.getByRole('radio', { name: 'Cells' }).click()
    await page.mouse.click(at.x, at.y)
    await page.keyboard.press('Delete')
    expect(await undoLabel(page)).toBe('Undo Erase Cells')
    expect(errors).toEqual([])
  })
})
