import { test, expect } from '@playwright/test'
import { openApp, gridMapping, undoLabel, type GridMapping } from './support/canvas'
import type { Page } from '@playwright/test'

// Select mode end to end, on the pair of rooms the dev fixture carries for
// exactly this: band, move, copy, paste. Each step is read back through the
// undo stack, which is the only thing a canvas gesture leaves in the DOM.
//
// The pair sits well below the rest of the fixture with clear grid around it,
// so a band can enclose both without catching anything else and a move has
// somewhere to go. Every point here is inside the canvas: a press that starts
// outside it starts no gesture, and the band would silently be a click.

// The left room of the pair spans (0,11)-(2,12) and the right one (5,11)-(6,12).
const IN_LEFT = { x: 1.5, y: 11.5 }
const IN_RIGHT = { x: 5.5, y: 11.5 }
// Where the right room lands if it travels with a three-row move.
const RIGHT_MOVED = { x: 5.5, y: 8.5 }

// Whether a room occupies this cell, asked the only way the DOM can answer:
// click it and see whether `Del` finds a room to delete. Restores itself, so
// the probe leaves the map as it found it.
async function hasRoomAt(page: Page, grid: GridMapping, at: { x: number; y: number }) {
  const before = await undoLabel(page)
  const point = grid.at(at.x, at.y)
  await page.mouse.click(point.x, point.y)
  await page.keyboard.press('Delete')
  const after = await undoLabel(page)
  if (after === before) return false
  await page.keyboard.press('ControlOrMeta+z')
  return true
}

async function band(
  page: Page,
  grid: GridMapping,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const start = grid.at(from.x, from.y)
  const end = grid.at(to.x, to.y)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 10 })
  await page.mouse.up()
}

async function dragUp(page: Page, grid: GridMapping, at: { x: number; y: number }, rows: number) {
  const point = grid.at(at.x, at.y)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x, point.y - grid.cellPx * rows, { steps: 10 })
  await page.mouse.up()
}

test.describe('Select mode end to end', () => {
  test('a band takes both rooms, and one drag moves the pair as one step', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)

    await band(page, grid, { x: 7.5, y: 12.5 }, { x: 0.5, y: 11.5 })
    await dragUp(page, grid, IN_LEFT, 3)
    expect(await undoLabel(page)).toBe('Undo Move Room')

    // The far room travelled with the one that was dragged, which is the whole
    // claim: a drag on a selected object moves the selection, not just itself.
    expect(await hasRoomAt(page, grid, RIGHT_MOVED)).toBe(true)
    expect(await hasRoomAt(page, grid, IN_RIGHT)).toBe(false)

    // And it went as one step: a single undo puts the pair back.
    await page.keyboard.press('ControlOrMeta+z')
    expect(await hasRoomAt(page, grid, IN_RIGHT)).toBe(true)
    expect(errors).toEqual([])
  })

  // Touching, not containing, is the band's rule, and its other half is that a
  // room the band never reaches stays put.
  test('a band that clips one room leaves the other where it was', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)

    // Into the left room's first column only, and nowhere near the right one.
    await band(page, grid, { x: 3.5, y: 12.5 }, { x: 0.5, y: 11.5 })
    await dragUp(page, grid, IN_LEFT, 3)
    expect(await undoLabel(page)).toBe('Undo Move Room')

    expect(await hasRoomAt(page, grid, RIGHT_MOVED)).toBe(false)
    expect(await hasRoomAt(page, grid, IN_RIGHT)).toBe(true)
    expect(errors).toEqual([])
  })

  test('copies the pair and pastes it under the pointer', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)

    await band(page, grid, { x: 7.5, y: 12.5 }, { x: 0.5, y: 11.5 })
    await page.keyboard.press('ControlOrMeta+c')

    // Clear of the pair, so what lands there can only be the paste.
    const target = { x: 10.5, y: 8.5 }
    expect(await hasRoomAt(page, grid, target)).toBe(false)

    const at = grid.at(target.x, target.y)
    await page.mouse.move(at.x, at.y)
    await page.keyboard.press('ControlOrMeta+v')
    expect(await undoLabel(page)).toBe('Undo Paste')

    expect(await hasRoomAt(page, grid, target)).toBe(true)
    // The originals are still where they were.
    expect(await hasRoomAt(page, grid, IN_LEFT)).toBe(true)
    expect(errors).toEqual([])
  })
})
