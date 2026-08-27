import { test, expect } from '@playwright/test'
import { openApp, gridMapping, colorsAlong } from './support/canvas'

// Where a grid line's ink lands, read off the backing store in both engines.
//
// The two ratios are one test run twice and neither half is redundant: several
// wrong conversions agree with the right one at ratio 1, and at ratio 2 the
// stroke is two device pixels and already covers whole columns, so that is the
// ratio an offset written as a constant fails at.
//
// Containment at the span's edge is asserted in `renderMap.test.ts` instead,
// where it is exact. In the browser the page's own fill edge antialiases
// whenever the camera sits on a fraction, and the run picks up a blend that
// has nothing to do with the grid.

// The blank project's page is 21x21 cells centred on the world origin, so
// cells 0 through 3 are bare grid well inside it. Bare matters: the grid is
// drawn under the rooms, so a run crossing one reads the room, not the line.
const FROM = { x: 0.5, y: 0.5 }
const TO = { x: 3.5, y: 0.5 }
const LINES_CROSSED = 3

async function inkAcrossGridLines(page: import('@playwright/test').Page) {
  const grid = await gridMapping(page)
  // A cell centre at both ends, so the run crosses three vertical lines and no
  // horizontal one.
  return colorsAlong(page, grid.at(FROM.x, FROM.y), grid.at(TO.x, TO.y))
}

test.describe('a grid line at ratio 1', () => {
  test.use({ deviceScaleFactor: 1 })

  test('covers one whole pixel column rather than two at half alpha', async ({ page }) => {
    const { errors } = await openApp(page, null)

    const colors = await inkAcrossGridLines(page)

    // Two colours and no third: the page and the line. A blend of the two is a
    // line that landed across a pixel boundary.
    expect(colors).toHaveLength(2)
    // Commonest first, so the page is [0] and the line is [1]. One device pixel
    // a line, which at this ratio is one image pixel.
    expect(colors[1].count).toBe(LINES_CROSSED)
    expect(errors).toEqual([])
  })
})

test.describe('a grid line at ratio 2', () => {
  test.use({ deviceScaleFactor: 2 })

  test('stays two device pixels wide and does not move', async ({ page }) => {
    const { errors } = await openApp(page, null)

    const colors = await inkAcrossGridLines(page)

    expect(colors).toHaveLength(2)
    // A CSS pixel is two device pixels here, and both are full: this is the
    // count that goes to three at half alpha if the offset is a device
    // half-pixel rather than a derived one.
    expect(colors[1].count).toBe(LINES_CROSSED * 2)
    expect(errors).toEqual([])
  })
})
