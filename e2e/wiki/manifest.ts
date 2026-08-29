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
import {
  absorbARoom,
  brushSize,
  chooseAnArea,
  drawARoom,
  drawWallStyles,
  extendARoom,
  extendKeepsItsArea,
  lockCells,
} from './support/gestures'

export interface Shot {
  // Becomes `images/<name>.png`, or `.gif` for a gesture, in the clone. The
  // house style's filename rule: the subject, prefixed by the page only when
  // the shot is that page's alone.
  name: string
  // A file in samples/, by basename. Omitted boots the app's own project:
  // Untitled Project, one map, and the World area.
  sample?: string
  // Selector for the element to capture.
  crop: string
  // Overrides the config's pinned viewport. Region sizes depend on window size,
  // so anything set here changes the crop.
  viewport?: { width: number; height: number }
  // Which sidebars start collapsed. Omitted leaves both open, which is the
  // app's own default and what a shot of the whole window shows.
  collapse?: { left?: boolean; right?: boolean }
  // Zoom as a multiplier: 1.5 is the 150% the toolbar reads back. Applied
  // before the framing below, because zooming leaves the camera's pan alone and
  // so moves whatever was in frame.
  zoom?: number
  // Moves the view by this many screen pixels before capturing: positive y
  // shows what was below the bottom edge, positive x what was off the right.
  // A sample opens on its origin, which is not always where its content is.
  pan?: { x: number; y: number }
  // Puts this world cell at the centre of the canvas viewport. The alternative
  // to `pan` for a shot that says which part of the map it is about, rather
  // than by how far the view moved; a shot uses one or the other.
  focus?: { x: number; y: number }
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

// A gesture whose subject is a toolbar control has to hold the toolbar and the
// canvas in one crop. The Room Mode toolbar's intrinsic width is 1135 and it
// does not wrap, so 1160 is the narrowest window that leaves it a margin rather
// than ending flush against the last control.
const SHELL_GESTURE_VIEWPORT = { width: 1160, height: 620 }

// Both sidebars, because neither the Hierarchy nor the Inspector says anything
// about a toolbar control, and between them they take most of a 1160 window
// away from the canvas.
const NO_SIDEBARS = { left: true, right: true }

// sunken-city's rooms are at rows 0 to 2 and every gesture below draws in the
// clear band at rows 5 to 7. Centred between them at 150%, both are in frame
// and the drawn cells are large enough to read once GitHub has scaled the crop
// down to its content column.
const HARBOUR_ROOMS = { x: 4, y: 4 }
const SHELL_GESTURE_ZOOM = 1.5

// Smaller than the stills' window, so the canvas region comes out at 560 wide:
// a GIF is captured at 1x, and GitHub's content column is around 800, so
// anything wider would be scaled down on the one format that cannot afford
// resampling. Shared by every shot cropped to the canvas, so the images that
// sit next to each other on a page are framed alike.
const CANVAS_VIEWPORT = { width: 1120, height: 620 }

export const SHOTS: Shot[] = [
  {
    // No sample and no pan: the subject is the app with nothing asked of it,
    // which is the one shot the samples would get in the way of.
    name: 'app-cold-start',
    crop: '.app-shell',
  },
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
    // Its content sits where the sample opens, so no framing.
    name: 'room-mode-draw-a-room',
    sample: 'sunken-city',
    crop: '.region-canvas',
    viewport: CANVAS_VIEWPORT,
    gesture: drawARoom,
  },
  {
    // The first of the six cropped to the whole window: the subject is the area
    // picker and its swatch, which only mean anything with the toolbar in view.
    name: 'room-mode-choose-an-area',
    sample: 'sunken-city',
    crop: '.app-shell',
    viewport: SHELL_GESTURE_VIEWPORT,
    collapse: NO_SIDEBARS,
    zoom: SHELL_GESTURE_ZOOM,
    focus: HARBOUR_ROOMS,
    gesture: chooseAnArea,
  },
  {
    name: 'room-mode-extend-keeps-its-area',
    sample: 'sunken-city',
    crop: '.app-shell',
    viewport: SHELL_GESTURE_VIEWPORT,
    collapse: NO_SIDEBARS,
    zoom: SHELL_GESTURE_ZOOM,
    focus: HARBOUR_ROOMS,
    gesture: extendKeepsItsArea,
  },
  {
    name: 'room-mode-brush-size',
    sample: 'sunken-city',
    crop: '.app-shell',
    viewport: SHELL_GESTURE_VIEWPORT,
    collapse: NO_SIDEBARS,
    zoom: SHELL_GESTURE_ZOOM,
    focus: HARBOUR_ROOMS,
    gesture: brushSize,
  },
  {
    name: 'room-mode-extend-a-room',
    sample: 'sunken-city',
    crop: '.region-canvas',
    viewport: CANVAS_VIEWPORT,
    gesture: extendARoom,
  },
  {
    name: 'room-mode-absorb-a-room',
    sample: 'sunken-city',
    crop: '.region-canvas',
    viewport: CANVAS_VIEWPORT,
    gesture: absorbARoom,
  },
  {
    name: 'room-mode-lock-cells',
    sample: 'sunken-city',
    crop: '.app-shell',
    viewport: SHELL_GESTURE_VIEWPORT,
    collapse: NO_SIDEBARS,
    zoom: SHELL_GESTURE_ZOOM,
    focus: HARBOUR_ROOMS,
    gesture: lockCells,
  },
  {
    // No sample: three inner walls in one plain room, with nothing else on the
    // map to read as a fourth thing. The room is drawn by the prepare.
    name: 'room-mode-wall-styles',
    crop: '.region-canvas',
    viewport: CANVAS_VIEWPORT,
    prepare: drawWallStyles,
  },
]
