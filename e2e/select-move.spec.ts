import { test, expect } from '@playwright/test'
import { openApp, undoLabel, gridMapping, cellAt } from './support/canvas'

// Select mode's drag column in a real browser. The unit suite has the ops and
// the batch; what only a browser shows is that a move keeps reporting after the
// pointer leaves the element it went down on, which every drag of more than a
// cell or two does.

// Inside the dev seed's first room, and bare grid well clear of every room.
const IN_A_ROOM = { x: 1.5, y: 0.5 }
const BARE_GRID = { x: 9.5, y: 3.5 }

test.describe('Select mode move', () => {
  test('drags an unselected room, selecting it first', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)

    // Straight from the press, with nothing selected: the drag is what selects
    // it, so what moves is what was pointed at.
    const from = grid.at(IN_A_ROOM.x, IN_A_ROOM.y)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + grid.cellPx * 2, from.y + grid.cellPx * 3, { steps: 10 })
    await page.mouse.up()

    // Where it landed is the gesture's own suite. What this says is that the
    // drag reached the ops at all, across a pointer path of five cells.
    expect(await undoLabel(page)).toBe('Undo Move Room')
    expect(errors).toEqual([])
  })

  // The op guards the zero delta, so a drag that goes out and comes back
  // commits an empty transaction the seam drops.
  test('out and back leaves no undo step', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)
    const before = await undoLabel(page)

    const from = grid.at(IN_A_ROOM.x, IN_A_ROOM.y)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + grid.cellPx * 4, from.y + grid.cellPx * 4, { steps: 10 })
    await page.mouse.move(from.x, from.y, { steps: 10 })
    await page.mouse.up()

    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  // The two drag columns are not the same gesture: bare grid rubber-bands, and
  // a band changes no model at all.
  test('a drag on bare grid marquees rather than moving anything', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)
    const before = await undoLabel(page)

    const from = grid.at(BARE_GRID.x, BARE_GRID.y)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + grid.cellPx * 2, from.y + grid.cellPx * 2, { steps: 5 })
    await page.mouse.up()

    // A band over bare grid selects nothing and moves nothing.
    expect(await undoLabel(page)).toBe(before)
    expect(await cellAt(page, from.x, from.y)).toEqual({ col: 9, row: 3 })
    expect(errors).toEqual([])
  })

  // The same press on the same cell, one granularity over, reaching a different
  // op: the undo entry is the only place the difference is readable outside the
  // canvas, and it is the thing that says which of the two happened.
  test('drags a selected cell out of its room as a fragment', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    await page
      .getByRole('radiogroup', { name: 'Select' })
      .getByRole('radio', { name: 'Cells' })
      .click()
    const grid = await gridMapping(page)

    const from = grid.at(IN_A_ROOM.x, IN_A_ROOM.y)
    await page.mouse.click(from.x, from.y)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + grid.cellPx * 6, from.y + grid.cellPx * 4, { steps: 10 })
    await page.mouse.up()

    expect(await undoLabel(page)).toBe('Undo Move Cells')
    expect(errors).toEqual([])
  })
})
