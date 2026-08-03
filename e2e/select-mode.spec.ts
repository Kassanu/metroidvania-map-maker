import { test, expect } from '@playwright/test'
import { openApp, gridMapping } from './support/canvas'

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
})
