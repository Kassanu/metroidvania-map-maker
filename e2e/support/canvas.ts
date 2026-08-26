// Shared canvas plumbing for the Room Mode e2e specs.
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

// The colour the map canvas has at a screen point, as [r, g, b, a].
//
// The only way to read a mark that lives nowhere but the bitmap, and the whole
// browser half of the canvas harness: a clip, a pattern or a derived colour is
// a claim about pixels, and this is what reads one.
//
// The scale comes from the canvas's own backing store rather than from
// `window.devicePixelRatio`, so it stays right if the element is ever sized to
// anything other than exactly its CSS box.
//
// Aim it through `gridMapping`, never at a fixed offset: which world cell a
// screen point lands on depends on where the camera opened.
export async function pixelAt(page: Page, point: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('.canvas-viewport canvas.canvas') as HTMLCanvasElement
    const box = canvas.getBoundingClientRect()
    const ratio = canvas.width / box.width
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

// Every distinct colour along a horizontal run of the map canvas, commonest
// first, each with how many device pixels carried it.
//
// What `pixelAt` cannot do: a checkerboard answers light or dark depending on
// which square a single point lands in, so one read proves nothing about it. A
// run does, and "this run holds exactly two colours" is also what tells a
// pattern from a flat fill.
//
// One `page.evaluate` for the whole span rather than a read per pixel: a round
// trip each would be hundreds of them.
export async function colorsAlong(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  return page.evaluate(
    ({ from, to }) => {
      const canvas = document.querySelector('.canvas-viewport canvas.canvas') as HTMLCanvasElement
      const box = canvas.getBoundingClientRect()
      const ratio = canvas.width / box.width
      const ctx = canvas.getContext('2d')!

      const x = Math.round((from.x - box.x) * ratio)
      const y = Math.round((from.y - box.y) * ratio)
      const width = Math.max(1, Math.round((to.x - from.x) * ratio))
      const { data } = ctx.getImageData(x, y, width, 1)

      const counts = new Map<string, number>()
      for (let at = 0; at < data.length; at += 4) {
        const key = [data[at], data[at + 1], data[at + 2], data[at + 3]].join(',')
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }

      return [...counts]
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({ color: key.split(',').map(Number), count }))
    },
    { from, to },
  )
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
