import { test, expect } from '@playwright/test'
import { openApp, gridMapping, pixelAt, colorsAlong } from './support/canvas'
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

// The liquid region: the room's cells below a hard surface line, dithered.
//
// Every probe here reads a run rather than a point. A checkerboard answers
// light or dark depending on which square a single read lands in, so a point
// proves nothing about it; a run holding exactly two colours is both the
// dither's own signature and the proof that it is a pattern, not a flat fill.
//
// Magma darkened by half: a pure hue at k = 0.5 halves its channels, and 189
// halves to 94.5 which rounds away from zero.
const DARK_MAGMA = [95, 0, 0, 255]

// Cell rows of the sample's liquid rooms. Cistern is plain at 50% over rows
// 0-2, so its surface lands mid-row-1; Magma Chamber is heated at 100%; Sump is
// the L, 60% over rows 4-8 with only its left column reaching rows 7 and 8.
const CISTERN_DRY = { y: 0.5, from: 8.3, to: 10.7 }
const CISTERN_WET = { y: 2.5, from: 8.3, to: 10.7 }
const CHAMBER = { y: 1.5, from: 12.3, to: 14.7 }
const SUMP_PRONG = { y: 7.5, from: 0.3, to: 0.7 }
const SUMP_NOTCH = { y: 7.5, from: 1.3, to: 2.7 }
const CAVERN = { y: 1.5, from: 0.3, to: 2.7 }

async function colorsAcross(
  page: Parameters<typeof colorsAlong>[0],
  grid: Awaited<ReturnType<typeof gridMapping>>,
  run: { y: number; from: number; to: number },
) {
  return colorsAlong(page, grid.at(run.from, run.y), grid.at(run.to, run.y))
}

test.describe('the paint rule for liquid', () => {
  test('paints below the surface as a dither and above it as the plain fill', async ({ page }) => {
    const { errors } = await openApp(page, 'heat-and-liquid')
    const grid = await gridMapping(page)

    const dry = await colorsAcross(page, grid, CISTERN_DRY)
    const wet = await colorsAcross(page, grid, CISTERN_WET)

    // One colour above the line, two below: the same room, split by the surface.
    expect(dry.map((seen) => seen.color)).toEqual([MAGMA])
    expect(wet).toHaveLength(2)
    expect(wet.map((seen) => seen.color).sort()).toEqual([MAGMA, DARK_MAGMA].sort())
    expect(errors).toEqual([])
  })

  // The checker is half one colour and half the other, so neither can be a
  // stray edge or an antialiased seam that happened to land in the run.
  test('divides the region about evenly between the two colours', async ({ page }) => {
    await openApp(page, 'heat-and-liquid')
    const grid = await gridMapping(page)

    const [most, least] = await colorsAcross(page, grid, CISTERN_WET)

    expect(least!.count / most!.count).toBeGreaterThan(0.5)
  })

  test('fills a room at level 100 entirely, with no plain row left', async ({ page }) => {
    const { errors } = await openApp(page, 'heat-and-liquid')
    const grid = await gridMapping(page)

    const chamber = await colorsAcross(page, grid, CHAMBER)

    expect(chamber).toHaveLength(2)
    expect(chamber.map((seen) => seen.color).sort()).toEqual([HOT_MAGMA, DARK_MAGMA].sort())
    expect(errors).toEqual([])
  })

  // The departure from the reference, and the one rule a pixel probe is the
  // only honest test of: both rooms are the same area, one heated and one not,
  // and only their light halves differ.
  test('leaves the dark half of the dither where heat cannot reach it', async ({ page }) => {
    await openApp(page, 'heat-and-liquid')
    const grid = await gridMapping(page)

    const plain = await colorsAcross(page, grid, CISTERN_WET)
    const heated = await colorsAcross(page, grid, CHAMBER)

    const darkOf = (seen: { color: number[] }[]) =>
      seen.find((one) => one.color.join() === DARK_MAGMA.join())
    expect(darkOf(plain), 'plain room dark half').toBeDefined()
    expect(darkOf(heated), 'heated room dark half').toBeDefined()

    // The light halves did move, so the two runs really are different rooms.
    expect(plain.map((seen) => seen.color)).toContainEqual(MAGMA)
    expect(heated.map((seen) => seen.color)).toContainEqual(HOT_MAGMA)
  })

  // The L. Both runs are inside the room's bounding box and below its surface;
  // only one of them is inside the room.
  test('clips to the room shape, leaving the notch of an L empty', async ({ page }) => {
    const { errors } = await openApp(page, 'heat-and-liquid')
    const grid = await gridMapping(page)

    const prong = await colorsAcross(page, grid, SUMP_PRONG)
    const notch = await colorsAcross(page, grid, SUMP_NOTCH)

    expect(prong.map((seen) => seen.color)).toContainEqual(DARK_MAGMA)
    expect(notch.map((seen) => seen.color)).not.toContainEqual(DARK_MAGMA)
    expect(notch.map((seen) => seen.color)).not.toContainEqual(MAGMA)
    expect(errors).toEqual([])
  })

  test('leaves a room at level 0 undithered', async ({ page }) => {
    await openApp(page, 'heat-and-liquid')
    const grid = await gridMapping(page)

    expect((await colorsAcross(page, grid, CAVERN)).map((seen) => seen.color)).toEqual([MAGMA])
  })
})

