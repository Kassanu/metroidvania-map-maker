import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { ToastSpec } from '../src/notify'

// Whether the toast viewport is positioned at all, which is the one thing no
// unit test can see: jsdom never loads style.css, so a rule that silently
// matches nothing looks identical to a rule that works.
//
// It matches nothing easily. ToastViewport and ToastRoot re-bind $attrs onto
// an inner Primitive, so a scoped rule's data-v attribute and the class land
// on two different elements. Scoped, this viewport loses `position: fixed`,
// stays in flow, and displaces whatever it is rendered inside.
//
// Toasts are raised through the development-only window hook, because every
// real source of one is a service worker update or an operation failing, and
// Playwright can arrange neither.

declare global {
  interface Window {
    __notify?: (spec: ToastSpec) => void
  }
}

async function boot(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Get started' }).click()
}

async function raise(page: Page, spec: ToastSpec) {
  await page.evaluate((raised) => window.__notify?.(raised), spec)
  await expect(page.locator('.toast')).toHaveCount(1)
}

const STICKY: ToastSpec = { severity: 'info', bodyKey: 'update.body', sticky: true }

test('the viewport is taken out of flow', async ({ page }) => {
  await boot(page)
  await raise(page, STICKY)

  const position = await page
    .locator('.toast-viewport')
    .evaluate((element) => getComputedStyle(element).position)

  expect(position).toBe('fixed')
})

// The regression this whole task exists to prevent. A viewport left in flow
// becomes an unplaced grid item and pushes every region of the app aside.
test('raising a toast does not move the app', async ({ page }) => {
  await boot(page)
  const canvas = page.locator('.region-canvas')
  const before = await canvas.boundingBox()

  await raise(page, STICKY)

  expect(await canvas.boundingBox()).toEqual(before)
})

test('the severity accent comes from the theme token', async ({ page }) => {
  await boot(page)

  const accentOf = async (severity: ToastSpec['severity']) => {
    await page.evaluate((raised) => window.__notify?.(raised), {
      severity,
      bodyKey: 'update.body',
      sticky: true,
    } as ToastSpec)
    return page
      .locator(`.toast-${severity}`)
      .evaluate((element) => getComputedStyle(element).borderLeftColor)
  }

  const error = await accentOf('error')
  const success = await accentOf('success')

  // Distinct from each other, and from the neutral border the other three
  // edges use, which is what a dead token would leave behind.
  expect(error).not.toBe(success)
  const neutral = await page
    .locator('.toast-error')
    .evaluate((element) => getComputedStyle(element).borderTopColor)
  expect(error).not.toBe(neutral)
})

// A toast reporting on a dialog's outcome has to be readable over the dialog
// that is still open, which is what --z-toast above --z-modal buys.
//
// Read as computed z-index rather than by hit-testing the toast's centre:
// Reka's dialog puts `pointer-events: none` on the body while it is open, so
// elementFromPoint skips the toast and answers with the overlay however the
// two are stacked. That also means a toast raised over a dialog can be read
// but not clicked.
test('a toast stacks above an open dialog', async ({ page }) => {
  await boot(page)
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Export' }).click()
  await page.getByRole('menuitem', { name: 'JSON…', exact: true }).click()
  await expect(page.getByRole('tree')).toBeVisible()

  await raise(page, STICKY)

  const layers = await page.evaluate(() => ({
    toast: Number(getComputedStyle(document.querySelector('.toast-viewport')!).zIndex),
    dialog: Number(getComputedStyle(document.querySelector('.modal-content')!).zIndex),
  }))

  expect(layers.toast).toBeGreaterThan(layers.dialog)
})

// Nine seconds of the budget go on waiting, which is most of the default under
// a parallel run.
test.slow()
test('a sticky toast stays until it is closed', async ({ page }) => {
  await boot(page)
  await raise(page, STICKY)

  // Comfortably past the longest automatic duration.
  await page.waitForTimeout(9000)
  await expect(page.locator('.toast')).toHaveCount(1)

  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.toast')).toHaveCount(0)
})
