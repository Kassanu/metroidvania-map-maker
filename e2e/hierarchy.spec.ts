import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { openApp, gridMapping, undoLabel, type GridMapping } from './support/canvas'

// The tree in a real browser: that it is mounted in the left sidebar, lists the
// seed's areas and rooms, and follows a selection made on the canvas.
//
// The seam this covers is the one jsdom cannot: the tree and the canvas are
// wired together only through the store, in the assembled app.

// Inside the dev seed's first room, and bare grid well clear of every room.
const IN_A_ROOM = { x: 1.5, y: 0.5 }
const BARE_GRID = { x: 9.5, y: 3.5 }

async function clickAt(page: Page, grid: GridMapping, world: { x: number; y: number }) {
  const point = grid.at(world.x, world.y)
  await page.mouse.click(point.x, point.y)
}

test.describe('Hierarchy', () => {
  test('lists the seed’s areas with their rooms under them', async ({ page }) => {
    const { errors } = await openApp(page)
    const tree = page.locator('[data-panel-id="hierarchy"] [role="tree"]')

    await expect(tree).toBeVisible()
    await expect(tree.getByRole('treeitem', { name: 'Crateria' })).toBeVisible()
    await expect(tree.getByRole('treeitem', { name: 'Landing Site' })).toBeVisible()

    // Areas are project-wide, so both show on the tab that holds only one of
    // their rooms.
    await page.getByRole('tab', { name: 'Caves' }).click()
    await expect(tree.getByRole('treeitem', { name: 'Crateria' })).toBeVisible()
    await expect(tree.getByRole('treeitem', { name: 'Landing Site' })).toHaveCount(0)
    await expect(tree.getByRole('treeitem', { name: 'Vault' })).toBeVisible()
    expect(errors).toEqual([])
  })

  test('marks the room selected on the canvas', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const tree = page.locator('[data-panel-id="hierarchy"] [role="tree"]')
    const row = tree.getByRole('treeitem', { name: 'Landing Site' })

    await expect(row).toHaveAttribute('aria-selected', 'false')

    await page.keyboard.press('2')
    await clickAt(page, grid, IN_A_ROOM)

    await expect(row).toHaveAttribute('aria-selected', 'true')

    await clickAt(page, grid, BARE_GRID)
    await expect(row).toHaveAttribute('aria-selected', 'false')
    expect(errors).toEqual([])
  })

  test('collapses an area, hiding its rooms', async ({ page }) => {
    const { errors } = await openApp(page)
    const tree = page.locator('[data-panel-id="hierarchy"] [role="tree"]')

    await tree.getByRole('button', { name: 'Collapse Crateria' }).click()

    await expect(tree.getByRole('treeitem', { name: 'Landing Site' })).toHaveCount(0)
    await expect(tree.getByRole('treeitem', { name: 'Crateria' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(errors).toEqual([])
  })

  test('filters the tree, and clearing restores it', async ({ page }) => {
    const { errors } = await openApp(page)
    const tree = page.locator('[data-panel-id="hierarchy"] [role="tree"]')
    const filter = page.locator('[data-panel-id="hierarchy"] .hierarchy-filter')

    // "Corridor" is in World, not Crateria, so filtering to it drops the whole
    // Crateria branch: a matching room keeps its own area and no other.
    await filter.fill('corr')
    await expect(tree.getByRole('treeitem', { name: 'Corridor' })).toBeVisible()
    await expect(tree.getByRole('treeitem', { name: 'Landing Site' })).toHaveCount(0)
    await expect(tree.getByRole('treeitem', { name: 'World' })).toBeVisible()
    await expect(tree.getByRole('treeitem', { name: 'Crateria' })).toHaveCount(0)

    await filter.fill('')
    await expect(tree.getByRole('treeitem', { name: 'Landing Site' })).toBeVisible()
    expect(errors).toEqual([])
  })

  test('adds an area from the header, as one undo step', async ({ page }) => {
    const { errors } = await openApp(page)
    const tree = page.locator('[data-panel-id="hierarchy"] [role="tree"]')

    await page.locator('[data-panel-id="hierarchy"] .hierarchy-add').click()

    await expect(tree.getByRole('treeitem', { name: 'Area 1' })).toBeVisible()
    expect(await undoLabel(page)).toBe('Undo Add Area')

    // The Draw toolbar picks from the same list, so a new area is immediately
    // paintable rather than needing a reload.
    await page.keyboard.press('1')
    await expect(page.locator('#draw-area')).toContainText('Area 1')
    expect(errors).toEqual([])
  })

  test('selects a room from the tree, and the canvas and Inspector follow', async ({ page }) => {
    const { errors } = await openApp(page)
    const tree = page.locator('[data-panel-id="hierarchy"] [role="tree"]')
    const inspector = page.locator('[data-panel-id="inspector"]')

    await tree.getByRole('treeitem', { name: 'Landing Site' }).click()

    await expect(inspector.getByLabel('Name', { exact: true })).toHaveValue('Landing Site')
    // Selecting from the tree never changes the mode: Draw is still Draw.
    await expect(page.locator('.activity-bar .mode-button.active')).toHaveAttribute('title', /Draw/)
    expect(errors).toEqual([])
  })

  test('shift-click in the tree builds a multi-selection', async ({ page }) => {
    const { errors } = await openApp(page)
    const tree = page.locator('[data-panel-id="hierarchy"] [role="tree"]')
    const inspector = page.locator('[data-panel-id="inspector"]')

    await tree.getByRole('treeitem', { name: 'Landing Site' }).click()
    await tree.getByRole('treeitem', { name: 'West Wing' }).click({ modifiers: ['Shift'] })

    await expect(inspector.getByText('2 selected')).toBeVisible()
    await expect(tree.getByRole('treeitem', { name: 'Landing Site' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(errors).toEqual([])
  })

  // Areas have no canvas body beyond their bbox border, so the tree is the only
  // surface that can put one in the selection.
  test('selects an area, which opens its own inspector', async ({ page }) => {
    const { errors } = await openApp(page)
    const tree = page.locator('[data-panel-id="hierarchy"] [role="tree"]')
    const inspector = page.locator('[data-panel-id="inspector"]')

    await tree.getByRole('treeitem', { name: 'Crateria' }).click()

    await expect(inspector.getByLabel('Name', { exact: true })).toHaveValue('Crateria')
    await expect(inspector.getByLabel('Cell color', { exact: true })).toBeVisible()
    expect(errors).toEqual([])
  })

  test('locks World, and says why', async ({ page }) => {
    const { errors } = await openApp(page)
    const tree = page.locator('[data-panel-id="hierarchy"] [role="tree"]')
    const inspector = page.locator('[data-panel-id="inspector"]')

    await tree.getByRole('treeitem', { name: 'World' }).click()

    await expect(inspector.getByLabel('Name', { exact: true })).toBeDisabled()
    await expect(inspector.getByLabel('Cell color', { exact: true })).toBeDisabled()
    await expect(inspector.getByText(/World cannot be renamed/)).toBeVisible()
    expect(errors).toEqual([])
  })

  test('renames a room from the tree, and the Inspector follows', async ({ page }) => {
    const { errors } = await openApp(page)
    const tree = page.locator('[data-panel-id="hierarchy"] [role="tree"]')
    const inspector = page.locator('[data-panel-id="inspector"]')

    const row = tree.getByRole('treeitem', { name: 'Landing Site' })
    await row.click()
    await row.dblclick()

    const editor = tree.locator('.hierarchy-rename')
    await editor.fill('Ship Deck')
    await editor.press('Enter')

    expect(await undoLabel(page)).toBe('Undo Rename Room')
    await expect(tree.getByRole('treeitem', { name: 'Ship Deck' })).toBeVisible()
    await expect(inspector.getByLabel('Name', { exact: true })).toHaveValue('Ship Deck')
    expect(errors).toEqual([])
  })

  test('the + button creates an area already waiting to be named', async ({ page }) => {
    const { errors } = await openApp(page)
    const tree = page.locator('[data-panel-id="hierarchy"] [role="tree"]')

    await page.locator('[data-panel-id="hierarchy"] .hierarchy-add').click()

    const editor = tree.locator('.hierarchy-rename')
    await expect(editor).toBeFocused()
    await editor.fill('Tourian')
    await editor.press('Enter')

    await expect(tree.getByRole('treeitem', { name: 'Tourian' })).toBeVisible()
    // The Draw toolbar lists it under its chosen name, not the default.
    await page.keyboard.press('1')
    await expect(page.locator('#draw-area')).toContainText('Tourian')
    expect(errors).toEqual([])
  })

  test('World cannot be renamed from the tree', async ({ page }) => {
    const { errors } = await openApp(page)
    const tree = page.locator('[data-panel-id="hierarchy"] [role="tree"]')

    await tree.getByRole('treeitem', { name: 'World' }).dblclick()

    await expect(tree.locator('.hierarchy-rename')).toHaveCount(0)
    expect(errors).toEqual([])
  })
})
