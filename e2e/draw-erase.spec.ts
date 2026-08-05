import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// What jsdom structurally cannot reach here: a real secondary button. jsdom
// will happily dispatch a synthetic PointerEvent with button 2 and never fire
// a contextmenu, never involve pointer capture, and never let the browser's
// own menu interrupt the drag: the one failure mode right-drag erase actually
// has.

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

// The canvas has no DOM to assert against, so the undo stack is the observable:
// the Edit menu names the step that would be reverted, which is what a single
// labelled transaction per gesture looks like from the user's side.
async function undoLabel(page: Page) {
  await page.getByRole('button', { name: 'Edit' }).click()
  const label = await page.getByRole('menuitem').first().textContent()
  await page.keyboard.press('Escape')
  return label?.trim()
}

// A point inside the canvas viewport, offset from its top-left.
async function canvasPoint(page: Page, dx: number, dy: number) {
  const box = await page.locator('.canvas-viewport').boundingBox()
  if (!box) throw new Error('no canvas viewport')
  return { x: box.x + dx, y: box.y + dy }
}

test.describe('Draw mode erase', () => {
  test('right-drag erases, and the browser menu does not interrupt it', async ({ page }) => {
    const { errors } = await openApp(page)

    const from = await canvasPoint(page, 200, 200)
    const to = await canvasPoint(page, 320, 260)

    // Paint something to erase, with the primary button.
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.up()
    expect(await undoLabel(page)).toBe('Undo Paint')

    // Watch the real contextmenu event the browser raises for a right-press.
    // Headless Chromium never draws the menu, so asserting the drag survived
    // proves nothing on its own: the suppression has to be observed directly,
    // and this is the assertion that fails if the handler is removed.
    const menu = await page.evaluate(() => {
      const state = { fired: false, prevented: false }
      const w = window as unknown as { __menu: typeof state }
      w.__menu = state
      document.addEventListener('contextmenu', (event) => {
        state.fired = true
        state.prevented = event.defaultPrevented
      })
      return true
    })
    expect(menu).toBe(true)

    // Now the same swath with the secondary button.
    await page.mouse.move(from.x, from.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.up({ button: 'right' })

    expect(await undoLabel(page)).toBe('Undo Erase')

    const state = await page.evaluate(
      () => (window as unknown as { __menu: { fired: boolean; prevented: boolean } }).__menu,
    )
    expect(state.fired).toBe(true)
    expect(state.prevented).toBe(true)
    expect(errors).toEqual([])
  })

  test('the erase toggle makes the primary button erase', async ({ page }) => {
    const { errors } = await openApp(page)

    const point = await canvasPoint(page, 240, 220)
    await page.mouse.click(point.x, point.y)
    expect(await undoLabel(page)).toBe('Undo Paint')

    const toggle = page.getByRole('button', { name: 'Erase' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    await page.mouse.click(point.x, point.y)
    expect(await undoLabel(page)).toBe('Undo Erase')

    // It is an input modifier, not a mode: turning it off paints again.
    await toggle.click()
    await page.mouse.click(point.x, point.y)
    expect(await undoLabel(page)).toBe('Undo Paint')
    expect(errors).toEqual([])
  })

  test('Esc abandons an erase mid-drag, restoring what it had removed', async ({ page }) => {
    const { errors } = await openApp(page)

    const from = await canvasPoint(page, 200, 200)
    const to = await canvasPoint(page, 320, 260)

    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.up()
    expect(await undoLabel(page)).toBe('Undo Paint')

    await page.mouse.move(from.x, from.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.keyboard.press('Escape')
    await page.mouse.up({ button: 'right' })

    // Nothing committed: the paint is still the newest step.
    expect(await undoLabel(page)).toBe('Undo Paint')
    expect(errors).toEqual([])
  })
})
