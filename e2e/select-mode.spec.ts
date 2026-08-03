import { test, expect } from '@playwright/test'
import { openApp, gridMapping, undoLabel } from './support/canvas'

// Select mode's shell in a real browser: the toolbar it grew, and the cursor,
// which is the only part of the resolver a user can see before they commit to a
// press.

// Inside the dev seed's first room, and bare grid well clear of every room.
const IN_A_ROOM = { x: 1.5, y: 0.5 }
const BARE_GRID = { x: 9.5, y: 3.5 }

test.describe('Select mode', () => {
  test('offers rooms and cells, with cells not yet pickable', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')

    const granularity = page.getByRole('radiogroup', { name: 'Select' })
    await expect(granularity.getByRole('radio', { name: 'Rooms' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(granularity.getByRole('radio', { name: 'Cells' })).toBeDisabled()
    expect(errors).toEqual([])
  })

  test('points at what a click would select, and says nothing over bare grid', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)
    const viewport = page.locator('.canvas-viewport')

    const room = grid.at(IN_A_ROOM.x, IN_A_ROOM.y)
    await page.mouse.move(room.x, room.y)
    await expect(viewport).toHaveCSS('cursor', 'pointer')

    const bare = grid.at(BARE_GRID.x, BARE_GRID.y)
    await page.mouse.move(bare.x, bare.y)
    await expect(viewport).toHaveCSS('cursor', 'auto')
    expect(errors).toEqual([])
  })

  // The one part of `Ctrl+A` a browser decides: the combo is the browser's own
  // select-all, so what has to hold here is that the app claims it and the page
  // text stays unselected. What it selected is read back through `Del`, since a
  // selection has no DOM of its own.
  test('claims Ctrl+A from the browser and selects the rooms', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')

    await page.keyboard.press('ControlOrMeta+a')
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')

    await page.keyboard.press('Delete')
    expect(await undoLabel(page)).toBe('Undo Delete Room')
    expect(errors).toEqual([])
  })

  // A marquee always leaves the element it started on, and the pointer only
  // keeps reporting because the drag captures at press. Without capture the
  // moves stop at the first boundary and no band is ever drawn, which is the
  // one thing about this gesture jsdom cannot show. The band is swept up and
  // out over the ruler strip, and what it caught is read back through `Del`.
  test('sweeps rooms with a band that leaves the canvas', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)
    const viewport = await page.locator('.canvas-viewport').boundingBox()
    if (!viewport) throw new Error('no canvas viewport')

    const start = grid.at(BARE_GRID.x, BARE_GRID.y)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x - 40, start.y - 40)
    // Past the top edge, onto the ruler: a different element from the one the
    // press landed on.
    await page.mouse.move(grid.at(IN_A_ROOM.x, IN_A_ROOM.y).x, viewport.y - 20)
    await page.mouse.up()

    await page.keyboard.press('Delete')
    expect(await undoLabel(page)).toBe('Undo Delete Room')
    expect(errors).toEqual([])
  })
})
