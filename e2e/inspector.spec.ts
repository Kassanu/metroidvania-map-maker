import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { openApp, gridMapping, undoLabel, type GridMapping } from './support/canvas'

// The Inspector in a real browser: that it is mounted in the right sidebar,
// that a canvas selection reaches it, and that a field commits back through
// the same undo stack every other edit uses.
//
// The seam this covers is the one jsdom cannot: the panel and the canvas are
// wired together only in the assembled app.

// Inside the dev seed's first room, and bare grid well clear of every room.
const IN_A_ROOM = { x: 1.5, y: 0.5 }
const BARE_GRID = { x: 9.5, y: 3.5 }

async function clickAt(page: Page, grid: GridMapping, world: { x: number; y: number }) {
  const point = grid.at(world.x, world.y)
  await page.mouse.click(point.x, point.y)
}

test.describe('Inspector', () => {
  test('shows nothing until something is selected, then the room', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const inspector = page.locator('[data-panel-id="inspector"]')

    await expect(inspector).toBeVisible()
    await expect(inspector.locator('input')).toHaveCount(0)

    await page.keyboard.press('2')
    await clickAt(page, grid, IN_A_ROOM)

    await expect(inspector.getByLabel('Name', { exact: true })).toBeVisible()
    await expect(inspector.getByLabel('Area', { exact: true })).toHaveValue(/.+/)

    await clickAt(page, grid, BARE_GRID)
    await expect(inspector.locator('input')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('renames the selected room, as one undo step', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const inspector = page.locator('[data-panel-id="inspector"]')

    await page.keyboard.press('2')
    await clickAt(page, grid, IN_A_ROOM)

    // Deliberately not a name the dev fixture already uses: committing a
    // field to the value it already holds is a no-op, which would make this
    // pass whether or not the commit path works.
    const name = inspector.getByLabel('Name', { exact: true })
    const original = await name.inputValue()
    await name.fill('Wrecked Ship')
    await name.press('Enter')

    expect(await undoLabel(page)).toBe('Undo Rename Room')
    await page.keyboard.press('Control+z')
    await expect(name).toHaveValue(original)
    expect(errors).toEqual([])
  })

  test('counts a multi-selection instead of showing fields', async ({ page }) => {
    const { errors } = await openApp(page)
    const inspector = page.locator('[data-panel-id="inspector"]')

    await page.keyboard.press('2')
    await page.keyboard.press('Control+a')

    await expect(inspector.getByText(/\d+ selected/)).toBeVisible()
    await expect(inspector.locator('input')).toHaveCount(0)
    expect(errors).toEqual([])
  })
})
