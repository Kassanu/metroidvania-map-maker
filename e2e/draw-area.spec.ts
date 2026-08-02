import { test, expect } from '@playwright/test'
import { openApp, gridMapping } from './support/canvas'

// The dev seed's frozen fixture has a user-created area besides World, so the
// picker has something real to offer without this test needing a way to create
// one: areas are created in the Hierarchy, and the picker only picks.

test.describe('Draw mode area picker', () => {
  test('lists the project’s areas, World first', async ({ page }) => {
    const { errors } = await openApp(page)
    const picker = page.locator('.area-select')

    const options = await picker.locator('option').allTextContents()
    expect(options.length).toBeGreaterThan(1)
    expect(options[0]).toBe('World')
    // Areas are created in the Hierarchy, so nothing here offers to make one.
    expect(options.join(' ')).not.toContain('New area')
    expect(errors).toEqual([])
  })

  test('a room drawn after picking an area takes its colour', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const picker = page.locator('.area-select')

    // Sample the canvas where a new room is about to go, before and after.
    const spot = grid.at(12.5, 8.5)
    const pixelAt = async (x: number, y: number) =>
      page.evaluate(
        ([px, py]) => {
          const canvas = document.querySelector('.canvas') as HTMLCanvasElement
          const box = canvas.getBoundingClientRect()
          const ratio = canvas.width / box.width
          const ctx = canvas.getContext('2d')!
          const data = ctx.getImageData(
            Math.round((px - box.left) * ratio),
            Math.round((py - box.top) * ratio),
            1,
            1,
          ).data
          return `${data[0]},${data[1]},${data[2]}`
        },
        [x, y],
      )

    const empty = await pixelAt(spot.x, spot.y)

    // Pick the first area that is not World.
    const values = await picker
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
    await picker.selectOption(values[1])

    await page.mouse.move(spot.x, spot.y)
    await page.mouse.down()
    await page.mouse.move(spot.x + grid.cellPx, spot.y + grid.cellPx, { steps: 6 })
    await page.mouse.up()

    const painted = await pixelAt(spot.x, spot.y)
    expect(painted).not.toBe(empty)

    // And it is the area's colour, not the default room fill that a World
    // room would have given. Drawn far away so the two do not merge.
    await picker.selectOption(values[0])
    const worldSpot = grid.at(12.5, 12.5)
    await page.mouse.move(worldSpot.x, worldSpot.y)
    await page.mouse.down()
    await page.mouse.move(worldSpot.x + grid.cellPx, worldSpot.y + grid.cellPx, { steps: 6 })
    await page.mouse.up()

    expect(await pixelAt(worldSpot.x, worldSpot.y)).not.toBe(painted)
    expect(errors).toEqual([])
  })

  // Growing an existing room keeps its own area, so the picker cannot re-paper
  // what you already drew.
  test('growing a room does not move it into the picked area', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const picker = page.locator('.area-select')

    const pixelAt = async (x: number, y: number) =>
      page.evaluate(
        ([px, py]) => {
          const canvas = document.querySelector('.canvas') as HTMLCanvasElement
          const box = canvas.getBoundingClientRect()
          const ratio = canvas.width / box.width
          const ctx = canvas.getContext('2d')!
          const data = ctx.getImageData(
            Math.round((px - box.left) * ratio),
            Math.round((py - box.top) * ratio),
            1,
            1,
          ).data
          return `${data[0]},${data[1]},${data[2]}`
        },
        [x, y],
      )

    // The fixture's "Landing Site" fills (0,0)-(2,2) and is in World.
    const inside = grid.at(1.5, 1.5)
    const before = await pixelAt(inside.x, inside.y)

    const values = await picker
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
    await picker.selectOption(values[1])

    // Drag from inside the room out onto empty grid: a grow, not a new room.
    await page.mouse.move(inside.x, inside.y)
    await page.mouse.down()
    await page.mouse.move(inside.x + grid.cellPx * 4, inside.y, { steps: 10 })
    await page.mouse.up()

    expect(await pixelAt(inside.x, inside.y)).toBe(before)
    expect(errors).toEqual([])
  })
})
