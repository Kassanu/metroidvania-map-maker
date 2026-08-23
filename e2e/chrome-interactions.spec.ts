import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Behaviour the unit tests structurally cannot reach: jsdom has no layout, so
// scrollWidth/clientWidth are always 0 and overflow affordances can't be
// exercised there, and focus/selection after a re-render is only meaningful
// against a real browser.

async function dismissWelcome(page: Page) {
  await page.goto('/?sample=one-of-everything')
  await page.getByRole('button', { name: 'Get started' }).click()
}

test.describe('tab bar overflow', () => {
  test('shows scroll affordances only once the strip overflows', async ({ page }) => {
    await dismissWelcome(page)
    await expect(page.getByTitle('Scroll left')).toHaveCount(0)

    for (let i = 0; i < 25; i++) await page.getByTitle('New map').click()

    const back = page.getByTitle('Scroll left')
    const forward = page.getByTitle('Scroll right')
    await expect(back).toBeVisible()

    // The newest tab is active and scrolled into view, so the strip is at its
    // far end: nothing further forward, plenty behind.
    await expect(forward).toBeDisabled()
    await expect(back).toBeEnabled()

    await back.click()
    await expect(forward).toBeEnabled()
  })
})

test.describe('inline rename', () => {
  // The project's starting name is deliberately not hard-coded: `src/dev/seed.ts`
  // opens the frozen fixture in dev builds, so it is "Fixture Project" today and
  // "Untitled Project" again the day that scaffolding is deleted. What these
  // tests are about is focus and selection, not the name.
  const titleButton = (page: Page) => page.locator('.project-title-button')

  test('focuses the input and selects the existing text, in both places', async ({ page }) => {
    await dismissWelcome(page)

    const startingName = (await titleButton(page).textContent())?.trim() ?? ''
    expect(startingName.length).toBeGreaterThan(0)

    await titleButton(page).click()
    const titleInput = page.locator('.project-title-input')
    await expect(titleInput).toBeFocused()
    // Selected, so typing replaces rather than appends.
    expect(await titleInput.evaluate((el: HTMLInputElement) => el.selectionEnd)).toBe(
      startingName.length,
    )
    await page.keyboard.type('Hollow Knight')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Hollow Knight' })).toBeVisible()

    await page.locator('.tab').first().dblclick()
    const tabInput = page.locator('.tab-rename-input')
    await expect(tabInput).toBeFocused()
    await page.keyboard.type('Crossroads')
    await page.keyboard.press('Enter')
    await expect(page.locator('.tab').first()).toHaveText('Crossroads')
  })

  test('Escape abandons the edit, leaving the name untouched', async ({ page }) => {
    await dismissWelcome(page)

    const startingName = (await titleButton(page).textContent())?.trim() ?? ''
    await titleButton(page).click()
    await page.keyboard.type('Discarded')
    await page.keyboard.press('Escape')

    await expect(titleButton(page)).toHaveText(startingName)
  })
})

// The disabled look is CSS, and CSS is invisible to a component test: jsdom
// loads no stylesheet, and these rules live in Toolbar.vue's scoped block.
test.describe('toolbar undo and redo', () => {
  const style = (locator: ReturnType<Page['locator']>, property: keyof CSSStyleDeclaration) =>
    locator.evaluate(
      (element, name) => String(getComputedStyle(element)[name as never]),
      property as string,
    )

  test('looks disabled and refuses the hover highlight until there is a step to move', async ({
    page,
  }) => {
    await dismissWelcome(page)
    const undo = page.locator('.undo-button')
    const zen = page.locator('.zen-toggle-button')

    await expect(undo).toBeDisabled()
    expect(await style(undo, 'cursor')).toBe('default')
    expect(Number(await style(undo, 'opacity'))).toBeLessThan(1)

    // Hovering a button that cannot be pressed changes nothing.
    const unlit = await style(undo, 'backgroundColor')
    await undo.hover()
    expect(await style(undo, 'backgroundColor')).toBe(unlit)

    // The same rule still lights an enabled button, so what the exclusion
    // removed is the disabled state rather than the highlight itself.
    const zenUnlit = await style(zen, 'backgroundColor')
    await zen.hover()
    expect(await style(zen, 'backgroundColor')).not.toBe(zenUnlit)

    // An edit puts a step on the stack, and undo goes live: full strength, a
    // pointer cursor, and the highlight back.
    await page.locator('.project-title-button').click()
    await page.keyboard.type('Zebes')
    await page.keyboard.press('Enter')

    await expect(undo).toBeEnabled()
    expect(await style(undo, 'cursor')).toBe('pointer')
    expect(await style(undo, 'opacity')).toBe('1')
    await undo.hover()
    expect(await style(undo, 'backgroundColor')).not.toBe(unlit)
  })

  // What the buttons are for, through the DOM rather than the stores: the
  // toolbar moves the same stack the Edit menu names.
  test('reverts the last step and replays it', async ({ page }) => {
    await dismissWelcome(page)
    const title = page.locator('.project-title-button')
    // The button carries the unsaved-work dot beside the name, and an undo
    // does not clear it: what is compared here is the name alone.
    const name = async () => (await title.textContent())?.replace('•', '').trim() ?? ''
    const before = await name()

    await title.click()
    await page.keyboard.type('Zebes')
    await page.keyboard.press('Enter')
    await expect.poll(name).toBe('Zebes')
    await expect(page.locator('.undo-button')).toHaveAttribute(
      'title',
      'Undo Rename Project (Ctrl+Z)',
    )

    await page.locator('.undo-button').click()
    await expect.poll(name).toBe(before)

    await expect(page.locator('.redo-button')).toHaveAttribute(
      'title',
      'Redo Rename Project (Ctrl+Shift+Z)',
    )
    await page.locator('.redo-button').click()
    await expect.poll(name).toBe('Zebes')
  })
})
