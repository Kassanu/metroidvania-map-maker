import { test, expect } from '@playwright/test'
import { gridMapping, openApp, undoLabel } from './support/canvas'
import type { Page } from '@playwright/test'

// Door mode's shell: what a press resolves to, said in the only way the user can
// see it before the gestures land: the cursor, and the guarantee that nothing
// else happens yet.
//
// The dev fixture's Surface map is the fixture here: "Landing Site" fills
// (0,0)-(2,2) and "Corridor" (3,0)-(4,1), with a 2-segment door on the seam at
// x = 3, a cross-tab teleport endpoint at (0,2), and empty grid beyond.

// Through the keyboard, not the activity bar, and that matters for more than
// brevity: clicking a mode button moves the pointer off the canvas, which fires
// `pointerleave` and clears the hover. The keyboard is the only way to change
// mode with the pointer still over the map, which is the case the cursor has
// to catch up on.
async function enterDoorMode(page: Page) {
  await page.keyboard.press('3')
}

async function enterDrawMode(page: Page) {
  await page.keyboard.press('1')
}

test.describe('Door mode shell', () => {
  test('the cursor names the row under the pointer', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const viewport = page.locator('.canvas-viewport')
    await enterDoorMode(page)

    // A room cell with nothing on it: both creation gestures start here.
    await page.mouse.move(grid.at(1.5, 0.5).x, grid.at(1.5, 0.5).y)
    await expect(viewport).toHaveCSS('cursor', 'crosshair')

    // The door on the seam at x = 3, which selects rather than creates.
    const seam = grid.at(3, 0.5)
    await page.mouse.move(seam.x, seam.y)
    await expect(viewport).toHaveCSS('cursor', 'pointer')

    // A teleport endpoint, hit through the cell interior.
    await page.mouse.move(grid.at(0.5, 2.5).x, grid.at(0.5, 2.5).y)
    await expect(viewport).toHaveCSS('cursor', 'pointer')

    // Bare grid: nothing starts here, so nothing offers.
    await page.mouse.move(grid.at(9.5, 9.5).x, grid.at(9.5, 9.5).y)
    await expect(viewport).toHaveCSS('cursor', 'auto')
    expect(errors).toEqual([])
  })

  // The same seam is an edge-run handle in Draw mode. Two modes reading two
  // tables over one pixel, which is the thing most likely to leak.
  test('the same pixel reads differently in Draw mode', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const viewport = page.locator('.canvas-viewport')
    const seam = grid.at(3, 0.5)

    await page.mouse.move(seam.x, seam.y)
    await expect(viewport).toHaveCSS('cursor', 'ew-resize')

    await enterDoorMode(page)
    await expect(viewport).toHaveCSS('cursor', 'pointer')

    // And back, because a mode that left its cursor behind would look identical
    // to one that never had it.
    await enterDrawMode(page)
    await expect(viewport).toHaveCSS('cursor', 'ew-resize')
    expect(errors).toEqual([])
  })

  // Switching modes changes what the pointer is over without the pointer moving.
  test('the cursor catches up when the mode changes under a still pointer', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const viewport = page.locator('.canvas-viewport')

    const inside = grid.at(1.5, 0.5)
    await page.mouse.move(inside.x, inside.y)
    await expect(viewport).toHaveCSS('cursor', 'auto')

    await enterDoorMode(page)
    await expect(viewport).toHaveCSS('cursor', 'crosshair')
    expect(errors).toEqual([])
  })

  // The risk to catch is a press falling through to Draw mode and painting
  // instead of doing nothing.
  test('presses do nothing at all, on grid or on a room', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    for (const [x, y] of [
      [9.5, 9.5], // bare grid
      [1.5, 0.5], // a room cell
      [3, 0.5], // the door's edge
    ]) {
      const point = grid.at(x, y)
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      await page.mouse.move(point.x + grid.cellPx * 2, point.y, { steps: 6 })
      await page.mouse.up()
    }

    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  // Right-click is the erase column, and on a bare room cell it does nothing:
  // in particular it must not fall through to Draw mode's erase, which would
  // eat a room.
  test('a right-press on a bare room cell erases nothing', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    const inside = grid.at(1.5, 0.5)
    await page.mouse.move(inside.x, inside.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.up({ button: 'right' })

    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })
})

