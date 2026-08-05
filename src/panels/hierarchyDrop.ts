import type { AreaId, RoomId } from '@/core/ids'

// Where a room being dragged over the tree would land, and what that means for
// `roomOrder`. Both halves are pure: jsdom has no layout, so anything reading
// real rects cannot be tested, and the geometry is the only part that must be.
//
// Two drop semantics, deliberately non-overlapping, so the preview can promise
// exactly one thing:
//
//   an area row  -> join that area, at the end of it
//   a room row   -> sit before or after that room, by which half is under the
//                   pointer, joining that room's area if it is not already in it
//
// A room row therefore has no "drop into" of its own. Rooms do not contain
// rooms, and giving the middle of a row a third meaning would make the two
// useful ones harder to hit.

export interface DropRow {
  kind: 'area' | 'room'
  id: string
  top: number
  height: number
}

export type DropTarget =
  { kind: 'intoArea'; areaId: AreaId } | { kind: 'beside'; roomId: RoomId; after: boolean }

export function dropTargetAt(pointerY: number, rows: readonly DropRow[]): DropTarget | null {
  for (const row of rows) {
    if (pointerY < row.top || pointerY >= row.top + row.height) continue
    if (row.kind === 'area') return { kind: 'intoArea', areaId: row.id as AreaId }
    return { kind: 'beside', roomId: row.id as RoomId, after: pointerY >= row.top + row.height / 2 }
  }
  return null
}

export interface DropPlan {
  areaId: AreaId
  // An index into `roomOrder` with the dragged room already removed, which is
  // what `reorderRoom` takes. `null` leaves the order alone: dropping into an
  // area that holds nothing else has no neighbour to sit next to.
  toIndex: number | null
}

// What the drop resolves to, given the map's current order and each room's
// area. Separate from the geometry above because this half is what has to
// agree with the ops, and it is where the "a cross-area insert is both a
// reassign and a placement" rule is stated once.
export function planDrop(
  target: DropTarget,
  dragged: RoomId,
  roomOrder: readonly RoomId[],
  areaOf: (roomId: RoomId) => AreaId | undefined,
): DropPlan | null {
  // Measured without the dragged room, because `reorderRoom` removes it before
  // inserting: an index counted with it still in place is off by one whenever
  // the room is moving forward.
  const rest = roomOrder.filter((id) => id !== dragged)

  if (target.kind === 'intoArea') {
    let last = -1
    for (let i = 0; i < rest.length; i++) {
      if (areaOf(rest[i]) === target.areaId) last = i
    }
    return { areaId: target.areaId, toIndex: last === -1 ? null : last + 1 }
  }

  if (target.roomId === dragged) return null
  const areaId = areaOf(target.roomId)
  if (!areaId) return null
  const at = rest.indexOf(target.roomId)
  if (at === -1) return null
  return { areaId, toIndex: target.after ? at + 1 : at }
}
