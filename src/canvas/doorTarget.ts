// What is under the pointer in Door mode: which row of the precedence table a
// gesture can reach.
//
// Identifies the target (empty, room, door, or teleport) but not what the
// gesture does. That separation lets gestures be added incrementally without
// promising a row that dispatch does not yet handle.
//
// Not a second hit-tester. Door mode's targets are objects with `ObjectRef`s,
// resolved by `hitTest.ts`. This file maps those onto table rows and adds the
// room under the pointer (which gestures need to know).

import { cellAt, transitionAt, type HitScene } from './hitTest'
import { teleportEndAt, type TeleportEnd } from './teleports'
import type { ScreenPoint } from './viewport'
import type { CellKey } from '@/core/cell'
import type { RoomId, TransitionId } from '@/core/ids'
import type { ObjectRef } from '@/core/types'

export type DoorTarget =
  // Bare grid, or a cell with neither a room nor a transition. No gestures start
  // here; this row is inert.
  | { kind: 'empty'; cell: CellKey }
  // A room cell with no transition: the only row that starts something. Tap
  // begins a teleport; drag rubber-bands a box.
  | { kind: 'room'; cell: CellKey; roomId: RoomId }
  // An edge-hit: an edge door or one end of an elevator. One row, because both
  // are anchored to a cell edge and selected by clicking near it.
  //
  // `roomId` is nullable: an elevator's endpoints are facing edges, so the gap
  // cell on the far side shares that edge. A press there selects a transition
  // while standing on no room.
  | { kind: 'door'; cell: CellKey; roomId: RoomId | null; id: TransitionId }
  // An interior hit on a teleport endpoint: near end or far marker, which are
  // the same target on screen and so the same row here.
  | {
      kind: 'teleport'
      cell: CellKey
      roomId: RoomId | null
      id: TransitionId
      // Non-null when the other end is on another tab: where the far marker
      // leads to.
      leadsTo: TeleportEnd['leadsTo']
    }

export function resolveDoorTarget(point: ScreenPoint, scene: HitScene): DoorTarget {
  const cell = cellAt(point, scene.camera, scene.tileSize)
  const roomId = scene.map.cellOwner.get(cell) ?? null

  // Existing transitions beat room cells: an existing transition is answered
  // before the room cell it sits on, so a press never starts a new one when one
  // already exists.
  const hit = transitionAt(point, scene)
  if (hit?.kind === 'transition') {
    const teleport = teleportEndAt(scene.project, scene.map.id, cell)
    // The hit zone tells which row: an edge-hit returns a transition that is not
    // the teleport on this cell, so when a teleport and door share a cell, an
    // edge-near press yields the door and a cell-center press yields the teleport.
    if (teleport && teleport.id === hit.id) {
      return { kind: 'teleport', cell, roomId, id: hit.id, leadsTo: teleport.leadsTo }
    }
    return { kind: 'door', cell, roomId, id: hit.id }
  }

  if (roomId === null) return { kind: 'empty', cell }
  return { kind: 'room', cell, roomId }
}

// Which object a click on this row selects, or null for the rows that select
// nothing. Both transition rows answer a transition, including a cross-tab
// teleport clicked on its far marker: the marker is derived rather than stored,
// but it carries the same transition id, which counts as alive from either end.
export function doorRefOf(target: DoorTarget): ObjectRef | null {
  switch (target.kind) {
    case 'door':
    case 'teleport':
      return { kind: 'transition', id: target.id }
    case 'room':
    case 'empty':
      return null
  }
}

// The cell a gesture would start from, or null if none would start.
//
// Most rows answer with their cell, but two do not: bare grid (empty row) and
// an elevator's facing edge seen from the gap (no room on the far side). These
// return null because a box drag needs an origin room.
export function gestureOriginCell(target: DoorTarget): CellKey | null {
  return target.kind !== 'empty' && target.roomId !== null ? target.cell : null
}

// The cursor for a target. Derived from the same logic as resolveDoorTarget:
// one source, every reader. A cursor promising a gesture that is not there is
// worse than no cursor at all.
//
// When erasing is on, only rows with something to delete offer a cursor; room
// cells offer nothing.
export function doorCursor(target: DoorTarget, erasing = false): string | null {
  switch (target.kind) {
    case 'empty':
      return null
    // Both creation gestures start here. Crosshair signals "aim here", like Draw
    // mode over an inner-wall vertex. No erase on a non-transition.
    case 'room':
      return erasing ? null : 'crosshair'
    // Existing transition: pointer not crosshair, because this is a click on a
    // thing that exists, not an aim at empty space. Same cursor for delete.
    case 'door':
    case 'teleport':
      return 'pointer'
  }
}
