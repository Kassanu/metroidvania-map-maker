// The wiki's image list: one entry per file in the clone's `images/`.
//
// Every shot is a locator screenshot. There is no whole-window path, because
// `.app-shell` is the viewport-height grid and a full window is a crop like any
// other.
//
// A shot carrying a `gesture` is a GIF and every other shot is a still. That is
// the only difference between the two kinds: a GIF is the same crop captured
// once per pointer step.
//
// Each page story adds its own entries here as it writes the page, the same way
// it adds its terms to scripts/check-wiki.py's TERMS. The three below are what
// the pipeline was proved with.
//
// Not a `.spec.ts`, so Playwright collects no tests from it.

import type { Page } from '@playwright/test'
import { annotateRegions } from './support/annotate'
import type { Pointer } from './support/cursor'
import { drawARoom } from './support/gestures'

export interface Shot {
  // Becomes `images/<name>.png`, or `.gif` for a gesture, in the clone. The
  // house style's filename rule: the subject, prefixed by the page only when
  // the shot is that page's alone.
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
  // Makes this shot a GIF: a synthetic cursor is installed and every pointer
  // call the gesture makes captures a frame. Gestures are captured at
  // deviceScaleFactor 1, because GIF weight scales with area.
  gesture?: (page: Page, pointer: Pointer) => Promise<void>
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
  {
    // sunken-city rather than Super Metroid: a gesture needs clear grid beside
    // enough rooms to place it, and a dense map hides the one room being drawn.
    // Its content sits where the sample opens, so no pan.
    name: 'room-mode-draw-a-room',
    sample: 'sunken-city',
    crop: '.region-canvas',
    // Smaller than the stills' window, so the canvas region comes out at 560
    // wide: a GIF is captured at 1x, and GitHub's content column is around
    // 800, so anything wider would be scaled down on the one format that
    // cannot afford resampling.
    viewport: { width: 1120, height: 620 },
    gesture: drawARoom,
  },
]
