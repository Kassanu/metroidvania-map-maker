// Generates every still the wiki uses, into the wiki clone's `images/`.
//
//     npm run wiki:images              # the sibling clone
//     WIKI_CLONE=/path/to/clone npm run wiki:images
//
// `images/` holds exactly the manifest's output: anything there the manifest
// does not name is deleted. That is the half of the loop check-wiki.py cannot
// see, which checks that every image a page references exists and that no image
// is referenced by nothing.
//
// Each shot runs in its own browser context, so neither an injected overlay nor
// a preference the app writes back can reach the next shot. Contexts are built
// from `contextOptions` rather than by hand, so the pinned viewport, the device
// scale factor and the colour scheme all come from the config.
//
// A `.wiki.ts` rather than a `.spec.ts`: Playwright's default testMatch collects
// only `*.spec.ts` and `*.test.ts`, so `npm run test:e2e` never runs this and
// the normal suite never writes a PNG.

import { test } from '@playwright/test'
import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SHOTS } from './manifest'
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
    })
    try {
      const page = await context.newPage()
      await openForCapture(page, shot.sample)
      if (shot.pan) await panView(page, shot.pan.x, shot.pan.y)
      await shot.prepare?.(page)

      const file = `${shot.name}.png`
      await page.locator(shot.crop).screenshot({ path: path.join(imagesDir, file) })
      written.add(file)
    } finally {
      await context.close()
    }
  }

  for (const entry of await readdir(imagesDir)) {
    if (written.has(entry)) continue
    await rm(path.join(imagesDir, entry), { recursive: true })
  }
})
