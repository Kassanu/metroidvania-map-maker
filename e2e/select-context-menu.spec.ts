import { test, expect } from '@playwright/test'
import { openApp, gridMapping, undoLabel } from './support/canvas'

// The canvas context menu in a real browser. What only a browser shows here is
// that the app's menu replaces the native one rather than fighting it: the
// trigger stands down if the event was already prevented, and jsdom cannot show
// a native menu either appearing or not.

const IN_A_ROOM = { x: 1.5, y: 0.5 }
const BARE_GRID = { x: 9.5, y: 3.5 }

test.describe('Select mode context menu', () => {
  test('right-click opens the four verbs on a room, and selects it first', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)

    const room = grid.at(IN_A_ROOM.x, IN_A_ROOM.y)
    await page.mouse.click(room.x, room.y, { button: 'right' })

    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem')).toHaveText(['Cut', 'Copy', 'Duplicate', 'Delete'])

    // Nothing was selected before the right-click, so every item being live is
    // what says the press selected the room under it.
    await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeEnabled()
    await expect(menu.getByRole('menuitem', { name: 'Copy' })).toBeEnabled()

    await menu.getByRole('menuitem', { name: 'Delete' }).click()
    expect(await undoLabel(page)).toBe('Undo Delete Room')
    expect(errors).toEqual([])
  })

  test('right-click on bare grid opens the menu with nothing to act on', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)

    const bare = grid.at(BARE_GRID.x, BARE_GRID.y)
    await page.mouse.click(bare.x, bare.y, { button: 'right' })

    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeDisabled()
    expect(errors).toEqual([])
  })

  // Two listeners answer one Escape: the menu's own layer closes it, and the
  // global dispatcher finds the dialog tier claimed and stops there. jsdom can
  // show neither half, because the menu's half is the library's keydown
  // handling and the tier's half only matters when both fire on one key.
  test('Escape closes the menu before it reaches the selection', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)

    const room = grid.at(IN_A_ROOM.x, IN_A_ROOM.y)
    await page.mouse.click(room.x, room.y, { button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    // Read back over bare grid, which changes no selection: Delete being live
    // says the room is still selected, so that Escape stopped at the menu.
    const bare = grid.at(BARE_GRID.x, BARE_GRID.y)
    await page.mouse.click(bare.x, bare.y, { button: 'right' })
    await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeEnabled()

    // One Escape for the menu, then a second for the selection under it. The
    // tier is only released when the menu has actually gone, so these cannot
    // both land on one press.
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    await page.mouse.click(bare.x, bare.y, { button: 'right' })
    await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeDisabled()
    expect(errors).toEqual([])
  })

  // The other three modes spend that button on erase, so the menu must not
  // appear over a delete that already happened.
  test('right-click still erases in Draw mode instead of opening a menu', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('1')
    const grid = await gridMapping(page)

    const room = grid.at(IN_A_ROOM.x, IN_A_ROOM.y)
    await page.mouse.click(room.x, room.y, { button: 'right' })

    await expect(page.getByRole('menu')).toHaveCount(0)
    expect(await undoLabel(page)).toBe('Undo Erase')
    expect(errors).toEqual([])
  })
})
