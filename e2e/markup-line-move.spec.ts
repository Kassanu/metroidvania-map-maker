import { test, expect } from '@playwright/test'
import { openApp, undoLabel, gridMapping } from './support/canvas'

// What jsdom structurally cannot reach: a drag that has to keep reporting after
// the pointer leaves the element it went down on. A line translate always does,
// and the unit test passes either way because jsdom has no pointer capture to
// get wrong.

// Bare grid well clear of the dev seed's rooms, so the line drawn here has no
// room under it and nothing else resolves in these cells.
//
// Long enough that MIDDLE is several cells from either endpoint and from the
// crossing line's own end: an endpoint outranks a body, so a grab band reaching
// MIDDLE would extend a line where this means to translate one.
const START = { x: 8.5, y: 8.5 }
const END = { x: 14.5, y: 8.5 }
const MIDDLE = { x: 12.5, y: 8.5 }
const CROSSING = { x: 9.5, y: 8.5 }

test.describe('Markup mode line move', () => {
  test('a selected line translates by drag, and an unselected one draws another', async ({
    page,
  }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('4')
    const grid = await gridMapping(page)

    const from = grid.at(START.x, START.y)
    const to = grid.at(END.x, END.y)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 10 })
    await page.mouse.up()
    expect(await undoLabel(page)).toBe('Undo Draw Line')

    // Unselected: the body still draws, which is what makes overlapping lines
    // drawable at all.
    const crossing = grid.at(CROSSING.x, CROSSING.y)
    await page.mouse.move(crossing.x, crossing.y)
    await page.mouse.down()
    await page.mouse.move(crossing.x, crossing.y + grid.cellPx * 2, { steps: 10 })
    await page.mouse.up()
    expect(await undoLabel(page)).toBe('Undo Draw Line')

    const middle = grid.at(MIDDLE.x, MIDDLE.y)

    // Selected: the same press translates instead. The drag runs two cells down
    // and one across, so it leaves the origin cell in both axes.
    await page.mouse.click(middle.x, middle.y)
    await page.mouse.move(middle.x, middle.y)
    await page.mouse.down()
    await page.mouse.move(middle.x + grid.cellPx, middle.y + grid.cellPx * 2, { steps: 10 })
    await page.mouse.up()

    expect(await undoLabel(page)).toBe('Undo Move Line')
    expect(errors).toEqual([])
  })

  // The op guards the zero delta, so a drag that goes out and comes back
  // commits an empty transaction the seam drops.
  test('out and back leaves no undo step', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('4')
    const grid = await gridMapping(page)

    const from = grid.at(START.x, START.y)
    const to = grid.at(END.x, END.y)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 10 })
    await page.mouse.up()

    const middle = grid.at(MIDDLE.x, MIDDLE.y)
    await page.mouse.click(middle.x, middle.y)
    await page.mouse.move(middle.x, middle.y)
    await page.mouse.down()
    await page.mouse.move(middle.x + grid.cellPx * 3, middle.y + grid.cellPx * 3, { steps: 10 })
    await page.mouse.move(middle.x, middle.y, { steps: 10 })
    await page.mouse.up()

    expect(await undoLabel(page)).toBe('Undo Draw Line')
    expect(errors).toEqual([])
  })
})
