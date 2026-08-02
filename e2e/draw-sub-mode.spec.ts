import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { openApp, undoLabel, gridMapping } from './support/canvas'

// The lock is a filter over the precedence table, so what needs proving in a
// real browser is that the same drag produces a different row depending on
// which lock is set, driven from the real toolbar rather than from the store.

// The fixture's "Corridor" room is a 2x2 at (3,0), (4,0), (3,1), (4,1), so its
// east face is a run of two and carries a handle.
const EAST_WALL = { x: 5, y: 0.5 }
const MIDDLE = { x: 3.5, y: 0.5 }

async function lock(page: Page, name: string) {
  await page.getByRole('radiogroup', { name: 'Lock' }).getByRole('radio', { name }).click()
}

test.describe('Draw mode sub-mode lock', () => {
  test('Auto resizes the run where Cells grows one cell', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const wall = grid.at(EAST_WALL.x, EAST_WALL.y)

    const dragOut = async () => {
      await page.mouse.move(wall.x - 2, wall.y)
      await page.mouse.down()
      await page.mouse.move(wall.x + grid.cellPx, wall.y, { steps: 8 })
      await page.mouse.up()
    }

    await dragOut()
    expect(await undoLabel(page)).toBe('Undo Resize Room')

    // Put the room back first: without this, the second drag starts from a
    // room one cell wider, so `wall` is in its interior and painting there
    // changes nothing, and the test would report the first drag's label
    // because the second commits an empty transaction.
    await page.keyboard.press('Control+z')

    // Edge-runs grow instead of resizing under the Cells lock, so the
    // identical drag now paints.
    await lock(page, 'Cells')
    await dragOut()
    expect(await undoLabel(page)).toBe('Undo Paint')
    expect(errors).toEqual([])
  })

  // Under Resize-only, only the edge-run row is live; other presses just set
  // the active room.
  test('Resize-only leaves a drag through the room alone', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await lock(page, 'Resize')

    const from = grid.at(MIDDLE.x, MIDDLE.y)
    const before = await undoLabel(page)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + grid.cellPx * 4, from.y, { steps: 10 })
    await page.mouse.up()
    expect(await undoLabel(page)).toBe(before)

    // The edge-run row is still live, so the lock is a filter and not an off
    // switch.
    const wall = grid.at(EAST_WALL.x, EAST_WALL.y)
    await page.mouse.move(wall.x - 2, wall.y)
    await page.mouse.down()
    await page.mouse.move(wall.x + grid.cellPx, wall.y, { steps: 8 })
    await page.mouse.up()
    expect(await undoLabel(page)).toBe('Undo Resize Room')
    expect(errors).toEqual([])
  })

  // The Landing Site is a 3x3 at (0,0)-(2,2), so (1,1) and (2,1) are interior
  // vertices with a drawable edge between them.
  test('Vertex-only draws walls and nothing else', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await lock(page, 'Vertex')

    const before = await undoLabel(page)
    // A drag across empty grid creates no room.
    const empty = grid.at(10.5, 6.5)
    await page.mouse.move(empty.x, empty.y)
    await page.mouse.down()
    await page.mouse.move(empty.x + grid.cellPx * 3, empty.y, { steps: 8 })
    await page.mouse.up()
    expect(await undoLabel(page)).toBe(before)

    const from = grid.at(1, 1)
    const to = grid.at(2, 1)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up()
    expect(await undoLabel(page)).toBe('Undo Draw Inner Wall')
    expect(errors).toEqual([])
  })

  // The cursor is the visible half of the filter, and the one thing that tells
  // a desktop user the lock took effect before they commit to a drag.
  test('the resize cursor goes away under Cells-only', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const viewport = page.locator('.canvas-viewport')
    const wall = grid.at(EAST_WALL.x, EAST_WALL.y)

    await page.mouse.move(wall.x - 2, wall.y)
    await expect(viewport).toHaveCSS('cursor', 'ew-resize')

    await lock(page, 'Cells')
    await page.mouse.move(wall.x - 2, wall.y)
    await expect(viewport).toHaveCSS('cursor', 'auto')

    await lock(page, 'Auto')
    await page.mouse.move(wall.x - 2, wall.y)
    await expect(viewport).toHaveCSS('cursor', 'ew-resize')
    expect(errors).toEqual([])
  })
})
