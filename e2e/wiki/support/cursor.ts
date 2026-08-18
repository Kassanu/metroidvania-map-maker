// The synthetic cursor a gesture GIF is captured with, and the pointer that
// drives it.
//
// Playwright's own pointer draws nothing, so a drag captured without this
// renders as a room appearing for no visible reason. The cursor is a DOM
// element appended to `<body>`, positioned in the same coordinate space as the
// mouse: `position: fixed`, the shell being `100dvh` with no page scroll.
//
// Every pointer call drives `page.mouse`, moves the element and captures one
// frame, in that order and in one call, so the cursor cannot lag the gesture it
// is there to explain. `moveTo` steps itself rather than passing `steps` to
// `page.mouse.move`, whose intermediate moves would be motion no frame records.
//
// The arrow is what the app's own CSS cursor resolves to over an empty cell in
// Room Mode. A gesture over an edge run or a vertex resolves to a resize or a
// crosshair instead, so the first such GIF turns SPRITE into a lookup keyed on
// what `cursorAt` computed.
//
// Nothing here runs for a still: the element exists only in the context a
// gesture shot builds, and the runner asserts its absence before every still.
//
// Not a `.spec.ts`, so Playwright collects no tests from it.

import type { Page } from '@playwright/test'

export const CURSOR_CLASS = 'wiki-cursor'

// Tip at (0, 0) of the viewBox, so the element's own top-left is the hotspot
// and no offset has to be applied when positioning it.
const SPRITE = `
<svg width="20" height="30" viewBox="0 0 20 30" xmlns="http://www.w3.org/2000/svg">
  <path d="M0 0 L0 22 L5.4 17 L9 25.5 L13 23.7 L9.4 15.6 L16.5 15.2 Z"
        fill="#ffffff" stroke="#101010" stroke-width="1.4" stroke-linejoin="round"/>
</svg>`

// The press state: a ring centred on the tip, drawn under the arrow so the
// arrow stays legible through it. Present from press to release rather than
// flashed on the press frame alone, because at 15 fps a one-frame flash is a
// sixteenth of a second and reads as an encoding artefact.
//
// Smaller than a cell at the default zoom, so it never spans two of them and
// leaves the cell it is over readable through a light fill.
const RING_PX = 28

export interface Pointer {
  move(x: number, y: number): Promise<void>
  moveTo(x: number, y: number, steps: number): Promise<void>
  down(): Promise<void>
  up(): Promise<void>
  hold(frames: number): Promise<void>
}

// Captures one frame. The runner supplies it, because where frames go is the
// runner's business and how a gesture is timed is this file's.
export type Capture = () => Promise<void>

export async function installCursor(page: Page, capture: Capture): Promise<Pointer> {
  await page.evaluate(
    ({ className, sprite, ringPx }) => {
      const cursor = document.createElement('div')
      cursor.className = className
      cursor.style.cssText = [
        'position: fixed',
        'left: 0',
        'top: 0',
        'width: 20px',
        'height: 30px',
        'pointer-events: none',
        'z-index: 2147483647',
      ].join(';')

      const ring = document.createElement('span')
      ring.className = `${className}-ring`
      ring.style.cssText = [
        'position: absolute',
        `left: ${-ringPx / 2}px`,
        `top: ${-ringPx / 2}px`,
        `width: ${ringPx}px`,
        `height: ${ringPx}px`,
        'border-radius: 50%',
        'background: #3987e526',
        'box-shadow: inset 0 0 0 2px #3987e5',
        'display: none',
      ].join(';')

      const arrow = document.createElement('span')
      arrow.style.cssText = 'position: absolute; left: 0; top: 0'
      arrow.innerHTML = sprite

      cursor.append(ring, arrow)
      document.body.appendChild(cursor)
    },
    { className: CURSOR_CLASS, sprite: SPRITE, ringPx: RING_PX },
  )

  let atX = 0
  let atY = 0

  // A frame is taken after a paint, never in the middle of one: the app redraws
  // the canvas from a pointer event, so a screenshot taken before the next
  // frame lands catches the state the previous step left.
  const frame = async () => {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    await capture()
  }

  // One frame's worth of work: the mouse, then the element, then a paint. The
  // element is positioned by transform rather than left/top, so it never lands
  // on a fractional layout position the browser would antialias differently
  // between runs.
  const step = async (x: number, y: number) => {
    await page.mouse.move(x, y)
    await place(page, x, y)
    await frame()
    atX = x
    atY = y
  }

  return {
    async move(x, y) {
      await step(x, y)
    },

    async moveTo(x, y, steps) {
      const fromX = atX
      const fromY = atY
      for (let i = 1; i <= steps; i++) {
        await step(fromX + ((x - fromX) * i) / steps, fromY + ((y - fromY) * i) / steps)
      }
    },

    async down() {
      await page.mouse.down()
      await ring(page, true)
      await frame()
    },

    async up() {
      await page.mouse.up()
      await ring(page, false)
      await frame()
    },

    async hold(frames) {
      for (let i = 0; i < frames; i++) await frame()
    },
  }
}

async function place(page: Page, x: number, y: number) {
  await page.evaluate(
    ({ className, x, y }) => {
      const cursor = document.querySelector<HTMLElement>(`.${className}`)
      if (!cursor) throw new Error('no cursor element')
      cursor.style.transform = `translate(${x}px, ${y}px)`
    },
    { className: CURSOR_CLASS, x, y },
  )
}

async function ring(page: Page, shown: boolean) {
  await page.evaluate(
    ({ className, shown }) => {
      const element = document.querySelector<HTMLElement>(`.${className}-ring`)
      if (!element) throw new Error('no cursor ring')
      element.style.display = shown ? 'block' : 'none'
    },
    { className: CURSOR_CLASS, shown },
  )
}
