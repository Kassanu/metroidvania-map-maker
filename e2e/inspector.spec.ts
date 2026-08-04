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

  test('inspects a door, names both rooms, and reverses it', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const inspector = page.locator('[data-panel-id="inspector"]')

    // The seed's two-segment door on the seam at x = 3, between "Landing Site"
    // and "Corridor". Door mode selects a transition on click.
    await page.keyboard.press('3')
    const seam = grid.at(3, 0.5)
    await page.mouse.click(seam.x, seam.y)

    await expect(inspector.getByTestId('transition-kind')).toHaveText('Door')
    await expect(inspector.getByTestId('transition-end-a')).toHaveText('Landing Site')
    await expect(inspector.getByTestId('transition-end-b')).toHaveText('Corridor')

    const direction = inspector.getByLabel('Direction', { exact: true })
    await expect(direction).toHaveValue('both')
    await direction.selectOption('bToA')

    expect(await undoLabel(page)).toBe('Undo Change Direction')
    // A stays A: the whole reason direction is stored rather than encoded as
    // endpoint order.
    await expect(inspector.getByTestId('transition-end-a')).toHaveText('Landing Site')
    expect(errors).toEqual([])
  })

  test('edits a cross-tab teleport from the tab that only draws its far end', async ({ page }) => {
    const { errors } = await openApp(page)
    const inspector = page.locator('[data-panel-id="inspector"]')

    // The seed's teleport runs Surface (0,2) -> Caves (1,1). Selecting it from
    // Caves reaches an object that map does not store.
    await page.getByRole('tab', { name: 'Caves' }).click()
    const grid = await gridMapping(page)
    await page.keyboard.press('3')
    const farEnd = grid.at(1.5, 1.5)
    await page.mouse.click(farEnd.x, farEnd.y)

    await expect(inspector.getByTestId('transition-kind')).toHaveText('Teleport')
    // The near end is on Surface, so it names the map as well as the room.
    await expect(inspector.getByTestId('transition-end-a')).toContainText('Surface')

    await inspector.getByLabel('Direction', { exact: true }).selectOption('aToB')
    expect(await undoLabel(page)).toBe('Undo Change Direction')
    expect(errors).toEqual([])
  })

  test('opens a door with differing ends unsynced, and re-syncing copies A onto B', async ({
    page,
  }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const inspector = page.locator('[data-panel-id="inspector"]')

    await page.keyboard.press('3')
    const seam = grid.at(3, 0.5)
    await page.mouse.click(seam.x, seam.y)

    // The seed's door is deliberately asymmetric: a missile door on the A side,
    // open on the B side. One dropdown over two different locks would show a
    // value neither end has, so the panel opens with the pair split.
    const sync = inspector.getByLabel('Same lock at both ends', { exact: true })
    await expect(sync).not.toBeChecked()
    await expect(inspector.getByLabel('Lock at A', { exact: true })).toHaveValue('lock_01')
    await expect(inspector.getByLabel('Lock at B', { exact: true })).toHaveValue('open')
    await expect(inspector.getByLabel('Lock', { exact: true })).toBeHidden()

    // Turning it on makes the claim true rather than just displaying it.
    await sync.check()

    expect(await undoLabel(page)).toBe('Undo Change Lock')
    const single = inspector.getByLabel('Lock', { exact: true })
    await expect(single).toBeVisible()
    await expect(single).toHaveValue('lock_01')
    expect(errors).toEqual([])
  })
})
