import { test, expect } from '@playwright/test'
import { openApp, undoLabel, gridMapping } from './support/canvas'

// What jsdom structurally cannot reach here: a drag that has to stay on a
// pixel-accurate target across a real pointer capture, and the CSS cursor
// that tells a desktop user the press will resize at all. The unit tests
// stub `getBoundingClientRect` to a fixed 800x600 and compute their own screen
// points from the camera, so they prove the gesture and the dispatch but never
// that the two agree about where a wall is on screen.

// The dev seed's frozen fixture opens with a "Corridor" room at cells (3,0),
// (4,0), (3,1) and (4,1), a 2x2, so its east face is a straight run of two and
// carries a handle. Using it rather than painting one keeps the test about
// resize instead of about paint.
const EAST_WALL = { x: 5, y: 0.5 }

test.describe('Draw mode edge-run resize', () => {
  test('dragging the handle extrudes the run, as one undo step', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)

    // Two pixels inside the wall: within the grab band, and (the part that
    // matters) inside the room's own cell, which is what makes the zone
    // resolve as an edge run rather than as empty grid.
    const wall = grid.at(EAST_WALL.x, EAST_WALL.y)
    await page.mouse.move(wall.x - 2, wall.y)
    await page.mouse.down()
    await page.mouse.move(wall.x + grid.cellPx * 2, wall.y, { steps: 10 })
    await page.mouse.up()

    expect(await undoLabel(page)).toBe('Undo Resize Room')
    expect(errors).toEqual([])
  })

  // The headline property, through a real drag: dragging a run out N cells
  // and back in N restores the exact original geometry, so there is nothing
  // to undo. The observable is the undo stack still naming whatever came
  // before.
  test('out and back to the start leaves no undo step', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const before = await undoLabel(page)

    const wall = grid.at(EAST_WALL.x, EAST_WALL.y)
    await page.mouse.move(wall.x - 2, wall.y)
    await page.mouse.down()
    await page.mouse.move(wall.x + grid.cellPx * 3, wall.y, { steps: 12 })
    await page.mouse.move(wall.x - 2, wall.y, { steps: 12 })
    await page.mouse.up()

    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  test('Esc abandons a resize mid-drag', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const before = await undoLabel(page)

    const wall = grid.at(EAST_WALL.x, EAST_WALL.y)
    await page.mouse.move(wall.x - 2, wall.y)
    await page.mouse.down()
    await page.mouse.move(wall.x + grid.cellPx * 2, wall.y, { steps: 10 })
    await page.keyboard.press('Escape')
    await page.mouse.up()

    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  // The affordance, as the browser actually computes it. A desktop user gets no
  // handles until a room is armed, so this is the only thing distinguishing a
  // press that resizes from a press that grows.
  test('the wall shows a resize cursor, and the interior does not', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const viewport = page.locator('.canvas-viewport')

    const wall = grid.at(EAST_WALL.x, EAST_WALL.y)
    await page.mouse.move(wall.x - 2, wall.y)
    await expect(viewport).toHaveCSS('cursor', 'ew-resize')

    const northWall = grid.at(3.5, 0)
    await page.mouse.move(northWall.x, northWall.y + 2)
    await expect(viewport).toHaveCSS('cursor', 'ns-resize')

    const middle = grid.at(3.5, 0.5)
    await page.mouse.move(middle.x, middle.y)
    await expect(viewport).toHaveCSS('cursor', 'auto')
    expect(errors).toEqual([])
  })
})
