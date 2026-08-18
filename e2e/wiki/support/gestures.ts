// The gestures the wiki's GIFs are captured from, one function per GIF.
//
// A gesture is aimed through `gridMapping`, which solves the world-to-screen
// mapping from the coords overlay, so nothing here hard-codes a cell size, a
// ruler thickness or the sample's default pan.
//
// Every gesture runs at the pointer's own pace: each `move`, `down`, `up` and
// `hold` is one frame at 15 fps, so step counts here are durations. A gesture
// ends holding its result long enough to read before the loop restarts.
//
// Not a `.spec.ts`, so Playwright collects no tests from it.

import type { Page } from '@playwright/test'
import { gridMapping } from '../../support/canvas'
import type { Pointer } from './cursor'

// Drawing paints the cells the pointer sweeps; it is not a rubber band that
// fills a rectangle. The path turns a corner for that reason: a straight drag
// leaves a shape a rectangle tool would also have produced, and the corner is
// what makes the difference visible.
//
// Rows 5 to 7 of the Harbour map are clear: sunken-city's two rooms occupy
// rows 0 to 2, so the new room lands below them with nothing to overlap.
const START = { x: 1.5, y: 5.5 }
const CORNER = { x: 5.5, y: 5.5 }
const END = { x: 5.5, y: 7.5 }
const APPROACH = { x: 8.5, y: 5.5 }

export async function drawARoom(page: Page, pointer: Pointer) {
  const grid = await gridMapping(page)
  const at = (cell: { x: number; y: number }) => grid.at(cell.x, cell.y)

  const approach = at(APPROACH)
  await pointer.move(approach.x, approach.y)
  await pointer.hold(2)

  const start = at(START)
  await pointer.moveTo(start.x, start.y, 8)
  // Still before the press, so the press is not read as part of the travel.
  await pointer.hold(2)

  await pointer.down()

  const corner = at(CORNER)
  await pointer.moveTo(corner.x, corner.y, 8)
  const end = at(END)
  await pointer.moveTo(end.x, end.y, 5)
  await pointer.hold(2)

  await pointer.up()
  // The finished room, held about a second: without a tail the loop restarts on
  // the frame the room appears in and the gesture reads as a flicker.
  await pointer.hold(12)
}
