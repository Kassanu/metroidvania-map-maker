// The gestures the wiki's GIFs are captured from, one function per GIF, plus
// the setup a still needs the app driven into.
//
// A gesture is aimed through `gridMapping`, which solves the world-to-screen
// mapping from the coords overlay, so nothing here hard-codes a cell size, a
// ruler thickness or the sample's default pan. Cells throughout: integers land
// on grid lines, so `{ x: 2, y: 6 }` is a vertex and `{ x: 2.5, y: 6.5 }` is a
// cell centre.
//
// Every gesture runs at the pointer's own pace: each `move`, `down`, `up` and
// `hold` is one frame at 15 fps, so step counts here are durations. A gesture
// ends holding its result long enough to read before the loop restarts.
//
// A gesture that operates a toolbar control does it through the control, with
// the synthetic cursor on it, because a setting that changed with nothing
// visible causing it is the question the image was there to answer. The one
// exception is the area picker: it is a native select, whose open dropdown is
// an OS popup no screenshot can capture.
//
// Not a `.spec.ts`, so Playwright collects no tests from it.

import type { Locator, Page } from '@playwright/test'
import { gridMapping } from '../../support/canvas'
import type { Pointer } from './cursor'

// A world position, in cells.
interface Cell {
  x: number
  y: number
}

// Frames held on the finished result. Without a tail the loop restarts on the
// frame the result appears in and the gesture reads as a flicker.
const TAIL = 12

// Frames held still before a press, so the press is not read as part of the
// travel that reached it.
const SETTLE = 2

// Frames held on a beat that changed something away from the pointer: a
// swatch, a readout, a toolbar button going active.
const BEAT = 6

// Frames the pointer takes to cross the window to a toolbar control and back.
const TRAVEL = 12

// Binds the solved mapping to the cell constants below.
async function aim(page: Page) {
  const grid = await gridMapping(page)
  return (cell: Cell) => grid.at(cell.x, cell.y)
}

