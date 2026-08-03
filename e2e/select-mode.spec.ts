import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { openApp, gridMapping, undoLabel } from './support/canvas'

// The colour the map canvas has at a screen point, in backing-store pixels.
// The only way to read a mark that lives nowhere but the bitmap.
async function pixelAt(page: Page, point: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('.canvas-viewport canvas.canvas') as HTMLCanvasElement
    const box = canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    const ctx = canvas.getContext('2d')!
    const { data } = ctx.getImageData(
      Math.round((x - box.x) * ratio),
      Math.round((y - box.y) * ratio),
      1,
      1,
    )
    return [data[0], data[1], data[2], data[3]]
  }, point)
}

// Select mode's shell in a real browser: the toolbar it grew, and the cursor,
// which is the only part of the resolver a user can see before they commit to a
// press.

// Inside the dev seed's first room, and bare grid well clear of every room.
const IN_A_ROOM = { x: 1.5, y: 0.5 }
const BARE_GRID = { x: 9.5, y: 3.5 }

test.describe('Select mode', () => {
  test('offers rooms and cells, starting on rooms', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')

    const granularity = page.getByRole('radiogroup', { name: 'Select' })
    await expect(granularity.getByRole('radio', { name: 'Rooms' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await granularity.getByRole('radio', { name: 'Cells' }).click()
    await expect(granularity.getByRole('radio', { name: 'Cells' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(errors).toEqual([])
  })

  // A cell selection has no DOM and no undo entry to read it back through: the
  // canvas is the whole of it. So this asks the canvas directly, which is also
  // the only claim worth making here, that picking Cells is visibly not a
  // no-op.
  test('marks a clicked cell on the canvas, and only that cell', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    await page
      .getByRole('radiogroup', { name: 'Select' })
      .getByRole('radio', { name: 'Cells' })
      .click()
    const grid = await gridMapping(page)

    const target = grid.at(IN_A_ROOM.x, IN_A_ROOM.y)
    const neighbour = grid.at(IN_A_ROOM.x + 1, IN_A_ROOM.y)
    const before = await pixelAt(page, target)
    const neighbourBefore = await pixelAt(page, neighbour)

    await page.mouse.click(target.x, target.y)

    expect(await pixelAt(page, target)).not.toEqual(before)
    expect(await pixelAt(page, neighbour)).toEqual(neighbourBefore)
    expect(errors).toEqual([])
  })

  // The band's own browser claim is capture, which the Rooms test below makes.
  // What this adds is the granularity: the same sweep marks the cells a room
  // owns and leaves the bare grid inside it alone.
  test('a band in Cells marks the owned cells it sweeps, and not the grid', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    await page
      .getByRole('radiogroup', { name: 'Select' })
      .getByRole('radio', { name: 'Cells' })
      .click()
    const grid = await gridMapping(page)

    // A cell of the seed's first room that carries no icon, since an icon is
    // drawn over the tint, and a cell inside the band that no room owns. The
    // band runs from beyond both, up and to the left.
    const owned = grid.at(0.5, 1.5)
    const bare = grid.at(1.5, 3.5)
    const ownedBefore = await pixelAt(page, owned)
    const bareBefore = await pixelAt(page, bare)

    const start = grid.at(3.5, 3.5)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(grid.at(0.5, 0.5).x, grid.at(0.5, 0.5).y, { steps: 10 })
    await page.mouse.up()

    expect(await pixelAt(page, owned)).not.toEqual(ownedBefore)
    expect(await pixelAt(page, bare)).toEqual(bareBefore)
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

  // The one part of `Ctrl+A` a browser decides: the combo is the browser's own
  // select-all, so what has to hold here is that the app claims it and the page
  // text stays unselected. What it selected is read back through `Del`, since a
  // selection has no DOM of its own.
  test('claims Ctrl+A from the browser and selects the rooms', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')

    await page.keyboard.press('ControlOrMeta+a')
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')

    await page.keyboard.press('Delete')
    expect(await undoLabel(page)).toBe('Undo Delete Room')
    expect(errors).toEqual([])
  })

  // A marquee always leaves the element it started on, and the pointer only
  // keeps reporting because the drag captures at press. Without capture the
  // moves stop at the first boundary and no band is ever drawn, which is the
  // one thing about this gesture jsdom cannot show. The band is swept up and
  // out over the ruler strip, and what it caught is read back through `Del`.
  test('sweeps rooms with a band that leaves the canvas', async ({ page }) => {
    const { errors } = await openApp(page)
    await page.keyboard.press('2')
    const grid = await gridMapping(page)
    const viewport = await page.locator('.canvas-viewport').boundingBox()
    if (!viewport) throw new Error('no canvas viewport')

    const start = grid.at(BARE_GRID.x, BARE_GRID.y)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x - 40, start.y - 40)
    // Past the top edge, onto the ruler: a different element from the one the
    // press landed on.
    await page.mouse.move(grid.at(IN_A_ROOM.x, IN_A_ROOM.y).x, viewport.y - 20)
    await page.mouse.up()

    await page.keyboard.press('Delete')
    expect(await undoLabel(page)).toBe('Undo Delete Room')
    expect(errors).toEqual([])
  })
})
