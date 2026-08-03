// Select mode's marquee: the rubber band that selects what it sweeps, at the
// granularity the mode is in.
//
// `runResize`'s shape, not a stroke's. The rectangle is a quantity replaced on
// every move, so backtracking shrinks it and coming back to the origin leaves a
// band one cell across, which selects whatever that cell holds: nothing from
// bare grid, and the cell itself from inside a room, which is what a click on
// that same point would have selected. Abandoning a band is `Esc`, and that
// keeps the selection the press started with.
//
// Not a `GhostGesture`, and the difference is the whole file: this mutates no
// model, opens no transaction and leaves no undo step, so there is nothing to
// apply speculatively and nothing to roll back. What it does borrow is settling
// exactly once and the shared `gesture` Esc tier, which it registers itself for
// the life of the drag: without that, `Esc` mid-drag would fall through to the
// selection tier, clear the selection the user already had, and leave the band
// still tracking the pointer.
//
// The band is snapped to whole cells, which is what makes it honest: selection
// is decided per cell, so the drawn edge is exactly where the answer changes.
// `boundsFor` is the one source for both the drawn rectangle and the query.
//
// The two granularities share every line of this except the one query at
// release. The rectangle, the snapping, the shift-adds rule, the preview and
// the Esc handling are the gesture; what a swept rectangle names is the table.

import { pushEscHandler } from '@/hotkeys/escStack'
import { useModelStore } from '@/stores/model'
import { useSelectionStore } from '@/stores/selection'
import { ownedCellsIn, roomsOverlapping, type CellBounds } from '@/core/derive/bounds'
import type { SelectSubMode } from '@/canvas/selectTarget'
import type { MarqueeRect } from '@/canvas/renderMap'
import type { WorldPoint } from '@/canvas/stroke'
import type { MapId } from '@/core/ids'
import type { MapModel, ObjectRef } from '@/core/types'

export interface Marquee {
  // The band, in fractional world cells, or null when there is nothing to
  // draw: a band still one cell across, or a settled gesture. One cell is not a
  // box, the same rule the door box follows, so a press that has not moved
  // draws nothing rather than flashing a cell-sized rectangle under every
  // click.
  readonly rect: MarqueeRect | null
  // Whether the gesture has already selected or aborted. The caller needs this
  // for the same reason the ghost driver exposes it: `Esc` arrives through the
  // shared stack rather than through the caller, so nothing else tells it that
  // the press it is still holding is over.
  readonly settled: boolean
  moveTo(point: WorldPoint): void
  commit(): void
  cancel(): void
}

// The cells the band covers, from its two corners in any of four directions.
function boundsFor(from: WorldPoint, to: WorldPoint): CellBounds {
  const fromCol = Math.floor(from.x)
  const fromRow = Math.floor(from.y)
  const toCol = Math.floor(to.x)
  const toRow = Math.floor(to.y)
  return {
    minCol: Math.min(fromCol, toCol),
    minRow: Math.min(fromRow, toRow),
    maxCol: Math.max(fromCol, toCol),
    maxRow: Math.max(fromRow, toRow),
  }
}

function sameBounds(a: CellBounds, b: CellBounds): boolean {
  return (
    a.minCol === b.minCol && a.minRow === b.minRow && a.maxCol === b.maxCol && a.maxRow === b.maxRow
  )
}

// What a swept rectangle names, which is the one thing the two granularities do
// not share.
//
// Rooms: whole rooms, and only rooms. Icons, lines and transitions are reached
// by click and shift-click, never by a sweep, even when the band covers them.
//
// Cells: owned cells, and only owned cells. Bare grid inside the band selects
// nothing, which is what keeps the selection and a fragment move agreeing about
// what can be held: a cell with no owner cannot be moved, cut or erased.
function sweptRefs(map: MapModel, bounds: CellBounds, subMode: SelectSubMode): ObjectRef[] {
  if (subMode === 'cells') {
    return ownedCellsIn(map, bounds).map((id) => ({ kind: 'cell', id }))
  }
  return roomsOverlapping(map, bounds).map((id) => ({ kind: 'room', id }))
}

// `additive` is shift held at press: a plain marquee replaces the selection, a
// shift-marquee unions with it. Read once, like every other press-time
// modifier.
//
// Returns null when the map is gone: nothing to select on, and the caller
// simply does not start a gesture.
export function beginMarquee(
  mapId: MapId,
  from: WorldPoint,
  subMode: SelectSubMode,
  additive: boolean,
  onChange: () => void,
): Marquee | null {
  const model = useModelStore()
  const selection = useSelectionStore()
  const map = model.project.mapsById.get(mapId)
  if (!map) return null

  let bounds = boundsFor(from, from)
  let settled = false

  function settle(finish: () => void): void {
    if (settled) return
    settled = true
    popEsc()
    finish()
    onChange()
  }

  const popEsc = pushEscHandler('gesture', () => settle(() => {}))

  return {
    get rect() {
      if (settled) return null
      if (bounds.minCol === bounds.maxCol && bounds.minRow === bounds.maxRow) return null
      // Whole cells: the far corner is the outside of the last cell, not its
      // origin.
      return {
        from: { x: bounds.minCol, y: bounds.minRow },
        to: { x: bounds.maxCol + 1, y: bounds.maxRow + 1 },
      }
    },
    get settled() {
      return settled
    },
    moveTo(point: WorldPoint) {
      if (settled) return
      const next = boundsFor(from, point)
      // Gated on the covered cells actually changing: moving within one cell
      // changes neither what is drawn nor what would be selected, so it costs
      // no repaint.
      if (sameBounds(next, bounds)) return
      bounds = next
      onChange()
    },
    commit: () =>
      settle(() => {
        const refs = sweptRefs(map, bounds, subMode)
        if (additive) selection.addAll(refs, mapId)
        else selection.set(refs, mapId)
      }),
    cancel: () => settle(() => {}),
  }
}
