// Inner walls: drawing, re-styling and erasing them.
//
// The loop is `edgeStroke.ts`, shared between these two exactly as
// `cellStroke` is shared between paint and erase; what is here is only what
// differs.
//
// Three things this file deliberately does not do:
//
//   - It does not validate. An inner wall is legal only while both cells its
//     edge divides are in the room, and core enforces that on every op,
//     including pruning walls whose cells leave when a room is erased, shrunk
//     or split. The stroke filters its steps by the same rule, so it cannot
//     produce an illegal edge in the first place; see `edgeStroke.ts`.
//   - It adds no ghost. Both gestures are visible in the speculative result:
//     the wall is on the canvas, in its new style or gone, while the button is
//     still down. The overlay exists for what the user could not otherwise
//     see.
//   - It arms no active room. Like erase, and unlike paint: the room was
//     already armed by the press that started this (a vertex target is
//     unreachable without pressing the room first), so there is nothing to
//     add.
//
// Re-styling needs no branch of its own: drawing over an existing segment with
// a different style selected is what `drawInnerWall` already does, since it
// sets the style at that edge whatever was there. So drawing over is the same
// call as drawing new.

import { beginEdgeStroke, type EdgeStroke } from './edgeStroke'
import { useModelStore } from '@/stores/model'
import { drawInnerWall, eraseInnerWall } from '@/core/ops/rooms'
import { t } from '@/i18n'
import type { WorldPoint } from '@/canvas/stroke'
import type { EdgeKey } from '@/core/cell'
import type { MapId, RoomId } from '@/core/ids'
import type { WallStyle } from '@/core/types'

// Returns null when the map or the room is gone: nothing to draw on, and the
// caller simply does not start a stroke.
export function beginInnerWallStroke(
  mapId: MapId,
  roomId: RoomId,
  origin: WorldPoint,
  style: WallStyle,
  onChange: () => void,
  seed?: readonly EdgeKey[],
): EdgeStroke | null {
  const model = useModelStore()
  const map = model.project.mapsById.get(mapId)
  const room = map?.rooms.get(roomId)
  if (!map || !room) return null

  return beginEdgeStroke({
    mapId,
    room,
    origin,
    seed,
    onChange,
    label: t('history.innerWall'),
    apply: (transaction, edges) => {
      for (const edge of edges) drawInnerWall(transaction, map, roomId, edge, style)
    },
  })
}

// Erasing on an inner-wall segment deletes the segment, not the cell it sits
// on. Which of the two erases a press opens is decided by the zone under the
// pointer, in the component; by the time either is running the choice is
// already made.
//
// It is a stroke rather than a single deletion because drawing is: a wall
// drawn with one drag should come off with one drag. Making erase the fiddly,
// one-click-per-segment operation would be the more painful asymmetry.
export function beginInnerWallErase(
  mapId: MapId,
  roomId: RoomId,
  origin: WorldPoint,
  onChange: () => void,
  seed?: readonly EdgeKey[],
): EdgeStroke | null {
  const model = useModelStore()
  const map = model.project.mapsById.get(mapId)
  const room = map?.rooms.get(roomId)
  if (!map || !room) return null

  return beginEdgeStroke({
    mapId,
    room,
    origin,
    seed,
    onChange,
    label: t('history.eraseInnerWall'),
    // Erasing an edge that carries no wall is already a no-op in core, so the
    // stroke does not filter its union down to edges that have one: a drag
    // across a bare stretch of lattice and back onto a wall erases the wall and
    // nothing else, and the transaction stays empty until it reaches one.
    apply: (transaction, edges) => {
      for (const edge of edges) eraseInnerWall(transaction, map, roomId, edge)
    },
  })
}
