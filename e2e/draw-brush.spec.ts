import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

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

async function canvasPoint(page: Page, dx: number, dy: number) {
  const box = await page.locator('.canvas-viewport').boundingBox()
  if (!box) throw new Error('no canvas viewport')
  return { x: box.x + dx, y: box.y + dy }
}

test.describe('Draw mode brush', () => {
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

    const point = await canvasPoint(page, 260, 220)
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
