// Markup operations: icons and path lines.
//
// The two halves of Markup mode differ in one important way: an icon is
// cell-anchored and must sit inside a room, so room edits carry or kill it. A
// line is a top-layer overlay with no room owner. Room edits never affect
// lines.

import { isAdjacent8, translate } from '../cell'
import type { CellKey } from '../cell'

import type { IconId, LineId } from '../ids'
import type { Transaction } from '../journal'
import {
  moveIcon,
  putIcon,
  putLine,
  removeIcon,
  removeLine,
  setIconField,
  setLineField,
  setLinePoints,
} from '../primitives'
import { mustGet, refuse } from '../outcome'
import type { Outcome } from '../outcome'
import type { IconObject, LineObject, MapModel } from '../types'

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

export interface PlaceIconOptions {
  // Markup's own option: placing on an occupied cell is blocked by default,
  // and the toolbar's "replace" checkbox opts into overwriting.
  replace?: boolean
}

// The two fills of an icon's badge. Callers pass them in rather than the model
// looking them up: `iconType` is an opaque string here, so nothing in core can
// resolve one to its colours.
export interface IconColors {
  plateColor: string
  glyphColor: string
}

// Refuses with a reason the Markup toolbar can act on: `not-in-a-room` is a
// misplaced click, `cell-occupied` is resolved by the "replace" checkbox. A
// bare null could not tell them apart.
export function placeIcon(
  tx: Transaction,
  map: MapModel,
  cell: CellKey,
  iconType: string,
  colors: IconColors,
  options: PlaceIconOptions = {},
): Outcome<IconObject> {
  // Icons must be placed inside a room. Lines have no such rule.
  if (!map.cellOwner.has(cell)) return refuse('not-in-a-room')

  const existingId = map.iconAtCell.get(cell)
  if (existingId !== undefined) {
    if (!options.replace) return refuse('cell-occupied')
    removeIcon(tx, map, mustGet(map.icons, existingId, 'icon'))
  }

  const icon: IconObject = {
    id: tx.ids.mint('ic'),
    iconType,
    cell,
    plateColor: colors.plateColor,
    glyphColor: colors.glyphColor,
    label: '',
    notes: '',
  }
  putIcon(tx, map, icon)
  return icon
}

// Drag-to-reposition, including into another room. Ownership simply follows
// the cell.
export function repositionIcon(
  tx: Transaction,
  map: MapModel,
  iconId: IconId,
  to: CellKey,
  options: PlaceIconOptions = {},
): Outcome {
  const icon = mustGet(map.icons, iconId, 'icon')
  if (!map.cellOwner.has(to)) return refuse('not-in-a-room')

  const existingId = map.iconAtCell.get(to)
  if (existingId !== undefined && existingId !== iconId) {
    if (!options.replace) return refuse('cell-occupied')
    removeIcon(tx, map, mustGet(map.icons, existingId, 'icon'))
  }

  moveIcon(tx, map, icon, to)
}

export function deleteIcon(tx: Transaction, map: MapModel, iconId: IconId): void {
  removeIcon(tx, map, mustGet(map.icons, iconId, 'icon'))
}

export function setIconLabel(tx: Transaction, map: MapModel, iconId: IconId, label: string): void {
  setIconField(tx, map, mustGet(map.icons, iconId, 'icon'), 'label', label)
}

export function setIconNotes(tx: Transaction, map: MapModel, iconId: IconId, notes: string): void {
  setIconField(tx, map, mustGet(map.icons, iconId, 'icon'), 'notes', notes)
}

// Sets both fills together. The two writes share the caller's transaction, so
// a recolour undoes in one step rather than two.
export function setIconColors(
  tx: Transaction,
  map: MapModel,
  iconId: IconId,
  colors: IconColors,
): void {
  const icon = mustGet(map.icons, iconId, 'icon')
  setIconField(tx, map, icon, 'plateColor', colors.plateColor)
  setIconField(tx, map, icon, 'glyphColor', colors.glyphColor)
}

