import { test, expect } from '@playwright/test'
import { openApp, gridMapping, pixelAt } from './support/canvas'

// The browser half of the canvas harness, proved against a rule that already
// holds: a room takes its area's cell colour, and a room in World takes the
// theme's.
//
// This is the only spec that asserts an absolute colour. Every other probe in
// the suite compares two reads of the same point, which cannot tell a working
// probe from one that is off by a device pixel ratio.
//
// Nothing here asserts anything about heat or liquid. The sample carries rooms
// with both set, but until the paint rule lands they render as plain rooms, so
// an assertion on them would pass now and keep passing once it stopped being
// true.

// Twice the suite's default. At a ratio of 1 every way of converting a screen
// point to a backing-store pixel agrees, so a probe that forgot the ratio
// entirely would still read the right pixel and the coverage would be a
// fiction.
test.use({ deviceScaleFactor: 2 })

// The area's `cellColor` in samples/heat-and-liquid.mvm.
const MAGMA = [189, 0, 0, 255]

// Cell centres. Cavern is the Magma room at (0,0)-(2,2), Overlook the World
// room at (4,4)-(6,6), and the gap between the two rooms is bare grid.
const IN_CAVERN = { x: 1.5, y: 1.5 }
const IN_OVERLOOK = { x: 5.5, y: 5.5 }
const BARE_GRID = { x: 3.5, y: 1.5 }

test.describe('the canvas pixel probe', () => {
  test('reads a room as the exact colour its area gives it', async ({ page }) => {
    const { errors } = await openApp(page, 'heat-and-liquid')
    const grid = await gridMapping(page)

    expect(await pixelAt(page, grid.at(IN_CAVERN.x, IN_CAVERN.y))).toEqual(MAGMA)
    expect(errors).toEqual([])
  })

  // One cell over is outside the room. If the probe were reading a fixed offset
  // rather than the point it was handed, both would answer the same.
  test('reads the cell it was aimed at, not a neighbour', async ({ page }) => {
    await openApp(page, 'heat-and-liquid')
    const grid = await gridMapping(page)

    const inside = await pixelAt(page, grid.at(IN_CAVERN.x, IN_CAVERN.y))
    const outside = await pixelAt(page, grid.at(BARE_GRID.x, BARE_GRID.y))

    expect(inside).toEqual(MAGMA)
    expect(outside).not.toEqual(MAGMA)
  })

  // World holds no colour of its own, so its rooms come out of the theme. That
  // is the fallback the paint rule has to resolve before it can transform
  // anything, and it is the commonest case in the app.
  test('reads a World room as the theme colour, not the area colour', async ({ page }) => {
    const { errors } = await openApp(page, 'heat-and-liquid')
    const grid = await gridMapping(page)

    const overlook = await pixelAt(page, grid.at(IN_OVERLOOK.x, IN_OVERLOOK.y))

    expect(overlook).not.toEqual(MAGMA)
    // A room all the same: opaque, and not the bare grid it sits on.
    expect(overlook[3]).toBe(255)
    expect(overlook).not.toEqual(await pixelAt(page, grid.at(BARE_GRID.x, BARE_GRID.y)))
    expect(errors).toEqual([])
  })

  // The rooms the rendering work will need, carried by the fixture so that work
  // does not also have to build one. They are plain on screen until then.
  test('opens a sample carrying heated and flooded rooms', async ({ page }) => {
    const { errors } = await openApp(page, 'heat-and-liquid')

    await page.keyboard.press('2')
    const hierarchy = page.locator('[data-panel-id="hierarchy"]')
    for (const room of ['Cavern', 'Furnace', 'Cistern', 'Magma Chamber', 'Sump', 'Overlook']) {
      await expect(hierarchy.getByText(room, { exact: true })).toBeVisible()
    }
    expect(errors).toEqual([])
  })
})
