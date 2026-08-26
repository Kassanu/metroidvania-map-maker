import { test, expect } from '@playwright/test'
import { openApp, gridMapping, pixelAt } from './support/canvas'
import { setAppearance } from './support/chrome'

// The browser half of the canvas harness, and the paint rule it was built for:
// a room takes its area's cell colour, a room in World takes the theme's, and a
// heated room takes a lightened version of whichever of the two it resolved.
//
// This is the only spec that asserts an absolute colour. Every other probe in
// the suite compares two reads of the same point, which cannot tell a working
// probe from one that is off by a device pixel ratio.
//
// The theme half cannot be asserted absolutely, because which theme the run
// opens in decides the colour. It is asserted as a direction instead, which is
// the property that matters: whatever the theme declares, heat has to be able
// to read it and move it. No unit test can see that, since jsdom never loads
// `style.css`.

// Twice the suite's default. At a ratio of 1 every way of converting a screen
// point to a backing-store pixel agrees, so a probe that forgot the ratio
// entirely would still read the right pixel and the coverage would be a
// fiction.
test.use({ deviceScaleFactor: 2 })

// The area's `cellColor` in samples/heat-and-liquid.mvm, and what heat makes of
// it: a lightness move of half the distance remaining to white, holding hue and
// saturation. The green and blue channels land on exactly 94.5 and round away
// from zero. Two or three points short of the game's own heated `#FF6262`,
// which is the same move at k = 0.51.
const MAGMA = [189, 0, 0, 255]
const HOT_MAGMA = [255, 95, 95, 255]

// Cell centres. Cavern is the plain Magma room at (0,0)-(2,2) and Furnace the
// heated one at (4,0)-(6,2); Overlook is the plain World room at (4,4)-(6,6)
// and Vent the heated one at (8,4)-(10,6). The gap between two rooms is bare
// grid.
const IN_CAVERN = { x: 1.5, y: 1.5 }
const IN_FURNACE = { x: 5.5, y: 1.5 }
const IN_OVERLOOK = { x: 5.5, y: 5.5 }
const IN_VENT = { x: 9.5, y: 5.5 }
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

  test('opens a sample carrying heated and flooded rooms', async ({ page }) => {
    const { errors } = await openApp(page, 'heat-and-liquid')

    await page.keyboard.press('2')
    const hierarchy = page.locator('[data-panel-id="hierarchy"]')
    for (const room of [
      'Cavern',
      'Furnace',
      'Cistern',
      'Magma Chamber',
      'Sump',
      'Overlook',
      'Vent',
    ]) {
      await expect(hierarchy.getByText(room, { exact: true })).toBeVisible()
    }
    expect(errors).toEqual([])
  })
})

test.describe('the paint rule for heat', () => {
  test('paints a heated room at the lightened area colour', async ({ page }) => {
    const { errors } = await openApp(page, 'heat-and-liquid')
    const grid = await gridMapping(page)

    expect(await pixelAt(page, grid.at(IN_FURNACE.x, IN_FURNACE.y))).toEqual(HOT_MAGMA)
    expect(errors).toEqual([])
  })

  // Heat moved one room, not the area it is in. Without this the same pixels
  // would pass with a renderer that lightened everything.
  test('leaves the plain room of the same area alone', async ({ page }) => {
    await openApp(page, 'heat-and-liquid')
    const grid = await gridMapping(page)

    expect(await pixelAt(page, grid.at(IN_CAVERN.x, IN_CAVERN.y))).toEqual(MAGMA)
  })

  // The commonest case in the app: World holds no colour, so the transform's
  // input is whatever the stylesheet declares, and each theme declares its own.
  // A declaration that stopped being a form the transform can read would leave
  // heat a silent no-op in that theme alone.
  //
  // Both themes for that reason, and asserted as a direction rather than a
  // value, because the theme decides the value and both of them lighten. This
  // is the only thing in the suite that looks: jsdom loads no stylesheet, so a
  // unit test cannot see a declaration change form.
  test('lightens a heated World room out of the theme colour, in both themes', async ({ page }) => {
    const { errors } = await openApp(page, 'heat-and-liquid')
    const grid = await gridMapping(page)

    const plainPerTheme: number[][] = []
    for (const appearance of ['Light', 'Dark']) {
      await setAppearance(page, appearance)

      // Polled: the theme change repaints the canvas, and the read races it.
      await expect
        .poll(async () => (await pixelAt(page, grid.at(IN_OVERLOOK.x, IN_OVERLOOK.y))).join())
        .not.toBe(plainPerTheme.at(-1)?.join() ?? '')

      const plain = await pixelAt(page, grid.at(IN_OVERLOOK.x, IN_OVERLOOK.y))
      const heated = await pixelAt(page, grid.at(IN_VENT.x, IN_VENT.y))

      expect(heated, appearance).not.toEqual(plain)
      for (const channel of [0, 1, 2]) {
        expect(heated[channel], appearance).toBeGreaterThan(plain[channel])
      }
      // Lighter, not more transparent.
      expect(heated[3], appearance).toBe(255)

      plainPerTheme.push(plain)
    }

    // The two passes really did run against two colours, rather than twice
    // against whichever theme the run opened in.
    expect(plainPerTheme[0]).not.toEqual(plainPerTheme[1])
    expect(errors).toEqual([])
  })
})
