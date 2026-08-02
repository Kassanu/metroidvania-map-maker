import { test, expect } from '@playwright/test'
import { openApp, undoLabel, gridMapping } from './support/canvas'

// What jsdom cannot reach here: a drag along the vertex lattice held across a
// real pointer capture, and the crosshair the browser actually computes. The
// unit tests dispatch synthetic moves at points they derived from the camera
// themselves; this is the one that fails if the lattice and the screen disagree.

// The dev seed's frozen fixture opens with a "Landing Site" room filling cells
// (0,0) to (2,2), a 3x3, and so the smallest room in the fixture with more
// than one interior vertex. Its interior vertices are (1,1), (2,1), (1,2) and
// (2,2); the wall drawn below is the one between the first two.
const FROM = { x: 1, y: 1 }
const TO = { x: 2, y: 1 }
// A point on that wall: halfway along it, a whisker inside the cell below, so
// the pointer's own cell is the room's and neither end vertex is nearer.
const ON_WALL = { x: 1.5, y: 1.06 }

test.describe('Draw mode inner walls', () => {
  test('dragging between two interior corners draws a wall', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)

    const from = grid.at(FROM.x, FROM.y)
    const to = grid.at(TO.x, TO.y)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 10 })
    await page.mouse.up()

    expect(await undoLabel(page)).toBe('Undo Draw Inner Wall')
    expect(errors).toEqual([])
  })

  // A wall needs two vertices, so a bare tap on one leaves an empty union,
  // and an empty transaction is dropped: there is nothing to undo.
  test('a click on a corner draws nothing', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const before = await undoLabel(page)

    const from = grid.at(FROM.x, FROM.y)
    await page.mouse.click(from.x, from.y)

    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  // Erase priority: a right-press on an inner-wall segment deletes the
  // segment; otherwise it erases the cell. Both halves, at the same spot: the
  // second right-press has no wall left under it and falls through to the
  // cell.
  test('a right-press takes the segment first and the cell after', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)

    const from = grid.at(FROM.x, FROM.y)
    const to = grid.at(TO.x, TO.y)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 10 })
    await page.mouse.up()
    expect(await undoLabel(page)).toBe('Undo Draw Inner Wall')

    const onWall = grid.at(ON_WALL.x, ON_WALL.y)
    await page.mouse.click(onWall.x, onWall.y, { button: 'right' })
    expect(await undoLabel(page)).toBe('Undo Erase Inner Wall')

    await page.mouse.click(onWall.x, onWall.y, { button: 'right' })
    expect(await undoLabel(page)).toBe('Undo Erase')
    expect(errors).toEqual([])
  })

  test('Esc abandons a wall mid-drag', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const before = await undoLabel(page)

    const from = grid.at(FROM.x, FROM.y)
    const to = grid.at(TO.x, TO.y)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 10 })
    await page.keyboard.press('Escape')
    await page.mouse.up()

    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  // Hovering an interior vertex switches the cursor to vertex mode: the press
  // will draw a wall. The vertex targets only draw on an armed room, so on
  // desktop the cursor is what says the press will draw rather than paint.
  test('an interior corner shows the draw cursor', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const viewport = page.locator('.canvas-viewport')

    const from = grid.at(FROM.x, FROM.y)
    await page.mouse.move(from.x, from.y)
    await expect(viewport).toHaveCSS('cursor', 'crosshair')

    // A corner of the room that is not interior (three of its four cells are
    // outside), so it paints like anywhere else.
    const outer = grid.at(0, 0)
    await page.mouse.move(outer.x, outer.y)
    await expect(viewport).not.toHaveCSS('cursor', 'crosshair')
    expect(errors).toEqual([])
  })

  test('the toolbar offers the three locked styles', async ({ page }) => {
    const { errors } = await openApp(page)
    const group = page.getByRole('radiogroup', { name: 'Wall' })

    await expect(group.getByRole('radio')).toHaveCount(3)
    await expect(group.getByRole('radio', { name: 'Solid' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await group.getByRole('radio', { name: 'Dotted' }).click()
    await expect(group.getByRole('radio', { name: 'Dotted' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(group.getByRole('radio', { name: 'Solid' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(errors).toEqual([])
  })
})