export function changeIconType(
  tx: Transaction,
  map: MapModel,
  iconId: IconId,
  iconType: string,
): void {
  setIconField(tx, map, mustGet(map.icons, iconId, 'icon'), 'iconType', iconType)
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export interface LineDefaults {
  color: string
  arrowStart: boolean
  arrowEnd: boolean
}

// A line is a simple two-ended polyline of unit steps to any of the 8 adjacent
// cells. Minimum one segment: a click that never crosses into an adjacent cell
// makes no line at all.
export function createLine(
  tx: Transaction,
  map: MapModel,
  points: CellKey[],
  defaults: LineDefaults,
): Outcome<LineObject> {
  const path = normalizePath(points)
  // Minimum one segment (2 cells). A click that never crossed into an adjacent
  // cell makes no line, which the gesture layer wants to know about so it can
  // fall through to the icon picker.
  if (path.length < 2) return refuse('too-short')

  const line: LineObject = {
    id: tx.ids.mint('ln'),
    color: defaults.color,
    points: path,
    arrowStart: defaults.arrowStart,
    arrowEnd: defaults.arrowEnd,
    label: '',
    notes: '',
  }
  putLine(tx, map, line)
  return line
}

// Drops repeats and anything that is not a unit step from its predecessor.
// No jumps or gaps. A drag that skips cells (fast pointer movement) is the
// gesture layer's problem to interpolate. This guards against malformed paths
// in the model.
export function normalizePath(points: CellKey[]): CellKey[] {
  const path: CellKey[] = []
  for (const point of points) {
    const last = path[path.length - 1]
    if (last === point) continue
    if (last !== undefined && !isAdjacent8(last, point)) break
    path.push(point)
  }
  return path
}

// Lines extend only from their two ends. `atStart` says which end the drag
// began from; the new points are appended in draw order.
export function extendLine(
  tx: Transaction,
  map: MapModel,
  lineId: LineId,
  atStart: boolean,
  points: CellKey[],
): Outcome {
  const line = mustGet(map.lines, lineId, 'line')

  const anchor = atStart ? line.points[0] : line.points[line.points.length - 1]
  const added = normalizePath([anchor, ...points]).slice(1)
  if (added.length === 0) return refuse('too-short')

  setLinePoints(
    tx,
    map,
    line,
    atStart ? [...added.reverse(), ...line.points] : [...line.points, ...added],
  )
}

// Right-click-and-drag-back peels segments off an end, one at a time. A middle
// segment can never be deleted: the line has exactly two ends and no way to
// split.
export function peelLine(
  tx: Transaction,
  map: MapModel,
  lineId: LineId,
  atStart: boolean,
  count = 1,
): void {
  const line = mustGet(map.lines, lineId, 'line')
  // Peeling nothing writes nothing. `setLinePoints` records whatever it is
  // handed without comparing, so an unguarded zero would leave an undo step for
  // a line that never changed.
  if (count <= 0) return

  const remaining = line.points.length - count
  // Peeling below one segment leaves nothing meaningful, so the line goes.
  if (remaining < 2) {
    removeLine(tx, map, line)
    return
  }

  setLinePoints(tx, map, line, atStart ? line.points.slice(count) : line.points.slice(0, remaining))
}

export function deleteLine(tx: Transaction, map: MapModel, lineId: LineId): void {
  removeLine(tx, map, mustGet(map.lines, lineId, 'line'))
}

export function setLineStyle<K extends 'color' | 'arrowStart' | 'arrowEnd' | 'label' | 'notes'>(
  tx: Transaction,
  map: MapModel,
  lineId: LineId,
  key: K,
  value: LineObject[K],
): void {
  setLineField(tx, map, mustGet(map.lines, lineId, 'line'), key, value)
}

// Translating a line is the only way a line ever moves. Lines never move
// incidentally with a room.
export function translateLine(
  tx: Transaction,
  map: MapModel,
  lineId: LineId,
  dx: number,
  dy: number,
): void {
  const line = mustGet(map.lines, lineId, 'line')
  if (dx === 0 && dy === 0) return
  setLinePoints(
    tx,
    map,
    line,
    line.points.map((point) => translate(point, dx, dy)),
  )
}
