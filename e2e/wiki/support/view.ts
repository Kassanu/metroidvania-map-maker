// Frames the map before a capture: zoom, then position.
//
// Everything here is driven through the app's own controls, the middle-button
// drag a user pans with and the toolbar's zoom field, rather than by writing to
// the camera: a shot framed through the app's own gestures cannot come to show
// a view the app cannot reach.
//
// Zoom comes before position. `setZoom` leaves the camera's pan alone and pan
// is the world coordinate at the viewport's top-left, so zooming in pushes
// content off towards the bottom-right and whatever framed the shot before is
// no longer framing it.
//
// A drag has to stay inside the canvas viewport, so a pan larger than the
// viewport is several drags rather than one. Screen pixels throughout, in the
// same space as the manifest's viewport, except `focusOn`, which is in cells.
//
// Not a `.spec.ts`, so Playwright collects no tests from it.

import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { gridMapping } from '../../support/canvas'

// Fraction of the viewport a single drag may cross. Under 1 so the pointer
// starts and ends well inside the canvas, whatever the rulers take.
const DRAG_SPAN = 0.6

// Sets the zoom to exactly `zoom`, as a multiplier: 1.5 is the 150% the
// toolbar reads back.
//
// Typed into the zoom field rather than clicked up with its `+`, which steps by
// a constant factor (100%, 125%, 156%, 195%) and so cannot land on a round
// number. The readout is asserted rather than assumed, because a shot whose
// zoom silently failed is a shot framed on the wrong thing.
export async function setZoom(page: Page, zoom: number) {
  const field = page.locator('.zoom-input')
  await field.fill(String(Math.round(zoom * 100)))
  await field.press('Enter')
  // The field opens its popup on focus, so it is blurred rather than left as
  // the active element with a listbox over the toolbar.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await expect(field).toHaveValue(`${Math.round(zoom * 100)}%`)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}

// Puts world cell (x, y) at the centre of the canvas viewport. Integers land on
// grid lines, so `focusOn(page, 4, 4)` centres a vertex and `4.5, 4.5` centres
// a cell.
//
// Cells rather than the screen pixels `panView` takes: a shot says which part
// of the map it is about, and a pixel count only says that once you also know
// the zoom, the ruler thickness and where the sample opened.
export async function focusOn(page: Page, x: number, y: number) {
  const box = await page.locator('.canvas-viewport').boundingBox()
  if (!box) throw new Error('no canvas viewport')

  const grid = await gridMapping(page)
  const target = grid.at(x, y)
  await panView(page, target.x - (box.x + box.width / 2), target.y - (box.y + box.height / 2))
}

// Moves the view by (dx, dy): positive dx shows what was off the right edge,
// positive dy shows what was below the bottom. The content travels the other
// way, which is the direction the drag goes.
export async function panView(page: Page, dx: number, dy: number) {
  const box = await page.locator('.canvas-viewport').boundingBox()
  if (!box) throw new Error('no canvas viewport')

  const limitX = box.width * DRAG_SPAN
  const limitY = box.height * DRAG_SPAN

  let remainingX = dx
  let remainingY = dy

  while (Math.abs(remainingX) >= 1 || Math.abs(remainingY) >= 1) {
    const stepX = Math.sign(remainingX) * Math.min(Math.abs(remainingX), limitX)
    const stepY = Math.sign(remainingY) * Math.min(Math.abs(remainingY), limitY)

    // Centred on the drag, so both ends sit inside the viewport.
    const fromX = box.x + box.width / 2 + stepX / 2
    const fromY = box.y + box.height / 2 + stepY / 2

    await page.mouse.move(fromX, fromY)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(fromX - stepX, fromY - stepY, { steps: 8 })
    await page.mouse.up({ button: 'middle' })

    remainingX -= stepX
    remainingY -= stepY
  }

  // Back to the corner the pointer started in. Left on the canvas it keeps the
  // coords overlay showing a cell, and a readout of where a pointer is is a lie
  // in a still that has no pointer in it.
  await page.mouse.move(0, 0)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}
