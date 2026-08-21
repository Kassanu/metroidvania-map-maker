import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Layout, so jsdom cannot judge any of it: every rect here is zero there. The
// bug this guards is a dropdown item that renders but cannot be reached.

async function openApp(page: Page) {
  await page.goto('/?sample=one-of-everything')
  await page.getByRole('button', { name: 'Get started' }).click()
}

// Each item's rect against the scrolling box that clips it, plus the window.
async function dropdownGeometry(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.zoom-viewport') as HTMLElement
    const content = document.querySelector('.zoom-content') as HTMLElement
    const clip = viewport.getBoundingClientRect()
    return {
      windowHeight: window.innerHeight,
      contentBottom: content.getBoundingClientRect().bottom,
      scrolls: viewport.scrollHeight > viewport.clientHeight,
      items: Array.from(document.querySelectorAll('.zoom-content .popover-item')).map((el) => {
        const rect = el.getBoundingClientRect()
        return {
          text: el.textContent?.trim() ?? '',
          // How much of the item the clip box actually shows.
          visible: Math.max(0, Math.min(rect.bottom, clip.bottom) - Math.max(rect.top, clip.top)),
          height: rect.height,
        }
      }),
    }
  })
}

test.describe('the zoom dropdown', () => {
  test('shows every item in full when the window has room for them', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await openApp(page)
    await page.getByLabel('Zoom options').click()

    const geometry = await dropdownGeometry(page)
    // Room to spare, so it should not be scrolling at all: a list that scrolls
    // when it fits is what put To Selection out of reach.
    expect(geometry.scrolls).toBe(false)
    expect(geometry.items.length).toBeGreaterThan(10)
    for (const item of geometry.items) {
      expect(item.visible, `${item.text} is clipped`).toBeCloseTo(item.height, 0)
    }
  })

  test('stays inside a short window, scrolling rather than overflowing it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 420 })
    await openApp(page)
    await page.getByLabel('Zoom options').click()

    const geometry = await dropdownGeometry(page)
    expect(geometry.scrolls).toBe(true)
    expect(geometry.contentBottom).toBeLessThanOrEqual(geometry.windowHeight)
  })

  // Not a guard against the clipping above: Playwright scrolls an element into
  // view before clicking it, so this passes with the last item out of reach.
  // The two geometry tests are what catch that. This one covers the wiring.
  test('drives Fit Window from the menu', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await openApp(page)
    await page.getByLabel('Zoom options').click()

    await page.getByRole('option', { name: 'Fit Window' }).click()
    await expect(page.locator('.zoom-input')).not.toHaveValue('100%')
  })
})