// The box drag: click a room cell and drag out a rectangular box, classified
// on release into a door, an elevator, or nothing at all.
//
// The dev fixture's Surface map: "Landing Site" fills (0,0)-(2,2) and
// "Corridor" (3,0)-(4,1), sharing the seam at x = 3 whose two segments both
// already carry a door. Further down, "West Wing" (0,5)-(1,6) and "East Wing"
// (5,5)-(6,6) face each other across a three-cell gap on rows 5 and 6.
test.describe('Door mode box drag', () => {
  // Drag from the centre of one cell to the centre of another.
  async function dragBox(
    page: Page,
    grid: Awaited<ReturnType<typeof gridMapping>>,
    from: [number, number],
    to: [number, number],
  ) {
    const start = grid.at(from[0] + 0.5, from[1] + 0.5)
    const end = grid.at(to[0] + 0.5, to[1] + 0.5)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()
  }

  // That it classifies into a door or an elevator is `boxDrag.test.ts`'s job,
  // where the created object can be read. What only a browser can show is that
  // the whole drag reaches a commit through real pointer capture and lands as
  // exactly one step, which is why both of these undo once and check the stack
  // is back where it started.
  test('a box across a seam commits, as one undo step', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    // The seam between "Sub Level" (0,9)-(2,10) and "Annex" (3,9)-(3,10). Its
    // lower segment carries a door already; this drag makes one on the upper.
    await dragBox(page, grid, [2, 9], [3, 9])
    expect(await undoLabel(page)).toBe('Undo Add Transition')

    await page.keyboard.press('Control+z')
    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  test('a 1-thick box across a gap commits, as one undo step', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    // Row 6 between West Wing (1,6) and East Wing (5,6): a three-cell gap, and
    // no elevator there yet: the fixture's horizontal one is on row 5.
    await dragBox(page, grid, [1, 6], [5, 6])
    expect(await undoLabel(page)).toBe('Undo Add Transition')

    await page.keyboard.press('Control+z')
    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  // An invalid box cancels: nothing is committed, so nothing reaches the stack.
  test('an invalid box commits nothing', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    // Into the gap but not across it: no second room, so nothing connects.
    await dragBox(page, grid, [1, 6], [3, 6])

    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  // Returning to the origin is a no-op and leaves no undo step behind: the
  // transaction ends up empty and the seam drops it.
  test('out and back to the origin leaves nothing', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    const start = grid.at(2.5, 9.5)
    const away = grid.at(3.5, 9.5)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(away.x, away.y, { steps: 6 })
    await page.mouse.move(start.x, start.y, { steps: 6 })
    await page.mouse.up()

    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  test('Esc abandons the box mid-drag', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    const start = grid.at(2.5, 9.5)
    const end = grid.at(3.5, 9.5)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 6 })
    await page.keyboard.press('Escape')
    await page.mouse.up()

    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  // A press that never leaves its cell is a click, which belongs to the teleport
  // gesture, so it must make no transition, and in particular no elevator or
  // door. What it does do is covered below.
  test('a click without a drag commits no door or elevator', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    const spot = grid.at(2.5, 9.5)
    await page.mouse.move(spot.x, spot.y)
    await page.mouse.down()
    await page.mouse.up()

    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })
})

// The teleport's two-click gesture, the only interaction in the app that
// outlives the pointer that started it.
//
// The state machine is unit-tested; what only a browser shows is that two real
// clicks separated by a real tab switch reach a commit, and that the prompt is
// on screen in between, which is the whole of the pending state from the user's
// side.
test.describe('Door mode teleport', () => {
  const prompt = (page: Page) => page.locator('.pending-prompt')

  // Landing Site fills (0,0)-(2,2) with teleport endpoints already at (0,2) and
  // (2,2); Corridor is (3,0)-(4,1). So (1,1) and (4,1) are two free cells in two
  // different rooms.
  async function click(
    page: Page,
    grid: Awaited<ReturnType<typeof gridMapping>>,
    x: number,
    y: number,
  ) {
    const point = grid.at(x + 0.5, y + 0.5)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.up()
  }

  test('two clicks in two rooms make a teleport, as one undo step', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    await click(page, grid, 1, 1)
    // Nothing committed yet, and the app says so.
    await expect(prompt(page)).toBeVisible()
    expect(await undoLabel(page)).toBe(before)

    await click(page, grid, 4, 1)
    await expect(prompt(page)).toBeHidden()
    expect(await undoLabel(page)).toBe('Undo Add Teleport')

    await page.keyboard.press('Control+z')
    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  // An invalid second click is ignored: the gesture stays pending, and a
  // misclick never forces a restart.
  test('a misclick is ignored and the gesture stays pending', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    await click(page, grid, 1, 1)
    // Bare grid, then the origin's own room: both invalid second clicks.
    await click(page, grid, 9, 9)
    await expect(prompt(page)).toBeVisible()
    await click(page, grid, 0, 0)
    await expect(prompt(page)).toBeVisible()
    expect(await undoLabel(page)).toBe(before)

    // Still live: a good click still completes.
    await click(page, grid, 4, 1)
    expect(await undoLabel(page)).toBe('Undo Add Teleport')
    expect(errors).toEqual([])
  })

  test('Esc cancels it, and so does leaving Door mode', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    await click(page, grid, 1, 1)
    await page.keyboard.press('Escape')
    await expect(prompt(page)).toBeHidden()

    await click(page, grid, 1, 1)
    await enterDrawMode(page)
    await expect(prompt(page)).toBeHidden()

    // Neither cancel left anything behind: canceling discards the pending
    // state, so there is nothing to undo.
    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  // Switching and creating tabs is allowed while a teleport is pending, and the
  // result is stored once, under its origin map, so a single Ctrl+Z on the
  // origin tab takes the whole thing away.
  test('spans a tab switch, and one undo removes it whole', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    await click(page, grid, 1, 1)

    // The Caves tab. Its "Vault" room fills (0,0)-(1,1), and (1,1) already holds
    // the fixture's cross-tab far end, so (0,0) is the free cell here.
    await page.locator('.tab', { hasText: 'Caves' }).click()
    await expect(prompt(page)).toBeVisible()

    const caves = await gridMapping(page)
    await click(page, caves, 0, 0)
    await expect(prompt(page)).toBeHidden()
    expect(await undoLabel(page)).toBe('Undo Add Teleport')

    // One step for the whole thing: the very next entry down is the tab switch
    // that happened between the two clicks, so nothing about the destination
    // end was recorded separately.
    await page.keyboard.press('Control+z')
    expect(await undoLabel(page)).toBe('Undo Switch Tab')
    await page.keyboard.press('Control+z')
    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  // The click-vs-drag rule, in the one place a browser can settle it: the
  // native `click` event fires for a drag that ends where it began, so wiring the
  // teleport to it would leave one pending after every abandoned box drag.
  test('a drag out and back is not a click', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)

    const start = grid.at(1.5, 1.5)
    const away = grid.at(4.5, 1.5)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(away.x, away.y, { steps: 6 })
    await page.mouse.move(start.x, start.y, { steps: 6 })
    await page.mouse.up()

    await expect(prompt(page)).toBeHidden()
    expect(errors).toEqual([])
  })
})

// The Erase column: delete a transition, do nothing on anything else. A
// browser is where the two routes that only exist as real input can be
// checked: the right button, and the toolbar toggle that touch depends on
// because it has neither of the other two.
test.describe('Door mode delete', () => {
  async function rightClick(
    page: Page,
    grid: Awaited<ReturnType<typeof gridMapping>>,
    x: number,
    y: number,
  ) {
    const point = grid.at(x, y)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.up({ button: 'right' })
  }

  // All three kinds, each reached through its own zone: a door and an elevator
  // end by their edge, a teleport by its cell interior.
  test('right-click deletes a door, an elevator and a teleport', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    // The 2-segment missile door on the seam at x = 3.
    await rightClick(page, grid, 3, 0.5)
    expect(await undoLabel(page)).toBe('Undo Delete Transition')

    // The horizontal elevator on row 5: its A end faces east off West Wing, at
    // the edge x = 2.
    await rightClick(page, grid, 2, 5.5)
    expect(await undoLabel(page)).toBe('Undo Delete Transition')

    // The cross-tab teleport's endpoint at (0,2), through the cell interior.
    await rightClick(page, grid, 0.5, 2.5)
    expect(await undoLabel(page)).toBe('Undo Delete Transition')

    // Three deletions, three steps, all reversible.
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  test('right-click on bare grid and on a plain room cell deletes nothing', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    await rightClick(page, grid, 9.5, 9.5)
    await rightClick(page, grid, 1.5, 1.5)

    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  // The toggle, which is the only erase route a touch device has.
  test('the erase toggle makes a left click delete', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    await page.getByRole('button', { name: 'Erase' }).click()

    const seam = grid.at(3, 0.5)
    await page.mouse.move(seam.x, seam.y)
    await page.mouse.down()
    await page.mouse.up()
    expect(await undoLabel(page)).toBe('Undo Delete Transition')

    await page.keyboard.press('Control+z')
    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  // With the erase toggle on, the drag that would otherwise make a door must
  // make nothing instead.
  test('the erase toggle switches the box drag off', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    await page.getByRole('button', { name: 'Erase' }).click()
    const before = await undoLabel(page)

    // The seam between Sub Level and Annex, whose upper segment has no door:
    // the drag that makes one in the box-drag suite above.
    const start = grid.at(2.5, 9.5)
    const end = grid.at(3.5, 9.5)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()

    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  // A cross-tab teleport is stored under its origin map and the destination
  // tab's marker is derived, so deleting from there has to reach across.
  test('deletes a cross-tab teleport from its far end', async ({ page }) => {
    const { errors } = await openApp(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    // Caves holds the far end of the fixture's cross-tab teleport, at (1,1).
    await page.locator('.tab', { hasText: 'Caves' }).click()
    const caves = await gridMapping(page)
    await rightClick(page, caves, 1.5, 1.5)

    expect(await undoLabel(page)).toBe('Undo Delete Transition')

    await page.keyboard.press('Control+z')
    // Back to the tab switch that got us here: the deletion was one step, and
    // undo left us on the tab we deleted from.
    expect(await undoLabel(page)).toBe('Undo Switch Tab')
    await page.keyboard.press('Control+z')
    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })
})

// Selection and the creation strip: select beats create.
//
// The strip is creation only: it says what the next transition gets and never
// touches the selected one, so that the Inspector is the single place to edit
// something that already exists. That negative is the most important thing in
// this suite, and the last test here is the one that holds it down.
test.describe('Door mode selection and the creation strip', () => {
  const lockPicker = (page: Page) => page.locator('#door-lock')
  const oneWay = (page: Page) => page.getByRole('button', { name: 'One-way' })

  async function click(
    page: Page,
    grid: Awaited<ReturnType<typeof gridMapping>>,
    x: number,
    y: number,
  ) {
    const point = grid.at(x, y)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.up()
  }

  // Selection leaves no model trace, so the undo stack cannot see it. The halo
  // is the only evidence, and a screenshot comparison is what tells it apart
  // from nothing happening at all.
  test('clicking a transition marks it, and Esc unmarks it', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const canvas = page.locator('.canvas')

    // The missile door on the seam at x = 3. The pointer is parked on it for
    // every shot below, so hover cannot be what the comparison is measuring.
    const seam = grid.at(3, 0.5)
    await page.mouse.move(seam.x, seam.y)
    const before = await canvas.screenshot()

    await page.mouse.down()
    await page.mouse.up()
    const selected = await canvas.screenshot()
    expect(selected.equals(before)).toBe(false)

    await page.keyboard.press('Escape')
    const cleared = await canvas.screenshot()
    expect(cleared.equals(before)).toBe(true)

    // And it committed nothing on the way through.
    expect(await undoLabel(page)).toBe('Undo')
    expect(errors).toEqual([])
  })

  test('Delete removes the selected transition, as one undo step', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)
    const before = await undoLabel(page)

    await click(page, grid, 3, 0.5)
    await page.keyboard.press('Delete')
    expect(await undoLabel(page)).toBe('Undo Delete Transition')

    await page.keyboard.press('Control+z')
    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  // Two clicks on the same marker: the first selects, the second pair navigates.
  // Splitting them is what let every transition behave the same on one click.
  test('a double-click on a far marker still travels', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)

    // The cross-tab teleport's endpoint at (0,2) on Surface.
    const point = grid.at(0.5, 2.5)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.up()
    // Still here: one click selects.
    await expect(page.locator('.tab.active')).toHaveText('Surface')

    await page.mouse.dblclick(point.x, point.y)
    await expect(page.locator('.tab.active')).toHaveText('Caves')
    expect(errors).toEqual([])
  })

  // The streamlining the strip exists for: set it once, draw several.
  test('new transitions are born with whatever the strip says', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)

    await lockPicker(page).selectOption({ label: 'Missile Door' })
    await oneWay(page).click()

    const canvas = page.locator('.canvas')
    const before = await canvas.screenshot()

    // The upper segment of the Sub Level | Annex seam, which has no door yet.
    const start = grid.at(2.5, 9.5)
    const end = grid.at(3.5, 9.5)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()

    expect(await undoLabel(page)).toBe('Undo Add Transition')
    // A red marker and a one-way arrow where there was bare wall.
    expect((await canvas.screenshot()).equals(before)).toBe(false)
    expect(errors).toEqual([])
  })

  // The rule the whole design turns on: select a door, change the strip, and the
  // door must not move. Editing an existing transition has exactly one place,
  // the Inspector.
  test('changing the strip never touches what is selected', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)

    // Select the plain Open door on the Sub Level | Annex seam's lower segment.
    const door = grid.at(3, 10.5)
    await page.mouse.move(door.x, door.y)
    await page.mouse.down()
    await page.mouse.up()
    const selected = await page.locator('.canvas').screenshot()
    const before = await undoLabel(page)

    await lockPicker(page).selectOption({ label: 'Missile Door' })
    await oneWay(page).click()

    // Back to the same pixel first: clicking the toolbar moved the pointer off
    // the canvas, and the comparison must measure the door rather than the
    // hover.
    await page.mouse.move(door.x, door.y)

    // Not one pixel, and not one undo step: the strip is an intent about the
    // future, and the selected door is in the past.
    expect((await page.locator('.canvas').screenshot()).equals(selected)).toBe(true)
    expect(await undoLabel(page)).toBe(before)
    expect(errors).toEqual([])
  })

  // The other half of the same rule: selecting a door must not move the picker
  // either, or a user drawing Open doors would find the dropdown had wandered
  // off to whatever they last clicked.
  test('selecting a transition never moves the strip', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    await enterDoorMode(page)

    await lockPicker(page).selectOption({ label: 'Missile Door' })

    // Select the Open door on the lower Sub Level | Annex segment...
    await click(page, grid, 3, 10.5)
    await expect(lockPicker(page)).toHaveValue(/lock_01|.+/)
    const afterOpenDoor = await lockPicker(page).inputValue()

    // ...and the Locked one-way door beside it. Neither moves the picker.
    await click(page, grid, 3, 9.5)
    expect(await lockPicker(page).inputValue()).toBe(afterOpenDoor)
    expect(await lockPicker(page).locator('option:checked').textContent()).toBe('Missile Door')
    expect(errors).toEqual([])
  })
})

