// The wiki's image list: one entry per file in the clone's `images/`.
//
// Every shot is a locator screenshot. There is no whole-window path, because
// `.app-shell` is the viewport-height grid and a full window is a crop like any
// other.
//
// Each page story adds its own entries here as it writes the page, the same way
// it adds its terms to scripts/check-wiki.py's TERMS. The two below are what the
// pipeline was proved with.
//
// Not a `.spec.ts`, so Playwright collects no tests from it.

import type { Page } from '@playwright/test'
import { annotateRegions } from './support/annotate'

export interface Shot {
  // Becomes `images/<name>.png` in the clone. The house style's filename rule:
  // the subject, prefixed by the page only when the shot is that page's alone.
  name: string
  // A file in samples/, by basename.
  sample: string
  // Selector for the element to capture.
  crop: string
  // Overrides the config's pinned viewport. Region sizes depend on window size,
  // so anything set here changes the crop.
  viewport?: { width: number; height: number }
  // Moves the view by this many screen pixels before capturing: positive y
  // shows what was below the bottom edge, positive x what was off the right.
  // A sample opens on its origin, which is not always where its content is.
  pan?: { x: number; y: number }
  // Runs after the pan and before the capture, for a shot that needs the page
  // arranged or annotated first.
  prepare?: (page: Page) => Promise<void>
}

// Super Metroid opens on Crateria, which leaves most of the window empty grid
// around one elevator shaft. A screen down and a little left is where Brinstar,
// Norfair and Maridia are, and it fills the canvas.
const ZEBES_SOUTH = { x: -144, y: 900 }

export const SHOTS: Shot[] = [
  { name: 'app-window', sample: 'Super Metroid', crop: '.app-shell', pan: ZEBES_SOUTH },
  {
    name: 'regions-numbered',
    sample: 'Super Metroid',
    crop: '.app-shell',
    pan: ZEBES_SOUTH,
    prepare: annotateRegions,
  },
]
