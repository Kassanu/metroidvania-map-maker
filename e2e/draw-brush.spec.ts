import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { gridMapping } from './support/canvas'

// jsdom can dispatch a keydown, but it cannot tell you that `[` and `]` survive
// the real keyboard path: the hotkey dispatcher's text-field suppression, the
// browser's own bindings, and Firefox's habit of claiming punctuation keys.

async function openApp(page: Page) {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))

  await page.goto('/?sample=one-of-everything')
  await page.getByRole('button', { name: 'Get started' }).click()
  return { errors }
}

test.describe('Room Mode brush', () => {
  test('[ and ] resize the brush through the real keyboard', async ({ page }) => {
    const { errors } = await openApp(page)
    const size = page.locator('.brush-size')

    await expect(size).toHaveText('1×1')

    await page.keyboard.press(']')
    await page.keyboard.press(']')
    await expect(size).toHaveText('3×3')

    await page.keyboard.press('[')
    await expect(size).toHaveText('2×2')

    // Floors rather than wrapping or going negative.
    for (let i = 0; i < 5; i++) await page.keyboard.press('[')
    await expect(size).toHaveText('1×1')

    expect(errors).toEqual([])
  })

  // Shortcuts are suppressed while a text field is focused, so `[` typed into a
  // rename box is a bracket and not a brush change.
  test('does not resize while a text field has focus', async ({ page }) => {
    await openApp(page)

    await page.locator('.project-title-button').click()
    await page.keyboard.press(']')
    await page.keyboard.press('Escape')

    await expect(page.locator('.brush-size')).toHaveText('1×1')
  })

  test('paints a footprint wider than one cell, as one undo step', async ({ page }) => {
    const { errors } = await openApp(page)

    await page.keyboard.press(']')
    await page.keyboard.press(']')
    await expect(page.locator('.brush-size')).toHaveText('3×3')

    // A cell, not a pixel offset: where the camera opens is a property of the
    // map, so a fixed offset lands on whatever happens to be under it. Column
    // 10 is clear of `one-of-everything`, whose content stops at column 6, so
    // the whole 3x3 footprint has somewhere to go.
    const grid = await gridMapping(page)
    const point = grid.at(10.5, 5.5)
    await page.mouse.click(point.x, point.y)

    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page.getByRole('menuitem').first()).toHaveText('Undo Paint')
    await page.keyboard.press('Escape')

    expect(errors).toEqual([])
  })

  test('the toolbar stepper and the hotkeys drive the same size', async ({ page }) => {
    await openApp(page)
    const size = page.locator('.brush-size')

    await page.getByTitle('Larger brush (])').click()
    await expect(size).toHaveText('2×2')

    await page.keyboard.press(']')
    await expect(size).toHaveText('3×3')

    await page.getByTitle('Smaller brush ([)').click()
    await expect(size).toHaveText('2×2')
  })
})
