// What is under the pointer in Markup mode: which row of the precedence table a
// gesture can reach.
//
// Identifies the target but not what the gesture does, so gestures can be added
// one at a time without a row promising something dispatch does not yet handle.
//
// Not a filter over `hitTest`, and this is the first mode where it could not be.
// Two reasons, both structural:
//
//   1. Markup resolves icon before line, where `hitTest` tests 1-D targets
//      before 2-D ones. For an icon and a line sharing a cell the two answer
//      differently, and Markup's order is the locked one.
//   2. `hitTest` answers `{ kind: 'line', id }` with no way to say which end,
//      or whether the hit was in the middle. Three rows turn on exactly that.
//
// `hitTest` keeps its own order, which is right for the modes built on it: its
// 1-D-first rule exists for straddling grab bands and for edge doors inside
// rooms, and Markup has neither. It has no edge targets at all.

import { cellAt, lineAt, lineEndAt, type HitScene } from './hitTest'
import type { ScreenPoint } from './viewport'
import type { CellKey } from '@/core/cell'
import type { IconId, LineId, RoomId } from '@/core/ids'
import type { ObjectRef } from '@/core/types'

export type MarkupTarget =
  // The pointer's cell holds an icon. Beats both line rows, which is the whole
  // reason this resolver exists.
  | { kind: 'icon'; cell: CellKey; roomId: RoomId | null; id: IconId }
  // Within the endpoint radius of either end of a line. `atStart` says which,
  // because extend and peel both act on one named end.
  | { kind: 'line-end'; cell: CellKey; roomId: RoomId | null; id: LineId; atStart: boolean }
  // Within the grab band of a line, away from both its ends.
  | { kind: 'line-body'; cell: CellKey; roomId: RoomId | null; id: LineId }
  // A room cell with nothing on it: a click opens the picker, a drag draws.
  | { kind: 'room'; cell: CellKey; roomId: RoomId }
  // Bare grid. Unlike Door mode's empty row this is not inert: a line may be
  // drawn outside every room, so the drag column reaches here.
  | { kind: 'empty'; cell: CellKey }

export function resolveMarkupTarget(point: ScreenPoint, scene: HitScene): MarkupTarget {
  const cell = cellAt(point, scene.camera, scene.tileSize)
  const roomId = scene.map.cellOwner.get(cell) ?? null

  // An icon claims its whole cell, so this is a lookup rather than a distance
  // test, and it comes first: icon beats line-endpoint beats line-body.
  const iconId = scene.map.iconAtCell.get(cell)
  if (iconId !== undefined) return { kind: 'icon', cell, roomId, id: iconId }

  const end = lineEndAt(point, scene)
  if (end) return { kind: 'line-end', cell, roomId, id: end.id, atStart: end.atStart }

  const body = lineAt(point, scene)
  if (body?.kind === 'line') return { kind: 'line-body', cell, roomId, id: body.id }

  // Rooms are reported on every row above but decide only this one: a line is
  // hit the same way inside a room, outside one, and lying across a wall.
  if (roomId === null) return { kind: 'empty', cell }
  return { kind: 'room', cell, roomId }
}

// Which object a click on this row selects, or null for the rows that select
// nothing. Both line rows answer the same line: which end the pointer is near
// changes what a drag does, never what is selected.
export function markupRefOf(target: MarkupTarget): ObjectRef | null {
  switch (target.kind) {
    case 'icon':
      return { kind: 'icon', id: target.id }
    case 'line-end':
    case 'line-body':
      return { kind: 'line', id: target.id }
    case 'room':
    case 'empty':
      return null
  }
}

// What an armed icon would do with a click, which is not what the table says a
// click does: while armed, every row's click column is replaced by "place the
// armed icon here".
//
// Three answers, because a refused placement has to look refused before the
// click rather than after it. `blocked` is the cell-occupied case with replace
// off, which the toolbar's checkbox is what resolves.
export type ArmedPlacement = 'place' | 'replace' | 'blocked' | 'not-in-a-room'

// `ignoring` is the icon being dragged, which does not count as occupying the
// cell it is currently on: a drag that goes out and comes back is a no-op, not
// a collision with itself. `repositionIcon` makes the same exception.
export function armedPlacementAt(
  target: MarkupTarget,
  replace: boolean,
  ignoring?: IconId,
): ArmedPlacement {
  // Icons must be placed inside a room; lines are the thing with no room owner,
  // so a line row on bare grid is still nowhere to put an icon.
  if (target.kind === 'empty' || target.roomId === null) return 'not-in-a-room'
  // The cell holds one already. Any other row means the cell is free, since an
  // icon outranks both line rows in the same cell.
  if (target.kind !== 'icon' || target.id === ignoring) return 'place'
  return replace ? 'replace' : 'blocked'
}

// The cursor for a target. Derived from the same resolver dispatch reads: one
// source, every reader, so a cursor cannot promise a gesture that is not there.
//
// While erasing, only rows with something to delete offer a cursor. A line's
// body has nothing: peel works from an end, and right-clicking a body does
// nothing at all.
//
// An armed icon outranks both columns, because it has replaced the click for
// every row. Erase still outranks it: the toggle governs the whole primary
// button, so a placement cursor over a cell a click would delete from would be
// a lie.
export function markupCursor(
  target: MarkupTarget,
  erasing = false,
  armed: { replace: boolean } | null = null,
): string | null {
  if (armed && !erasing) {
    switch (armedPlacementAt(target, armed.replace)) {
      case 'not-in-a-room':
        return null
      // Refused before the press, so "nothing happened" is never the first
      // thing the user learns about the replace rule.
      case 'blocked':
        return 'not-allowed'
      case 'place':
      case 'replace':
        return 'copy'
    }
  }

  switch (target.kind) {
    // Both start a line on a drag, so both aim rather than point. `empty` is a
    // real target here, which is where this parts company with Door mode.
    case 'empty':
    case 'room':
      return erasing ? null : 'crosshair'
    case 'line-body':
      return erasing ? null : 'pointer'
    // Something that exists, under the pointer: select, move, extend or peel.
    case 'icon':
    case 'line-end':
      return 'pointer'
  }
}