// Moves the cursor onto a control and clicks it.
//
// Blurred afterwards: the click leaves focus on the control, and a focus ring
// that outlives the beat it belongs to reads as part of the next one.
async function clickControl(page: Page, pointer: Pointer, control: Locator, travel = TRAVEL) {
  const box = await control.boundingBox()
  if (!box) throw new Error('no control to click')

  await pointer.moveTo(box.x + box.width / 2, box.y + box.height / 2, travel)
  await pointer.hold(SETTLE)
  await pointer.down()
  await pointer.up()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

// Sets the toolbar's area picker, with the cursor parked on it.
//
// `selectOption` rather than a click: the picker is a native select, so its
// open dropdown is an OS popup Playwright never captures and the synthetic
// cursor cannot draw over. The swatch beside it and the colour of the room
// that follows carry the beat instead.
async function pickArea(page: Page, pointer: Pointer, area: string, travel = TRAVEL) {
  const picker = page.locator('.area-select')
  const box = await picker.boundingBox()
  if (!box) throw new Error('no area picker')

  await pointer.moveTo(box.x + box.width / 2, box.y + box.height / 2, travel)
  await pointer.hold(SETTLE)
  await picker.selectOption({ label: area })
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await pointer.hold(BEAT)
}

// Drags the pointer through a run of cells with the button down, one leg at a
// time. The first cell is where the press lands.
async function stroke(pointer: Pointer, at: (cell: Cell) => Cell, path: Cell[], steps: number) {
  const [first, ...rest] = path
  const start = at(first)
  await pointer.moveTo(start.x, start.y, TRAVEL)
  await pointer.hold(SETTLE)

  await pointer.down()
  for (const leg of rest) {
    const point = at(leg)
    await pointer.moveTo(point.x, point.y, steps)
  }
  await pointer.hold(SETTLE)
  await pointer.up()
}

// Rows 5 to 7 of sunken-city's Harbour map are clear: its two rooms occupy rows
// 0 to 2, so a room drawn below them has nothing to overlap. Every gesture that
// needs empty grid uses that band, and every one that needs an existing room
// uses the Drowned Quarter room at cells (0,0) to (3,2).
const CLEAR_GRID = { x: 6.5, y: 8.5 }

// Drawing paints the cells the pointer sweeps; it is not a rubber band that
// fills a rectangle. The path turns a corner for that reason: a straight drag
// leaves a shape a rectangle tool would also have produced, and the corner is
// what makes the difference visible.
const DRAW_PATH: Cell[] = [
  { x: 1.5, y: 5.5 },
  { x: 5.5, y: 5.5 },
  { x: 5.5, y: 7.5 },
]
const DRAW_APPROACH = { x: 8.5, y: 5.5 }

export async function drawARoom(page: Page, pointer: Pointer) {
  const at = await aim(page)

  const approach = at(DRAW_APPROACH)
  await pointer.move(approach.x, approach.y)
  await pointer.hold(SETTLE)

  const [start, corner, end] = DRAW_PATH.map(at)
  await pointer.moveTo(start.x, start.y, 8)
  // Still before the press, so the press is not read as part of the travel.
  await pointer.hold(SETTLE)

  await pointer.down()
  await pointer.moveTo(corner.x, corner.y, 8)
  await pointer.moveTo(end.x, end.y, 5)
  await pointer.hold(SETTLE)

  await pointer.up()
  // The finished room, held about a second: without a tail the loop restarts on
  // the frame the room appears in and the gesture reads as a flicker.
  await pointer.hold(TAIL)
}

// A smaller L than `drawARoom`'s, because the subject here is the colour it
// comes out in and the stroke is only how it gets drawn.
const AREA_ROOM: Cell[] = [
  { x: 1.5, y: 5.5 },
  { x: 3.5, y: 5.5 },
  { x: 3.5, y: 6.5 },
]

// Spires rather than Drowned Quarter: Drowned Quarter's room is the left of the
// two on the map, so the new room reads left to right against it.
const SECOND_AREA = 'Spires'

export async function chooseAnArea(page: Page, pointer: Pointer) {
  const at = await aim(page)

  const approach = at(CLEAR_GRID)
  await pointer.move(approach.x, approach.y)
  await pointer.hold(SETTLE)

  await pickArea(page, pointer, SECOND_AREA)

  await stroke(pointer, at, AREA_ROOM, 6)
  await pointer.hold(TAIL)
}

// Three by three is the smallest room with an interior cell, and the extend has
// to press one: a press on a thinner room lands on an edge run and resizes it
// instead. Drawn as a boustrophedon because the brush is one cell.
const KEEPS_ROOM: Cell[] = [
  { x: 1.5, y: 5.5 },
  { x: 3.5, y: 5.5 },
  { x: 3.5, y: 6.5 },
  { x: 1.5, y: 6.5 },
  { x: 1.5, y: 7.5 },
  { x: 3.5, y: 7.5 },
]
const KEEPS_INSIDE = { x: 2.5, y: 6.5 }
const KEEPS_OUT_TO = { x: 6.5, y: 6.5 }

export async function extendKeepsItsArea(page: Page, pointer: Pointer) {
  const at = await aim(page)

  const approach = at(CLEAR_GRID)
  await pointer.move(approach.x, approach.y)
  await pointer.hold(SETTLE)

  // Drawn on the World default, so the room the picker moves off is the room
  // the extend leaves alone.
  await stroke(pointer, at, KEEPS_ROOM, 4)
  await pointer.hold(BEAT)

  await pickArea(page, pointer, SECOND_AREA)

  await stroke(pointer, at, [KEEPS_INSIDE, KEEPS_OUT_TO], 8)
  await pointer.hold(TAIL)
}

// A three-cell brush centred on row 6 paints rows 5 to 7, so the band lands in
// the clear part of the map whichever way the stroke runs.
const BRUSH_STROKE: Cell[] = [
  { x: 1.5, y: 6.5 },
  { x: 6.5, y: 6.5 },
]

export async function brushSize(page: Page, pointer: Pointer) {
  const at = await aim(page)

  const approach = at(CLEAR_GRID)
  await pointer.move(approach.x, approach.y)
  await pointer.hold(SETTLE)

  // The toolbar button rather than `]`: a key press draws nothing, so the cause
  // of a wider stroke would be invisible.
  const larger = page.getByTitle('Larger brush (])')
  await clickControl(page, pointer, larger)
  await pointer.hold(BEAT)
  // Already on the button, so the second click is a beat rather than a journey.
  await clickControl(page, pointer, larger, 1)
  await pointer.hold(BEAT)

  await stroke(pointer, at, BRUSH_STROKE, 10)
  await pointer.hold(TAIL)
}

// Cell (2,1) is the Drowned Quarter room's one interior cell that the save icon
// is not sitting on, so a press there resolves as interior rather than as an
// edge run or a vertex.
const ROOM_INSIDE = { x: 2.5, y: 1.5 }

// Down through the flat bottom wall rather than out through a corner, so the
// wall the extension swallows is visible going. It stops short of column 5:
// carried further right the new cells run under the Spires room, and an
// extension that looks about to take a room is the next section's subject.
const EXTEND_PATH: Cell[] = [ROOM_INSIDE, { x: 2.5, y: 3.5 }, { x: 4.5, y: 3.5 }]
const ROOM_APPROACH = { x: -1.5, y: 1.5 }

export async function extendARoom(page: Page, pointer: Pointer) {
  const at = await aim(page)

  const approach = at(ROOM_APPROACH)
  await pointer.move(approach.x, approach.y)
  await pointer.hold(SETTLE)

  await stroke(pointer, at, EXTEND_PATH, 6)
  await pointer.hold(TAIL)
}

// Across the two-cell gap into the Spires room. The pause is inside the second
// room and before the release: the highlight is the only warning the app gives
// that the room is about to be taken, and it is the point of the image.
const ABSORB_PATH: Cell[] = [ROOM_INSIDE, { x: 5.5, y: 1.5 }, { x: 7.5, y: 1.5 }]
const HIGHLIGHT_HOLD = 16

export async function absorbARoom(page: Page, pointer: Pointer) {
  const at = await aim(page)

  const approach = at(ROOM_APPROACH)
  await pointer.move(approach.x, approach.y)
  await pointer.hold(SETTLE)

  const [start, gap, into] = ABSORB_PATH.map(at)
  await pointer.moveTo(start.x, start.y, TRAVEL)
  await pointer.hold(SETTLE)

  await pointer.down()
  await pointer.moveTo(gap.x, gap.y, 8)
  await pointer.moveTo(into.x, into.y, 5)
  await pointer.hold(HIGHLIGHT_HOLD)

  // On the release, never on Esc: the section is about what taking a room does.
  await pointer.up()
  await pointer.hold(TAIL)
}

// Three by three again, for the same reason `extendKeepsItsArea` needs one: the
// second stroke starts on a vertex, and only an interior vertex is one the Auto
// lock would have swallowed into an inner wall.
//
// A row higher than that room, and painting away downwards rather than out to
// the right, so the two do not finish on the same silhouette. Row 4 still
// leaves row 3 clear between the new room and the Drowned Quarter room above
// it: a stroke that touches an existing room grows that one instead.
const LOCK_ROOM: Cell[] = [
  { x: 1.5, y: 4.5 },
  { x: 3.5, y: 4.5 },
  { x: 3.5, y: 5.5 },
  { x: 1.5, y: 5.5 },
  { x: 1.5, y: 6.5 },
  { x: 3.5, y: 6.5 },
]
const LOCK_PAINT: Cell[] = [
  { x: 2, y: 5 },
  { x: 2.5, y: 7.5 },
  { x: 5.5, y: 7.5 },
]

export async function lockCells(page: Page, pointer: Pointer) {
  const at = await aim(page)

  const approach = at(CLEAR_GRID)
  await pointer.move(approach.x, approach.y)
  await pointer.hold(SETTLE)

  const cells = page.getByRole('radiogroup', { name: 'Lock' }).getByRole('radio', { name: 'Cells' })
  await clickControl(page, pointer, cells)
  await pointer.hold(BEAT)

  await stroke(pointer, at, LOCK_ROOM, 4)
  await pointer.hold(BEAT)

  // Under Cells the vertex is not drawn and the cursor stays an arrow, so what
  // shows is the room growing where a wall would otherwise have been drawn.
  await stroke(pointer, at, LOCK_PAINT, 6)
  await pointer.hold(TAIL)
}

// The three inner-wall styles, drawn for a still rather than filmed.
//
// One cell each: a doorway is a segment missing its centre third, cut per cell
// edge, so a wall two cells long carries two gaps and reads as a dash instead
// of as a doorway.
const WALL_STYLES = ['Solid', 'Dotted', 'Doorway'] as const
const WALL_COLUMNS = [-3, 0, 3]

// One drag with a three-cell brush, rather than three passes with the default
// one: an inner wall needs a room with an interior to sit in.
const WALL_ROOM: Cell[] = [
  { x: -4.5, y: 0.5 },
  { x: 4.5, y: 0.5 },
]

export async function drawWallStyles(page: Page) {
  const grid = await gridMapping(page)

  const larger = page.getByTitle('Larger brush (])')
  await larger.click()
  await larger.click()

  const [from, to] = WALL_ROOM.map((cell) => grid.at(cell.x, cell.y))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()

  const styles = page.getByRole('radiogroup', { name: 'Wall' })
  for (const [index, style] of WALL_STYLES.entries()) {
    await styles.getByRole('radio', { name: style }).click()

    const column = WALL_COLUMNS[index]
    const top = grid.at(column, 0)
    const bottom = grid.at(column, 1)
    await page.mouse.move(top.x, top.y)
    await page.mouse.down()
    await page.mouse.move(bottom.x, bottom.y, { steps: 6 })
    await page.mouse.up()
  }

  // Drawing leaves the room selected, which puts resize handles on its outer
  // walls, and the vertex points draw within two cells of the pointer. Neither
  // belongs in a still whose subject is three lines.
  await page.keyboard.press('Escape')
  await page.mouse.move(0, 0)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}
