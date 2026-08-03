// Select mode's drag column: moving whatever is selected, by a whole-cell
// delta, as one transaction.
//
// `iconDrag`'s shape, and for the same reason: the destination is derived from
// the pointer and **replaced** on every move, never accumulated, so every
// re-apply runs the whole batch once against the pristine model. Dragging back
// to the origin therefore leaves everything exactly where it started, and the
// empty transaction the seam drops means no undo step for a move that went
// nowhere. None of the three ops is guarded here: each already refuses a zero
// delta itself, and guarding in the gesture is what makes an op's own guard
// untestable.
//
// One transaction for the whole mix, which is what makes a multi-kind selection
// one undo step rather than three.
//
// The absorb overlay is the one thing the speculative model cannot show: by
// draw time the destination cells belong to the moving room and look no
// different from cells picked up off bare grid.

import { beginGhostGesture, NO_CELLS, type GhostGesture } from './ghostGesture'
import { useModelStore } from '@/stores/model'
import { useSelectionStore } from '@/stores/selection'
import { moveRooms } from '@/core/ops/rooms'
import { repositionIcon, translateLine } from '@/core/ops/markup'
import { parseCell, translate, type CellKey } from '@/core/cell'
import { t } from '@/i18n'
import type { MapModel } from '@/core/types'
import type { IconId, LineId, MapId, RoomId } from '@/core/ids'

export interface SelectionMove extends GhostGesture {
  // The cell the pointer is over, which with the origin is the delta. Starts at
  // the origin, so a drag that has not left its cell is already a no-op.
  readonly to: CellKey
  moveTo(cell: CellKey): void
}

// The undo entry, named after the kind when the selection holds exactly one.
// A mixed selection has no truthful specific name and says so, the same rule
// the delete key's label follows.
function moveLabel(rooms: RoomId[], icons: IconId[], lines: LineId[]): string {
  const kinds = [rooms.length, icons.length, lines.length].filter((count) => count > 0).length
  if (kinds > 1) return t('history.moveSelection')
  if (rooms.length > 0) return t('history.moveRoom')
  if (icons.length > 0) return t('history.moveIcon')
  return t('history.moveLine')
}

// Cells the moving rooms are about to take from a room that is staying put.
//
// Read against the pre-move grid, which is why it runs as the `absorbing` hook
// rather than off the map at draw time. Cells owned by another *moving* room
// are not absorbed: the group moves as one, so those are vacated by the same
// transaction rather than lost by anyone.
function absorbedCells(
  map: MapModel,
  rooms: RoomId[],
  dx: number,
  dy: number,
): ReadonlySet<CellKey> {
  if (dx === 0 && dy === 0) return NO_CELLS
  const moving = new Set(rooms)
  const absorbed = new Set<CellKey>()
  for (const roomId of rooms) {
    const room = map.rooms.get(roomId)
    if (!room) continue
    for (const cell of room.cells) {
      const owner = map.cellOwner.get(translate(cell, dx, dy))
      if (owner !== undefined && !moving.has(owner)) absorbed.add(translate(cell, dx, dy))
    }
  }
  return absorbed
}

// Returns null when there is nothing a drag could move: an empty selection, a
// missing map, or a selection holding only transitions. A transition is
// anchored to the edge between two rooms and its geometry is derived from them,
// so dragging one is a documented dead cell. Answering null rather than opening
// a transaction that would apply nothing is what makes that visible here.
export function beginSelectionMove(
  mapId: MapId,
  from: CellKey,
  onChange: () => void,
): SelectionMove | null {
  const model = useModelStore()
  const selection = useSelectionStore()
  const map = model.project.mapsById.get(mapId)
  if (!map) return null

  // Captured at press. The selection cannot change under a live drag, and
  // re-reading it per frame would put the store on the re-apply path for no
  // gain.
  const rooms = selection.roomsOn(mapId)
  const lines = selection.linesOn(mapId)
  // Each icon's cell as it is before anything moves, which is what the
  // destination is measured from. An icon standing on a moving room rides along
  // with it and then lands on that same destination, so the two agree rather
  // than compounding.
  const icons = selection
    .iconsOn(mapId)
    .map((iconId) => ({ id: iconId, cell: map.icons.get(iconId)?.cell }))
    .filter((icon): icon is { id: IconId; cell: CellKey } => icon.cell !== undefined)

  if (rooms.length + icons.length + lines.length === 0) return null

  const origin = parseCell(from)
  let to = from

  const delta = () => {
    const at = parseCell(to)
    return { dx: at.x - origin.x, dy: at.y - origin.y }
  }

  const driver = beginGhostGesture({
    mapId,
    label: moveLabel(
      rooms,
      icons.map((icon) => icon.id),
      lines,
    ),
    onChange,
    absorbing: () => {
      const { dx, dy } = delta()
      return absorbedCells(map, rooms, dx, dy)
    },
    apply: (transaction) => {
      const { dx, dy } = delta()
      // Rooms first: they take their destination footprint outright, so by the
      // time an icon is placed the grid is the one it has to land in.
      moveRooms(transaction, model.project, map, rooms, dx, dy)
      for (const icon of icons) {
        // No `replace`: that option is a Markup toolbar setting, and a move in
        // this mode must not destroy an icon through a control the user cannot
        // see. A blocked icon simply stays where it is.
        repositionIcon(transaction, map, icon.id, translate(icon.cell, dx, dy))
      }
      for (const lineId of lines) translateLine(transaction, map, lineId, dx, dy)
    },
  })

  return {
    get to() {
      return to
    },
    get absorbing() {
      return driver.absorbing
    },
    moveTo(cell: CellKey) {
      if (cell === to) return
      to = cell
      driver.refresh()
    },
    commit: driver.commit,
    cancel: driver.cancel,
  }
}
