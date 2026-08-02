// The erase stroke: the same free-form loop as paint, with `eraseCells` in
// place of `paintCells`.
//
// Every erase here is a cell erase. A press on an inner-wall segment deletes
// the segment instead, which is `beginInnerWallErase`.
//
// Three things it deliberately does not do:
//
//   - It names no room. Erasing may split the room it started on (core
//     re-runs connectivity and the top-left group keeps the identity), so a
//     gesture holding an origin room id would be holding a room that may not
//     exist by the next re-apply. Paint has to lock its origin room because
//     merge has to know who wins; erase has no such question, so the hazard
//     simply does not arise rather than being guarded against.
//   - It arms no active room. Painting a new room, growing one or merging one
//     each produces a room to put handles on. Erase produces the opposite: the
//     room it touched may have been split in two or removed outright, and
//     there is no defensible answer to which half wins. Pressing a room cell
//     still arms it, because that is a separate rule about the press and the
//     component owns it.
//   - It adds no ghost. Erase destroys rather than absorbs, and speculative
//     apply already shows the result: the cells are gone from the canvas
//     while the button is still down. The overlay exists for what the user
//     could not otherwise see, and there is nothing here that qualifies.

import { beginCellStroke, type CellStroke } from './cellStroke'
import { useModelStore } from '@/stores/model'
import { eraseCells } from '@/core/ops/rooms'
import { t } from '@/i18n'
import type { WorldPoint } from '@/canvas/stroke'
import type { MapId } from '@/core/ids'

// Returns null when the map is gone, like paint: the caller simply does not
// start a stroke.
export function beginEraseStroke(
  mapId: MapId,
  origin: WorldPoint,
  onChange: () => void,
): CellStroke | null {
  const model = useModelStore()
  const map = model.project.mapsById.get(mapId)
  if (!map) return null

  return beginCellStroke({
    mapId,
    origin,
    onChange,
    label: t('history.erase'),
    apply: (transaction, cells) => {
      eraseCells(transaction, model.project, map, cells)
    },
  })
}
