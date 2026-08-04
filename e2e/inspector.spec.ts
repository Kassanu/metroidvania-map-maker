import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { openApp, gridMapping, undoLabel, type GridMapping } from './support/canvas'

// The colour the map canvas has at a screen point, in backing-store pixels.
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

// The Inspector in a real browser: that it is mounted in the right sidebar,
// that a canvas selection reaches it, and that a field commits back through
// the same undo stack every other edit uses.
//
// The seam this covers is the one jsdom cannot: the panel and the canvas are
// wired together only in the assembled app.

// Inside the dev seed's first room, and bare grid well clear of every room.
const IN_A_ROOM = { x: 1.5, y: 0.5 }
const BARE_GRID = { x: 9.5, y: 3.5 }
// The dev seed's one icon, and the point its label chip draws through.
const THE_ICON = { x: 1.5, y: 1.5 }
const ICON_LABEL_CHIP = { x: 1.5, y: 1.92 }

async function clickAt(page: Page, grid: GridMapping, world: { x: number; y: number }) {
  const point = grid.at(world.x, world.y)
  await page.mouse.click(point.x, point.y)
}

test.describe('Inspector', () => {
  test('shows nothing until something is selected, then the room', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const inspector = page.locator('[data-panel-id="inspector"]')

    await expect(inspector).toBeVisible()
    await expect(inspector.locator('input')).toHaveCount(0)

    await page.keyboard.press('2')
    await clickAt(page, grid, IN_A_ROOM)

    await expect(inspector.getByLabel('Name', { exact: true })).toBeVisible()
    await expect(inspector.getByLabel('Area', { exact: true })).toHaveValue(/.+/)

    await clickAt(page, grid, BARE_GRID)
    await expect(inspector.locator('input')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('renames the selected room, as one undo step', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const inspector = page.locator('[data-panel-id="inspector"]')

    await page.keyboard.press('2')
    await clickAt(page, grid, IN_A_ROOM)

    // Deliberately not a name the dev fixture already uses: committing a
    // field to the value it already holds is a no-op, which would make this
    // pass whether or not the commit path works.
    const name = inspector.getByLabel('Name', { exact: true })
    const original = await name.inputValue()
    await name.fill('Wrecked Ship')
    await name.press('Enter')

    expect(await undoLabel(page)).toBe('Undo Rename Room')
    await page.keyboard.press('Control+z')
    await expect(name).toHaveValue(original)
    expect(errors).toEqual([])
  })

  test('counts a multi-selection instead of showing fields', async ({ page }) => {
    const { errors } = await openApp(page)
    const inspector = page.locator('[data-panel-id="inspector"]')

    await page.keyboard.press('2')
    await page.keyboard.press('Control+a')

    await expect(inspector.getByText(/\d+ selected/)).toBeVisible()
    await expect(inspector.locator('input')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('writes an icon label that the canvas draws', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const inspector = page.locator('[data-panel-id="inspector"]')

    // The seed's icon already carries a label, and All Labels is what makes it
    // visible without hovering.
    await page.getByRole('button', { name: 'View' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'All Labels' }).click()
    await page.keyboard.press('Escape')

    const chip = grid.at(ICON_LABEL_CHIP.x, ICON_LABEL_CHIP.y)
    const labelled = await pixelAt(page, chip)

    await page.keyboard.press('4')
    await clickAt(page, grid, THE_ICON)
    const label = inspector.getByLabel('Label', { exact: true })
    await expect(label).toHaveValue('Save Point')

    // Clearing is allowed for a label where it is refused for a name, and an
    // empty label draws no chip at all.
    await label.fill('')
    await label.press('Enter')

    expect(await undoLabel(page)).toBe('Undo Edit Icon Label')
    await expect.poll(() => pixelAt(page, chip)).not.toEqual(labelled)
    expect(errors).toEqual([])
  })

  test('recolours an icon, and the canvas repaints it', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const inspector = page.locator('[data-panel-id="inspector"]')

    await page.keyboard.press('4')
    await clickAt(page, grid, THE_ICON)

    await expect(inspector.getByLabel('Plate', { exact: true })).toBeVisible()
    const glyph = inspector.getByLabel('Glyph', { exact: true })

    // The glyph is what the badge's own centre draws, so that is the fill this
    // probe can actually see change.
    const badge = grid.at(THE_ICON.x, THE_ICON.y)
    const before = await pixelAt(page, badge)

    await glyph.evaluate((input: HTMLInputElement) => {
      input.value = '#ff00ff'
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(await undoLabel(page)).toBe('Undo Change Icon Colors')
    await expect.poll(() => pixelAt(page, badge)).not.toEqual(before)
    expect(errors).toEqual([])
  })

  test('restyles a line, committing the colour once', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const inspector = page.locator('[data-panel-id="inspector"]')

    await page.keyboard.press('4')
    await clickAt(page, grid, { x: 0.5, y: 4.5 })

    await expect(inspector.getByLabel('Color', { exact: true })).toBeVisible()

    // The seed's line already has its end arrow on, and checking a checked box
    // commits nothing: the toggle that can change is the start.
    const startArrow = inspector.getByLabel('Arrow at start', { exact: true })
    await expect(startArrow).not.toBeChecked()
    await startArrow.check()

    expect(await undoLabel(page)).toBe('Undo Change Line Arrows')
    expect(errors).toEqual([])
  })
})
