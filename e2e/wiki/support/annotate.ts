// Tints and numbers the seven screen regions for the wiki's Regions diagram.
//
// Overlays are appended to `<body>` and positioned from each region's client
// rect, so the app's own DOM and layout are never mutated to take a picture.
// They are `position: fixed`, which is the same coordinate space the rects are
// in; the shell is `100dvh` and the page never scrolls.
//
// Four hues, not seven. Seven simultaneous categorical hues cannot clear the
// colourblind and normal-vision separation floors on this dark surface, and no
// ordering fixes it. Four can, so regions are tinted by family and the numbered
// badge carries identity: strips, the activity bar, the panels, the canvas.
// Numbering runs in the grid's reading order, which is the order
// AppShell.vue's `grid-template-areas` declares.
//
// Not a `.spec.ts`, so Playwright collects no tests from it.

import type { Page } from '@playwright/test'

// Categorical slots 1, 4, 5 and 6 of the dark-mode palette, the four-hue set
// that passes every separation check against the app's `#1e1e1e` surface.
const FAMILY_HUE = {
  strips: '#3987e5',
  activity: '#c98500',
  panels: '#d55181',
  canvas: '#008300',
} as const

interface RegionMark {
  selector: string
  number: number
  family: keyof typeof FAMILY_HUE
  // Which corner the badge sits in. Per region rather than fixed, because the
  // app's own controls occupy a different corner of each one and a badge over a
  // control hides the thing the page is about to name.
  corner: 'top-left' | 'top-right' | 'bottom-left'
}

const REGIONS: RegionMark[] = [
  { selector: '.region-menu', number: 1, family: 'strips', corner: 'top-right' },
  { selector: '.region-toolbar', number: 2, family: 'strips', corner: 'top-left' },
  { selector: '.region-activity', number: 3, family: 'activity', corner: 'bottom-left' },
  { selector: '.region-left', number: 4, family: 'panels', corner: 'top-left' },
  { selector: '.region-canvas', number: 5, family: 'canvas', corner: 'top-left' },
  { selector: '.region-right', number: 6, family: 'panels', corner: 'top-right' },
  { selector: '.region-tabs', number: 7, family: 'strips', corner: 'top-right' },
]

export async function annotateRegions(page: Page) {
  const missing = await page.evaluate(
    ({ regions, hues }) => {
      const absent: string[] = []

      for (const region of regions) {
        const element = document.querySelector(region.selector)
        if (!element) {
          absent.push(region.selector)
          continue
        }

        const rect = element.getBoundingClientRect()
        const hue = hues[region.family]

        const overlay = document.createElement('div')
        overlay.className = 'wiki-annotation'
        // Rounded so the tint's edge lands on a whole pixel and the browser
        // does not antialias it into a soft line.
        overlay.style.cssText = [
          'position: fixed',
          `left: ${Math.round(rect.left)}px`,
          `top: ${Math.round(rect.top)}px`,
          `width: ${Math.round(rect.width)}px`,
          `height: ${Math.round(rect.height)}px`,
          `background: ${hue}26`,
          `box-shadow: inset 0 0 0 2px ${hue}`,
          'pointer-events: none',
          'z-index: 2147483647',
        ].join(';')

        const [vertical, horizontal] = region.corner.split('-')
        const badge = document.createElement('span')
        badge.textContent = String(region.number)
        badge.style.cssText = [
          'position: absolute',
          `${horizontal}: 4px`,
          `${vertical}: 4px`,
          'width: 20px',
          'height: 20px',
          'border-radius: 50%',
          `background: ${hue}`,
          'color: #ffffff',
          'font: 700 13px/20px system-ui, sans-serif',
          'text-align: center',
        ].join(';')
        overlay.appendChild(badge)

        document.body.appendChild(overlay)
      }

      return absent
    },
    { regions: REGIONS, hues: FAMILY_HUE },
  )

  // A renamed region class would otherwise publish a diagram with a region
  // silently unmarked, which reads as though the app has six.
  if (missing.length > 0) throw new Error(`no element for region ${missing.join(', ')}`)
}
