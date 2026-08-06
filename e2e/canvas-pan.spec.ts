// Panning the canvas with a mouse, in a real browser.
//
// The unit tests own the arithmetic; what only a real engine can answer is
// whether the browser's own middle-button behaviour actually stood down. jsdom
// has no autoscroll widget to suppress, so a passing unit test there says
// nothing about Chromium on Linux.
//
// Position is read through the coords overlay, the way every canvas spec here
// does: the cell under a fixed screen point is the observable, and it moves by
// exactly what the drag travelled.

import { test, expect } from '@playwright/test'
import { openApp, cellAt, gridMapping, undoLabel } from './support/canvas'

const MIDDLE = 'middle'

test.describe('canvas pan', () => {
  test('a middle-drag carries the map with the pointer', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)

    const probe = grid.at(4.5, 4.5)
    const before = await cellAt(page, probe.x, probe.y)

    // Two cells right and one down, so the cell under the probe must move by
    // the same amount in the opposite direction.
    await page.mouse.move(probe.x, probe.y)
    await page.mouse.down({ button: MIDDLE })
    await page.mouse.move(probe.x + grid.cellPx * 2, probe.y + grid.cellPx, { steps: 8 })
    await page.mouse.up({ button: MIDDLE })

    const after = await cellAt(page, probe.x, probe.y)
    expect(after.col).toBe(before.col - 2)
    expect(after.row).toBe(before.row - 1)
    expect(errors).toEqual([])
  })

  // The point grabbed stays under the pointer, which is the rule the sign
  // falls out of. Read at the pointer's own new position rather than at a
  // fixed one.
  test('the cell grabbed stays under the pointer', async ({ page }) => {
    await openApp(page)
    const grid = await gridMapping(page)

    const from = grid.at(6.5, 5.5)
    const grabbed = await cellAt(page, from.x, from.y)

    await page.mouse.move(from.x, from.y)
    await page.mouse.down({ button: MIDDLE })
    const to = { x: from.x - grid.cellPx * 3, y: from.y + grid.cellPx * 2 }
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up({ button: MIDDLE })

    expect(await cellAt(page, to.x, to.y)).toEqual(grabbed)
  })

  // Chromium's autoscroll widget would swallow the pointermoves and leave the
  // camera where it started, so a pan that lands is itself the evidence the
  // default stood down. The console check is what catches it failing loudly.
  test('the browser does not take the middle button for itself', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const probe = grid.at(4.5, 4.5)

    await page.mouse.move(probe.x, probe.y)
    await page.mouse.down({ button: MIDDLE })
    await page.mouse.move(probe.x + grid.cellPx * 2, probe.y, { steps: 4 })
    await page.mouse.up({ button: MIDDLE })

    // A live autoscroll leaves the page scrolling on its own, so the reading
    // taken twice would differ. It must be settled.
    const settled = await cellAt(page, probe.x, probe.y)
    await page.waitForTimeout(250)
    expect(await cellAt(page, probe.x, probe.y)).toEqual(settled)
    expect(errors).toEqual([])
  })

  // Space is the half that only a real browser can judge: focus is real here,
  // and so is the page scrolling that an unclaimed Space would cause.
  test('holding Space pans with the primary button', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const probe = grid.at(4.5, 4.5)

    // The canvas has to own the keyboard first, which a press is what gives it.
    // Pressed in Select mode (key 2) so the press itself draws nothing.
    await page.keyboard.press('2')
    await page.mouse.click(probe.x, probe.y)

    const before = await cellAt(page, probe.x, probe.y)

    await page.keyboard.down(' ')
    await page.mouse.move(probe.x, probe.y)
    await page.mouse.down()
    await page.mouse.move(probe.x + grid.cellPx * 2, probe.y, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.up(' ')

    expect((await cellAt(page, probe.x, probe.y)).col).toBe(before.col - 2)
    expect(errors).toEqual([])
  })

  // The other half of the focus decision, and the reason it was taken: a
  // focused button must keep its Space. Only a real browser has real focus and
  // a real default action to lose, so this cannot be asserted anywhere else.
  //
  // The menu bar is the case that bites, because closing a menu hands focus
  // back to its trigger: pressing Space next has to reopen it rather than
  // silently arm a pan.
  test('Space still works the button that has focus', async ({ page }) => {
    const { errors } = await openApp(page)

    const edit = page.getByRole('button', { name: 'Edit' })
    await edit.click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitem').first()).toBeHidden()

    await edit.focus()
    await page.keyboard.press(' ')

    await expect(page.getByRole('menuitem').first()).toBeVisible()
    expect(errors).toEqual([])
  })

  // An unclaimed Space scrolls the page, which would move the whole app under
  // the canvas rather than the map inside it.
  test('holding Space does not scroll the page', async ({ page }) => {
    await openApp(page)
    const grid = await gridMapping(page)
    const probe = grid.at(4.5, 4.5)

    await page.keyboard.press('2')
    await page.mouse.click(probe.x, probe.y)

    await page.keyboard.down(' ')
    await page.keyboard.up(' ')

    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })

  test('panning over a room leaves the drawing alone', async ({ page }) => {
    await openApp(page)
    const grid = await gridMapping(page)
    const before = await undoLabel(page)

    // `one-of-everything` has content around the origin, so this drag starts
    // on a room rather than on bare grid.
    const from = grid.at(1.5, 1.5)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down({ button: MIDDLE })
    await page.mouse.move(from.x + grid.cellPx * 3, from.y + grid.cellPx * 3, { steps: 8 })
    await page.mouse.up({ button: MIDDLE })

    expect(await undoLabel(page)).toBe(before)
  })
})
