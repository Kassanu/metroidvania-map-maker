// Generates every image the wiki uses, into the wiki clone's `images/`.
//
//     npm run wiki:images              # the sibling clone
//     WIKI_CLONE=/path/to/clone npm run wiki:images
//
// `images/` holds exactly the manifest's output: anything there the manifest
// does not name is deleted. That is the half of the loop check-wiki.py cannot
// see, which checks that every image a page references exists and that no image
// is referenced by nothing.
//
// A shot with a gesture is a GIF: the same crop captured once per pointer step
// into a scratch directory, then assembled by ffmpeg. Gestures are captured at
// deviceScaleFactor 1 because GIF weight scales with area, and stills at the
// config's 2 because GitHub scales a wide image down but never scales one up.
//
// A still asserts the synthetic cursor is absent before capturing. Separate
// contexts already make it impossible for one to be there; the assertion is
// what makes that a rule with something behind it.
//
// Each shot runs in its own browser context, so neither an injected overlay nor
// a preference the app writes back can reach the next shot. Contexts are built
// from `contextOptions` rather than by hand, so the pinned viewport, the device
// scale factor and the colour scheme all come from the config.
//
// A `.wiki.ts` rather than a `.spec.ts`: Playwright's default testMatch collects
// only `*.spec.ts` and `*.test.ts`, so `npm run test:e2e` never runs this and
// the normal suite never writes a PNG.

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Shot } from './manifest'
import { SHOTS } from './manifest'
import { CURSOR_CLASS, installCursor } from './support/cursor'
import { encodeGif, frameName } from './support/gif'
import { openForCapture } from './support/shell'
import { panView } from './support/view'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DEFAULT_CLONE = path.join(path.dirname(REPO), 'metroidvania-map-maker-wiki')

const clone = process.env.WIKI_CLONE ?? DEFAULT_CLONE
const imagesDir = path.join(clone, 'images')

test('the wiki images regenerate', async ({ browser, contextOptions }) => {
  await mkdir(imagesDir, { recursive: true })

  const written = new Set<string>()

  for (const shot of SHOTS) {
    const context = await browser.newContext({
      ...contextOptions,
      ...(shot.viewport ? { viewport: shot.viewport } : {}),
      // GIF weight scales with area, so a gesture overrides the config's 2.
      ...(shot.gesture ? { deviceScaleFactor: 1 } : {}),
    })
    try {
      const page = await context.newPage()
      await openForCapture(page, shot.sample)
      if (shot.pan) await panView(page, shot.pan.x, shot.pan.y)
      await shot.prepare?.(page)

      written.add(shot.gesture ? await captureGif(page, shot) : await captureStill(page, shot))
    } finally {
      await context.close()
    }
  }

  for (const entry of await readdir(imagesDir)) {
    if (written.has(entry)) continue
    await rm(path.join(imagesDir, entry), { recursive: true })
  }
})

async function captureStill(page: Page, shot: Shot) {
  await expect(page.locator(`.${CURSOR_CLASS}`)).toHaveCount(0)

  const file = `${shot.name}.png`
  await page.locator(shot.crop).screenshot({ path: path.join(imagesDir, file) })
  return file
}

async function captureGif(page: Page, shot: Shot) {
  const file = `${shot.name}.gif`
  const framesDir = await mkdtemp(path.join(tmpdir(), 'wiki-gif-'))

  try {
    const crop = page.locator(shot.crop)
    let frames = 0
    const pointer = await installCursor(page, async () => {
      await crop.screenshot({ path: path.join(framesDir, frameName(frames)) })
      frames += 1
    })

    await shot.gesture?.(page, pointer)

    encodeGif(framesDir, path.join(imagesDir, file))
  } finally {
    await rm(framesDir, { recursive: true, force: true })
  }

  return file
}
