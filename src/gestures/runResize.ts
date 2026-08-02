// Edge-run resize: the structured gesture built on `ghostGesture.ts`. A stroke
// accumulates; this one replaces. `moveTo` derives a single distance from the
// pointer and discards the last one, so dragging back reverses exactly: every
// re-apply runs one `resizeRun` against the pristine model, so the geometry at
// distance 0 was never changed rather than reconstructed. That also means
// out-and-back leaves no undo step: `resizeRun` returns immediately at
// distance 0, the transaction ends up empty, and the seam drops empty
// transactions.
//
// The run is captured at press and never re-derived. Re-deriving it per frame
// would let it pick up extra length as an expansion filled a notch, and would
// break the drag's invertibility: the run you would shrink back along would no
// longer be the run you grabbed.

import { beginGhostGesture, NO_CELLS, type GhostGesture } from './ghostGesture'
import { useModelStore } from '@/stores/model'
import { resizeRun } from '@/core/ops/rooms'
import { SIDE_DELTA, parseCell, translate } from '@/core/cell'
import { t } from '@/i18n'
import type { WorldPoint } from '@/canvas/stroke'
import type { CellKey } from '@/core/cell'
import type { EdgeRun } from '@/core/derive/walls'
import type { MapId, RoomId } from '@/core/ids'
import type { MapModel } from '@/core/types'

export interface RunResize extends GhostGesture {
  // Whole cells the run has moved outward, negative for a shrink. Exposed
  // because it is the entire state of the gesture.
  readonly distance: number
  // Move the handle to a world point. Sliding along the run does nothing:
  // only displacement across it counts.
  moveTo(point: WorldPoint): void
}

// Whether this press may grab a handle, or only arm the room.
//
// Touch resize is a two-step gesture: the first pointer-down selects the room
// (and can still grow by dragging into empty, so it falls through to a paint
// stroke), and only a subsequent press, on a handle that is now visible,
// resizes. Desktop keeps its one-gesture hover-resize as well, which is why
// this is a question about the pointer type rather than a mode.
//
// A finger covers several cells and has no hover to aim with, so inferring
// resize from an un-armed touch would make dragging near the edge to grow the
// room almost impossible. A mouse has a pixel-accurate hover and a resize
// cursor telling it what the press will do. Pen counts as desktop: it aims
// like a mouse.
export function handleGrabAllowed(pointerType: string, roomWasArmed: boolean): boolean {
  return pointerType !== 'touch' || roomWasArmed
}

// Returns null when the map is gone: nothing to resize, and the caller simply
// does not start a gesture.
export function beginRunResize(
  mapId: MapId,
  roomId: RoomId,
  run: EdgeRun,
  onChange: () => void,
): RunResize | null {
  const model = useModelStore()
  const map = model.project.mapsById.get(mapId)
  if (!map) return null

  const { dx, dy } = SIDE_DELTA[run.side]
  // Any cell of the run will do: a run is straight, so its cells share the
  // coordinate the dot product below actually reads, and the other one is
  // multiplied by zero.
  const anchor = parseCell(run.cells[0])

  let distance = 0

  // Whole cells by construction: the pointer's cell, not its position rounded.
  // There is no threshold to pick and none to get wrong at the boundary, and
  // it means the rule can be stated without arithmetic: the run moves so that
  // the cell under the pointer is the new boundary cell.
  //
  // A press therefore always starts at distance 0, which is what makes a click
  // on a handle "set room active, no cell change" with no dead zone and no
  // click/drag distinction. `drawZone`'s rule 1 is that the pointer's own cell
  // decides the room, so a press that resolved to this run was inside the
  // run's own cell.
  function distanceAt(point: WorldPoint): number {
    const x = Math.floor(point.x)
    const y = Math.floor(point.y)
    return (x - anchor.x) * dx + (y - anchor.y) * dy
  }

  const driver = beginGhostGesture({
    mapId,
    label: t('history.resize'),
    onChange,
    absorbing: () => absorbedCells(map, run, roomId, distance, dx, dy),
    apply: (transaction) => {
      resizeRun(transaction, model.project, map, roomId, run, distance)
    },
  })

  return {
    get absorbing() {
      return driver.absorbing
    },
    get distance() {
      return distance
    },
    moveTo(point: WorldPoint) {
      const next = distanceAt(point)
      // Gated on the distance actually changing, like the stroke's union
      // growing: moving within one cell, or along the run, is free.
      if (next === distance) return
      distance = next
      driver.refresh()
    },
    commit: driver.commit,
    cancel: driver.cancel,
  }
}

// The cells an expansion is about to take off another room.
//
// Cells, not whole rooms: the one place this deliberately differs from
// paint's ghost. Merge is whole-room by design, so a stroke clipping one
// corner of a neighbour swallows all of it and the overlay has to say so. An
// expansion takes only the cells it lands on: `resizeRun` vacates exactly
// those, and whatever is left of the donor stays a room (or splits, or
// disappears if that was all of it). Highlighting the whole donor would warn
// about a destruction that is not going to happen.
//
// A shrink adds nothing: the cells it removes vanish from the canvas while the
// button is still down, so the speculative result already shows it.
function absorbedCells(
  map: MapModel,
  run: EdgeRun,
  roomId: RoomId,
  distance: number,
  dx: number,
  dy: number,
): ReadonlySet<CellKey> {
  if (distance <= 0) return NO_CELLS

  const absorbed = new Set<CellKey>()
  for (const cell of run.cells) {
    for (let step = 1; step <= distance; step++) {
      const target = translate(cell, dx * step, dy * step)
      const owner = map.cellOwner.get(target)
      if (owner !== undefined && owner !== roomId) absorbed.add(target)
    }
  }
  return absorbed
}
