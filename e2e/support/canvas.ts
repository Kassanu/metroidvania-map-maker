// Shared canvas plumbing for the Draw-mode e2e specs.
//
// The canvas has no DOM to query, so every one of these reaches the grid the
// way a user does: through the coords overlay for position, and through the
// Edit menu's first item for what a gesture committed. Nothing here reads the
// stores, so a spec cannot pass because the model agrees with itself.
//
// Not a `.spec.ts`, so Playwright collects no tests from it.

import type { Page } from '@playwright/test'

export async function openApp(page: Page, sample = 'one-of-everything') {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))

  // The app starts blank, so a spec that needs content asks for a sample by
  // name. `one-of-everything` is the project these specs were written against.
  await page.goto(`/?sample=${sample}`)
  await page.getByRole('button', { name: 'Get started' }).click()
  return { errors }
}

// The undo stack's top entry: the only observable a canvas gesture leaves in
// the DOM, and what a single labelled transaction per gesture looks like from
// the user's side.
export async function undoLabel(page: Page) {
  await page.getByRole('button', { name: 'Edit' }).click()
  const label = await page.getByRole('menuitem').first().textContent()
  await page.keyboard.press('Escape')
  return label?.trim()
}

// The world cell under a screen point, read off the coords overlay.
export async function cellAt(page: Page, x: number, y: number) {
  await page.mouse.move(x, y)
  const text = (await page.locator('.coords-overlay').textContent())?.trim() ?? ''
  const [col, row] = text.split(',').map((part) => Number(part.trim()))
  return { col, row }
}

// The screen x of the next column boundary right of `x`, to the pixel. Binary
// search rather than a scan: the overlay read is a round trip, and a cell is
// only a few dozen pixels wide.
async function boundaryRightOf(page: Page, x: number, y: number, window: number) {
  const start = (await cellAt(page, x, y)).col
  let inside = x
  let past = x + window
  while (past - inside > 1) {
    const mid = Math.floor((inside + past) / 2)
    if ((await cellAt(page, mid, y)).col === start) inside = mid
    else past = mid
  }
  return past
}

export interface GridMapping {
  cellPx: number
  // The screen point at world (x, y), where integers land on grid lines:
  // `at(3, 2)` is a vertex and `at(3.5, 2.5)` is a cell centre.
  at(x: number, y: number): { x: number; y: number }
}

// Solves the world -> screen mapping from the overlay alone, so no spec
// hard-codes the default pan, the tile size or the ruler thickness. Two
// consecutive boundaries give the cell size; one of them gives the offset.
export async function gridMapping(page: Page): Promise<GridMapping> {
  const box = await page.locator('.canvas-viewport').boundingBox()
  if (!box) throw new Error('no canvas viewport')
  const probeX = box.x + 200
  const probeY = box.y + 200

  // A generous first window: the true cell size is well under this, so the
  // search is guaranteed to bracket a boundary.
  const firstX = await boundaryRightOf(page, probeX, probeY, 200)
  const secondX = await boundaryRightOf(page, firstX + 1, probeY, 200)
  const cellPx = secondX - firstX

  const colAtFirst = (await cellAt(page, firstX, probeY)).col
  const rowAtProbe = (await cellAt(page, probeX, probeY)).row
  // The row boundary below the probe, using the cell size we now know.
  let insideY = probeY
  let pastY = probeY + cellPx
  while (pastY - insideY > 1) {
    const mid = Math.floor((insideY + pastY) / 2)
    if ((await cellAt(page, probeX, mid)).row === rowAtProbe) insideY = mid
    else pastY = mid
  }

  return {
    cellPx,
    at(x: number, y: number) {
      return {
        x: firstX + (x - colAtFirst) * cellPx,
        y: pastY + (y - (rowAtProbe + 1)) * cellPx,
      }
    },
  }
}
