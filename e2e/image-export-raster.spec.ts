import { test, expect } from '@playwright/test'
import { openApp } from './support/canvas'

// The three claims the raster producer rests on that jsdom cannot check,
// because jsdom implements neither an image encoder nor a real allocator.
//
// Two of them are assertions about the platform rather than about our code, and
// they are here on purpose: the type guard exists because `toBlob` substitutes
// silently, and the guard is worth exactly as much as that claim is true. If an
// engine starts raising instead, or stops encoding WebP, this is where it shows
// up rather than in a file somebody sent to a forum.

// The producer's own module, reached through the dev server rather than through
// the app: the dialog that will call it is #318, so there is no UI path to it
// yet, and the probe is the half of the ceiling that only a real browser has.
const CEILING_MODULE = '/metroidvania-map-maker/src/export/image/ceiling.ts'

test.describe('the raster producer in a real engine', () => {
  test('substitutes PNG for a type it cannot encode, and raises nothing', async ({ page }) => {
    await openApp(page, null)

    const answered = await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 8
      canvas.height = 8
      try {
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, 'image/nonsense')
        })
        return { threw: false, type: blob?.type ?? null }
      } catch (error) {
        return { threw: true, type: String(error) }
      }
    })

    expect(answered.threw).toBe(false)
    // The whole reason the producer compares the returned type against the one
    // it asked for: the engine answers bytes of a format nobody requested.
    expect(answered.type).toBe('image/png')
  })

  test('encodes WebP, so the type guard cannot fire on a format we ship', async ({ page }) => {
    await openApp(page, null)

    const type = await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 8
      canvas.height = 8
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/webp', 1)
      })
      return blob?.type ?? null
    })

    expect(type).toBe('image/webp')
  })

  test('measures a ceiling rather than falling back to the stated floor', async ({ page }) => {
    await openApp(page, null)

    const measured = await page.evaluate(async (modulePath) => {
      const module = (await import(
        /* @vite-ignore */ modulePath
      )) as typeof import('../src/export/image/ceiling')
      const ceiling = module.imageCeiling()
      return { ...ceiling, fallback: module.FALLBACK_MAX_SIDE }
    }, CEILING_MODULE)

    // A probe that always answered its fallback would be indistinguishable from
    // one that works, on a machine whose real ceiling happens to be 4096. Both
    // targets are desktop engines well above it.
    expect(measured.maxSide).toBeGreaterThan(measured.fallback)
    expect(measured.maxPixels).toBe(measured.maxSide * measured.maxSide)
  })
})
