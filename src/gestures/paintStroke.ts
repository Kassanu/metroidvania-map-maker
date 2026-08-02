// The paint stroke: the first canvas gesture, and the template for the rest.
//
// `src/gestures/` rather than `src/canvas/` because a gesture is stateful and
// stores-aware: it holds an open transaction across a drag and talks to the
// model seam, where `src/canvas/` is pure functions of a scene. Every later
// tool (resize, move, door, markup) lands beside this one with the same shape:
// begin on press, `reapply` on move, settle on release.
//
// The loop itself is `cellStroke.ts`, shared with erase. What is here is only
// what makes a stroke a paint stroke: the origin room, and the ghost.

import { beginCellStroke, type CellStroke } from './cellStroke'
import { useModelStore } from '@/stores/model'
import { useActiveRoomStore } from '@/stores/activeRoom'
import { useDrawAreaStore } from '@/stores/drawArea'
import { paintCells, roomsTouchedBy } from '@/core/ops/rooms'
import { cellKey } from '@/core/cell'
import { t } from '@/i18n'
import type { WorldPoint } from '@/canvas/stroke'
import type { CellKey } from '@/core/cell'
import type { MapId, RoomId } from '@/core/ids'
import type { MapModel } from '@/core/types'

// Returns null when the map is gone: nothing to paint on, and the caller
// simply does not start a stroke.
export function beginPaintStroke(
  mapId: MapId,
  origin: WorldPoint,
  onChange: () => void,
): CellStroke | null {
  const model = useModelStore()
  const drawArea = useDrawAreaStore()
  const map = model.project.mapsById.get(mapId)
  if (!map) return null

  // The room where the stroke started always wins, decided at press time and
  // never re-read: deciding it per frame would make the winner depend on
  // pointer speed, and a stroke that crossed into another room would hand
  // itself over instead of absorbing it.
  const intoRoomId = map.cellOwner.get(cellKey(Math.floor(origin.x), Math.floor(origin.y)))

  // The room the stroke painted into or created. Re-read on every re-apply,
  // which is safe because `Transaction.reset()` rewinds the id source: a
  // created room keeps the same id on every re-apply.
  let paintedRoomId: RoomId | undefined

  return beginCellStroke({
    mapId,
    origin,
    onChange,
    label: t('history.paint'),
    absorbing: (cells) => absorbedCells(map, cells, intoRoomId),
    apply: (transaction, cells) => {
      paintedRoomId = paintCells(transaction, model.project, map, cells, {
        intoRoomId,
        // Whichever area is selected is assigned to a room as it is created.
        // Read per re-apply rather than captured at press: unlike the brush
        // size, there is no accumulated result for a mid-stroke change to
        // retroactively rewrite, since `paintCells` only consults this when it
        // creates the room. A grow stroke ignores it entirely, and a new room
        // ends up in whichever area was selected on release.
        areaId: drawArea.areaId,
      }).id
    },
    // Painting a new room, growing or merging one makes the affected room
    // active. Done on commit rather than on apply: mid-drag the room is
    // speculative, and arming it there would leave handles behind on a room
    // that `Esc` un-made.
    onCommit: () => {
      if (paintedRoomId) useActiveRoomStore().arm(mapId, paintedRoomId)
    },
  })
}

// Every cell of every room the stroke will swallow. Whole rooms, not just the
// crossed cells: merge is whole-room by design, so a stroke clipping one
// corner of a large room takes all of it, and the ghost has to say so.
function absorbedCells(
  map: MapModel,
  cells: ReadonlySet<CellKey>,
  intoRoomId: RoomId | undefined,
): Set<CellKey> {
  const absorbed = new Set<CellKey>()
  for (const roomId of roomsTouchedBy(map, cells)) {
    if (roomId === intoRoomId) continue
    const room = map.rooms.get(roomId)
    if (!room) continue
    for (const cell of room.cells) absorbed.add(cell)
  }
  return absorbed
}
