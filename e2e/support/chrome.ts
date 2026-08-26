// App chrome the canvas specs have to drive to set up a reading, as opposed to
// the grid plumbing in `canvas.ts`.
//
// Not a `.spec.ts`, so Playwright collects no tests from it.

import type { Page } from '@playwright/test'

// View ▸ Appearance. Not `exact`: a ticked radio item's accessible name picks
// up the `✓` the checkable gutter draws as generated content. No theme option's
// name is a substring of another's, so the loose match stays unambiguous.
export async function setAppearance(page: Page, option: string) {
  await page.getByRole('button', { name: 'View' }).click()
  await page.getByRole('menuitem', { name: 'Appearance' }).click()
  await page.getByRole('menuitemradio', { name: option }).click()
  await page.keyboard.press('Escape')
}
