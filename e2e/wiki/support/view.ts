// Moves the map under the viewport before a capture.
//
// Driven as a middle-button drag, the way a user pans, rather than by writing
// to the camera: a shot framed through the app's own gesture cannot come to
// show a view the app cannot reach.
//
// A drag has to stay inside the canvas viewport, so a pan larger than the
// viewport is several drags rather than one. Screen pixels throughout, in the
// same space as the manifest's viewport.
//
// Not a `.spec.ts`, so Playwright collects no tests from it.

import type { Page } from '@playwright/test'

// Fraction of the viewport a single drag may cross. Under 1 so the pointer
// starts and ends well inside the canvas, whatever the rulers take.
const DRAG_SPAN = 0.6

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