// Cavern's floor row. It is the room the paint rule reads as one flat colour,
// which is what makes "two colours are in it now" a statement about the drag.
const CAVERN_FLOOR = { y: 2.5, from: 0.3, to: 2.7 }

// The live half of the control: the canvas has to show the level before the
// button comes up, because nothing publishes mid-drag and the panel owns no
// `draw()`. Only a real pointer proves it: the repaint is asked for on the
// samples between pointerdown and pointerup, and there is no other moment.
test.describe('the liquid slider while it is being dragged', () => {
  test('dithers the room before the button is released, and undithers it on Escape', async ({
    page,
  }) => {
    const { errors } = await openApp(page, 'heat-and-liquid')
    const grid = await gridMapping(page)
    const inspector = page.locator('[data-panel-id="inspector"]')

    await page.keyboard.press('2')
    const centre = grid.at(IN_CAVERN.x, IN_CAVERN.y)
    await page.mouse.click(centre.x, centre.y)

    const slider = inspector.getByLabel('Liquid level', { exact: true })
    await expect(slider).toHaveValue('0')
    expect(
      (await colorsAcross(page, grid, CAVERN_FLOOR)).map((seen) => seen.color),
    ).not.toContainEqual(DARK_MAGMA)

    // Pressing the middle of the track is a drag whose first sample is half.
    const track = (await slider.boundingBox())!
    await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2)
    await page.mouse.down()

    // Still down: the dither is on the canvas with nothing committed.
    await expect
      .poll(async () => (await colorsAcross(page, grid, CAVERN_FLOOR)).map((seen) => seen.color))
      .toContainEqual(DARK_MAGMA)

    await page.keyboard.press('Escape')
    await expect
      .poll(async () => (await colorsAcross(page, grid, CAVERN_FLOOR)).map((seen) => seen.color))
      .not.toContainEqual(DARK_MAGMA)

    await page.mouse.up()
    await expect(slider).toHaveValue('0')
    expect(errors).toEqual([])
  })
})

// The suite's default ratio, where the file above runs at twice it. The square
// is a device-pixel size and the pattern is anchored in device pixels, so a
// renderer that dropped the ratio would still look right at one of the two.
test.describe('the paint rule for liquid on an ordinary display', () => {
  test.use({ deviceScaleFactor: 1 })

  test('dithers below the surface and not above it', async ({ page }) => {
    const { errors } = await openApp(page, 'heat-and-liquid')
    const grid = await gridMapping(page)

    const dry = await colorsAcross(page, grid, CISTERN_DRY)
    const wet = await colorsAcross(page, grid, CISTERN_WET)

    expect(dry.map((seen) => seen.color)).toEqual([MAGMA])
    expect(wet).toHaveLength(2)
    expect(wet.map((seen) => seen.color).sort()).toEqual([MAGMA, DARK_MAGMA].sort())
    expect(errors).toEqual([])
  })
})
