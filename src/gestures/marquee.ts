// Select mode's marquee: the rubber band that selects the rooms it touches.
//
// `runResize`'s shape, not a stroke's. The rectangle is a quantity replaced on
// every move, so backtracking shrinks it and coming back to the origin leaves a
// band one cell across, which selects whatever that cell holds. A marquee only
// starts on bare grid, so that is nothing.
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

import { pushEscHandler } from '@/hotkeys/escStack'
import { useModelStore } from '@/stores/model'
import { useSelectionStore } from '@/stores/selection'
import { roomsOverlapping, type CellBounds } from '@/core/derive/bounds'
import type { MarqueeRect } from '@/canvas/renderMap'
import type { WorldPoint } from '@/canvas/stroke'
import type { MapId } from '@/core/ids'

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

// `additive` is shift held at press: a plain marquee replaces the selection, a
// shift-marquee unions with it. Read once, like every other press-time
// modifier.
//
// Returns null when the map is gone: nothing to select on, and the caller
// simply does not start a gesture.
export function beginMarquee(
  mapId: MapId,
  from: WorldPoint,
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
        // Rooms only. Icons, lines and transitions are reached by click and
        // shift-click, never by a sweep, even when the band covers them.
        const rooms = roomsOverlapping(map, bounds).map((id) => ({ kind: 'room', id }) as const)
        if (additive) selection.addAll([...rooms], mapId)
        else selection.set([...rooms], mapId)
      }),
    cancel: () => settle(() => {}),
  }
}
