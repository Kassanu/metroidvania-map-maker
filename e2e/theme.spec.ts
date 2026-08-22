import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// What an Appearance choice does to `color-scheme`, and so to native widget
// chrome: scrollbars, selects, form controls. Only observable in a real engine,
// because jsdom computes nothing from a stylesheet.
//
// Each block emulates the OS preference it is contradicting, so a test that
// passes for the wrong reason (the OS happening to agree) is impossible.

async function boot(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Get started' }).click()
}

// Not `exact`: a ticked radio item's accessible name picks up the `✓` the
// checkable gutter draws as generated content. No theme option's name is a
// substring of another's, so the loose match stays unambiguous.
async function setAppearance(page: Page, option: string) {
  await page.getByRole('button', { name: 'View' }).click()
  await page.getByRole('menuitem', { name: 'Appearance' }).click()
  await page.getByRole('menuitemradio', { name: option }).click()
  await page.keyboard.press('Escape')
}

function colorScheme(page: Page) {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('color-scheme').trim(),
  )
}

test.describe('on a light-preference OS', () => {
  test.use({ colorScheme: 'light' })

  test('Dark narrows color-scheme to dark', async ({ page }) => {
    await boot(page)
    await setAppearance(page, 'Dark')
    await expect.poll(() => colorScheme(page)).toBe('dark')
  })

  test('System Default leaves both values, so the OS decides', async ({ page }) => {
    await boot(page)
    await expect.poll(() => colorScheme(page)).toBe('light dark')
  })
})

test.describe('on a dark-preference OS', () => {
  test.use({ colorScheme: 'dark' })

  test('Light narrows color-scheme to light', async ({ page }) => {
    await boot(page)
    await setAppearance(page, 'Light')
    await expect.poll(() => colorScheme(page)).toBe('light')
  })

  test('System Default leaves both values, so the OS decides', async ({ page }) => {
    await boot(page)
    await expect.poll(() => colorScheme(page)).toBe('light dark')
  })
})
