// What is under the pointer in Select mode: which row of the precedence table a
// gesture can reach.
//
// One file with a hard branch on the sub-mode, and the branch is the first
// thing it does. The two arms share one row (`empty`) and reach entirely
// different things otherwise, which is the documentation that Rooms and Cells
// are two tables rather than one table with a filter over it. Draw's `SubMode`
// is the other shape: rows that all exist in Auto, switched off in threes.
//
// The Rooms arm delegates to `hitTest`, which is not the passthrough it looks
// like. `hitTest` answers "the topmost object of any kind", which is exactly
// what that table's Object row means, and its 1-D-before-2-D order is the one a
// generic selection wants. The Cells arm cannot use it at all: there a room,
// icon, line and transition are all unreachable and every press resolves to a
// cell, which is not something a filter over an `ObjectRef` can say.

import { cellAt, hitTest, type HitScene, type VisibleLayers } from './hitTest'
import type { ScreenPoint } from './viewport'
import type { CellKey } from '@/core/cell'
import type { RoomId } from '@/core/ids'
import type { ObjectRef } from '@/core/types'

// What Select mode selects. A hard branch, not a filter: the two arms reach
// different targets, hold different things, move by different ops and delete by
// different ops. It shares a word with Draw's `SubMode` and nothing else.
export type SelectSubMode = 'rooms' | 'cells'

export type SelectTarget =
  // Rooms: any object, whichever is topmost. One row rather than four, because
  // the table treats a room, transition, icon and line identically in the click
  // columns; the kind is carried in the ref for the drag column, where a
  // transition is a dead cell.
  | { kind: 'object'; cell: CellKey; ref: ObjectRef }
  // Cells: a cell a room owns. Objects standing on it are unreachable here, so
  // this row answers whether or not the cell carries an icon or a door.
  | { kind: 'cell'; cell: CellKey; roomId: RoomId }
  // Bare grid in Rooms, and an unowned cell in Cells. The only row both arms
  // produce, and it means the same thing in each: a click deselects, a drag
  // marquees.
  | { kind: 'empty'; cell: CellKey }

// `layers` is which object layers are drawn. Required rather than defaulted:
// this is the mode that can select anything, so it is the one that has to ask,
// and a default would let a caller forget silently. Cells ignores it, because a
// cell is part of a room and rooms have no toggle to hide them.
export function resolveSelectTarget(
  point: ScreenPoint,
  scene: HitScene,
  subMode: SelectSubMode,
  layers: VisibleLayers,
): SelectTarget {
  const cell = cellAt(point, scene.camera, scene.tileSize)

  if (subMode === 'cells') {
    const roomId = scene.map.cellOwner.get(cell)
    return roomId === undefined ? { kind: 'empty', cell } : { kind: 'cell', cell, roomId }
  }

  const ref = hitTest(point, scene, layers)
  return ref === null ? { kind: 'empty', cell } : { kind: 'object', cell, ref }
}

// Which object a click on this row selects, or null for the row that selects
// nothing. A cell answers a ref like everything else, so both arms reach the
// selection store by the one path every other mode uses.
export function selectRefOf(target: SelectTarget): ObjectRef | null {
  switch (target.kind) {
    case 'object':
      return target.ref
    case 'cell':
      return { kind: 'cell', id: target.cell }
    case 'empty':
      return null
  }
}

// The cursor for a target, from the same resolver the dispatch reads: one
// source, so a cursor cannot promise a press that is not there.
//
// Bare grid gets none. A click there deselects, which needs no aiming, and it
// is the arrow's own meaning already.
export function selectCursor(target: SelectTarget): string | null {
  switch (target.kind) {
    case 'object':
    case 'cell':
      return 'pointer'
    case 'empty':
      return null
  }
}
