import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Behaviour the unit tests structurally cannot reach: jsdom has no layout, so
// scrollWidth/clientWidth are always 0 and overflow affordances can't be
// exercised there, and focus/selection after a re-render is only meaningful
// against a real browser.

async function dismissWelcome(page: Page) {
  await page.goto('/')
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
