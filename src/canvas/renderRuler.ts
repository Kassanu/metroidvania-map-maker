import { screenToWorld, worldToScreen } from './viewport'
import type { Camera } from './camera'
import type { CanvasPalette } from './palette'

// Ruler thickness in CSS px, bound into a custom property so the CSS grid
// track and the canvas it sizes can't drift apart.
export const RULER_THICKNESS = 20

// Real rulers don't label every tick either: labelling every cell would
// overlap at one-tile spacing.
const MAJOR_TICK_INTERVAL = 5
// Major ticks reach almost the full thickness so they read as the dominant
// mark; minor ticks stay clearly visible rather than a sliver at the edge.
const MAJOR_TICK_LENGTH = 17
const MINOR_TICK_LENGTH = 9

const LABEL_FONT = '10px sans-serif'

export type RulerAxis = 'x' | 'y'
export type RulerUnits = 'cells' | 'px'

export interface RulerScene {
  axis: RulerAxis
  // Length along the ruler's own axis, in CSS px.
  length: number
  camera: Camera
  // `settings.tileSize`: both the scale for positioning ticks and, in 'px'
  // units, the multiplier the labels themselves are counted in.
  tileSize: number
  palette: CanvasPalette
  units: RulerUnits
}

// Rulers span the whole visible viewport rather than just the page (as in
// Photoshop/draw.io), so ticks continue into the pasteboard either side and
// the ruler always matches what's on screen as you pan and zoom.
export function renderRuler(ctx: CanvasRenderingContext2D, scene: RulerScene) {
  const { axis, length, camera, tileSize, palette, units } = scene

  const width = axis === 'x' ? length : RULER_THICKNESS
  const height = axis === 'x' ? RULER_THICKNESS : length

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = palette.ruler
  ctx.fillRect(0, 0, width, height)

  const [firstCell, lastCell] = visibleCellRange(axis, length, camera, tileSize)

  ctx.strokeStyle = palette.rulerTick
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let cell = firstCell; cell <= lastCell; cell++) {
    const pos = cellPosition(axis, cell, camera, tileSize)
    const tickLength = cell % MAJOR_TICK_INTERVAL === 0 ? MAJOR_TICK_LENGTH : MINOR_TICK_LENGTH
    if (axis === 'x') {
      ctx.moveTo(pos, RULER_THICKNESS - tickLength)
      ctx.lineTo(pos, RULER_THICKNESS)
    } else {
      ctx.moveTo(RULER_THICKNESS - tickLength, pos)
      ctx.lineTo(RULER_THICKNESS, pos)
    }
  }
  ctx.stroke()

  ctx.fillStyle = palette.rulerText
  ctx.font = LABEL_FONT
  for (let cell = firstCell; cell <= lastCell; cell++) {
    if (cell % MAJOR_TICK_INTERVAL !== 0) continue
    const pos = cellPosition(axis, cell, camera, tileSize)
    const label = units === 'cells' ? String(cell) : String(Math.round(cell * tileSize))
    if (axis === 'x') {
      ctx.fillText(label, pos + 2, 9)
    } else {
      // Rotated so the label reads bottom-to-top along the left ruler.
      ctx.save()
      ctx.translate(9, pos - 2)
      ctx.rotate(-Math.PI / 2)
      ctx.fillText(label, 0, 0)
      ctx.restore()
    }
  }
}

function cellPosition(axis: RulerAxis, cell: number, camera: Camera, tileSize: number): number {
  return axis === 'x'
    ? worldToScreen(cell, 0, camera, tileSize).x
    : worldToScreen(0, cell, camera, tileSize).y
}

// Which whole cells fall within the ruler's length, inclusive of the partial
// ones at each end.
export function visibleCellRange(
  axis: RulerAxis,
  length: number,
  camera: Camera,
  tileSize: number,
): [first: number, last: number] {
  const start = screenToWorld(0, 0, camera, tileSize)
  const end = screenToWorld(axis === 'x' ? length : 0, axis === 'x' ? 0 : length, camera, tileSize)
  const from = axis === 'x' ? start.x : start.y
  const to = axis === 'x' ? end.x : end.y
  return [Math.floor(Math.min(from, to)), Math.ceil(Math.max(from, to))]
}