// The View menu's per-layer visibility: a transitions master with the
// teleport-lines sub-toggle nested under it.
//
// Screenshots are the only observable here: a hidden layer commits nothing and
// leaves no DOM. So each test parks the pointer on the same canvas point before
// every shot, or hover would be what the comparison measured.
test.describe('transition layer toggles', () => {
  async function openViewMenu(page: Page) {
    await page.getByRole('button', { name: 'View' }).click()
  }

  // Not `exact`: a ticked item's accessible name picks up the `✓` that the
  // checkable gutter draws as generated content, so the exact string only ever
  // matches while the item is off.
  const layerItem = (page: Page, name: string) => page.getByRole('menuitemcheckbox', { name })

  async function toggleLayer(page: Page, name: string) {
    await openViewMenu(page)
    await layerItem(page, name).click()
    await page.keyboard.press('Escape')
  }

  // Parked well away from any transition, so nothing below is hover.
  async function park(page: Page, grid: Awaited<ReturnType<typeof gridMapping>>) {
    const point = grid.at(1.5, 0.5)
    await page.mouse.move(point.x, point.y)
  }

  test('hiding the layer changes the map, and showing it restores it', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const canvas = page.locator('.canvas')

    await park(page, grid)
    const before = await canvas.screenshot()

    await toggleLayer(page, 'Transitions')
    await park(page, grid)
    expect((await canvas.screenshot()).equals(before)).toBe(false)

    await toggleLayer(page, 'Transitions')
    await park(page, grid)
    expect((await canvas.screenshot()).equals(before)).toBe(true)

    // A view toggle is not an edit.
    expect(await undoLabel(page)).toBe('Undo')
    expect(errors).toEqual([])
  })

  // Hiding only the lines has to be a smaller change than hiding the whole
  // layer: the endpoint markers stay. Two different screenshots is the shape
  // of that claim the canvas can actually answer.
  test('the sub-toggle hides less than the master', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const canvas = page.locator('.canvas')

    await park(page, grid)
    const everything = await canvas.screenshot()

    await toggleLayer(page, 'Teleport Lines')
    await park(page, grid)
    const noLines = await canvas.screenshot()
    expect(noLines.equals(everything)).toBe(false)

    await toggleLayer(page, 'Transitions')
    await park(page, grid)
    const nothing = await canvas.screenshot()
    expect(nothing.equals(noLines)).toBe(false)

    expect(errors).toEqual([])
  })

  test('the sub-toggle is disabled while the layer is hidden', async ({ page }) => {
    const { errors } = await openApp(page)

    await toggleLayer(page, 'Transitions')
    await openViewMenu(page)

    await expect(layerItem(page, 'Teleport Lines')).toBeDisabled()
    await page.keyboard.press('Escape')
    expect(errors).toEqual([])
  })

  // Door mode overrides the master. Entering Door mode is a statement that you
  // are working on transitions, so they come back, and the toggle is left
  // alone, so leaving the mode hides them again.
  test('Door mode shows the layer anyway, and leaving it hides them again', async ({ page }) => {
    const { errors } = await openApp(page)
    const grid = await gridMapping(page)
    const canvas = page.locator('.canvas')

    await park(page, grid)
    const shown = await canvas.screenshot()

    await toggleLayer(page, 'Transitions')
    await park(page, grid)
    const hidden = await canvas.screenshot()
    expect(hidden.equals(shown)).toBe(false)

    await enterDoorMode(page)
    await park(page, grid)
    expect((await canvas.screenshot()).equals(shown)).toBe(true)

    await enterDrawMode(page)
    await park(page, grid)
    expect((await canvas.screenshot()).equals(hidden)).toBe(true)

    // The toggle itself never moved: Door mode overrode it, it did not set it.
    await openViewMenu(page)
    await expect(layerItem(page, 'Transitions')).toHaveAttribute('data-state', 'unchecked')
    await page.keyboard.press('Escape')
    expect(errors).toEqual([])
  })

  test('the toggles survive a reload', async ({ page }) => {
    const { errors } = await openApp(page)

    await toggleLayer(page, 'Teleport Lines')
    await toggleLayer(page, 'Transitions')

    // Preference writes are debounced (see `stores/persistPrefs.ts`), so a
    // reload fired immediately after the last click would race the write
    // rather than test the round trip. This is not specific to the layer
    // toggles: every pref in the app has it. It is the reason a reload is
    // worth an e2e at all: the store test can only prove what was written, not
    // what comes back.
    await page.waitForTimeout(300)

    await page.reload()
    // The welcome modal comes back with the fresh load and sits over the menu
    // bar: it is only dismissed for the session, not remembered.
    await page.getByRole('button', { name: 'Get started' }).click()
    await openViewMenu(page)

    await expect(layerItem(page, 'Transitions')).toHaveAttribute('data-state', 'unchecked')
    await expect(layerItem(page, 'Teleport Lines')).toHaveAttribute('data-state', 'unchecked')
    await page.keyboard.press('Escape')
    expect(errors).toEqual([])
  })
})
