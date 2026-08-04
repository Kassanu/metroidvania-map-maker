// Select mode's other drag: moving a cell selection, which does not move a
// room but takes cells out of one.
//
// A separate gesture from the room-granularity move rather than a branch inside
// it, for the reason the two target resolvers are separate: these reach
// different things, apply different ops and leave different results behind. A
// room move preserves identity, name, notes and transitions; this destroys all
// four, and the grabbed cells arrive as brand-new rooms by connectivity.
//
// The destination is replaced on every move, never accumulated, so every
// re-apply runs against the pristine model and dragging back to the origin
// leaves everything exactly where it started. `moveCellFragment` refuses a zero
// delta itself, so the empty transaction the seam drops means no undo step for a
// move that went nowhere.
//
// Two things the speculative model cannot show, and they are the whole reason
// this has a ghost at all. What it is about to overwrite: by draw time those
// cells belong to the new rooms and look no different from cells picked up off
// bare grid. And what the fragment is about to *become*: the new rooms render
// through the ordinary path, so mid-drag a fragment move and a room move look
// alike, and only one of them can be undone by dragging back.

import { beginGhostGesture, type CellMove } from './ghostGesture'
import { useModelStore } from '@/stores/model'
import { useSelectionStore } from '@/stores/selection'
import { moveCellFragment } from '@/core/ops/rooms'
import { parseCell, translate, type CellKey } from '@/core/cell'
import { t } from '@/i18n'
import type { MapModel } from '@/core/types'
import type { MapId } from '@/core/ids'

// The one gesture with something to say beyond the cells it is about to eat, so
// it says it here rather than in `GhostGesture`, which every other gesture
// would then have to answer with an empty set.
export interface CellFragmentMove extends CellMove {
  // The cells the drag is about to turn into new rooms. Empty once settled, for
  // the reason the absorb overlay is: after a commit they are ordinary rooms,
  // and after a rollback they were never there.
  readonly becoming: ReadonlySet<CellKey>
}

// Cells the drop is about to take from a room that is staying put.
//
// Read against the pre-move grid, which is why it runs as the `absorbing` hook
// rather than off the map at draw time. A destination cell that is also one of
// the grabbed cells is not absorbed: the same transaction vacates it, so it is
// moved out of rather than lost by anyone.
function absorbedCells(
  map: MapModel,
  grabbed: ReadonlySet<CellKey>,
  destinations: ReadonlySet<CellKey>,
): ReadonlySet<CellKey> {
  const absorbed = new Set<CellKey>()
  for (const cell of destinations) {
    if (map.cellOwner.has(cell) && !grabbed.has(cell)) absorbed.add(cell)
  }
  return absorbed
}

// Returns null when there is nothing a fragment drag could move: a missing map,
// or a selection holding no cell this map owns. A cell that lost its owner
// cannot be dragged out of a room it is no longer in.
export function beginCellFragmentMove(
  mapId: MapId,
  from: CellKey,
  onChange: () => void,
): CellFragmentMove | null {
  const model = useModelStore()
  const selection = useSelectionStore()
  const map = model.project.mapsById.get(mapId)
  if (!map) return null

  // Captured at press, like every other press-time reading. These are also the
  // cells the op filters to, so the gesture and the op agree about what was
  // grabbed without either asking the other.
  const grabbed = new Set(selection.cellsOn(mapId).filter((cell) => map.cellOwner.has(cell)))
  if (grabbed.size === 0) return null

  const origin = parseCell(from)
  let to = from

  const delta = () => {
    const at = parseCell(to)
    return { dx: at.x - origin.x, dy: at.y - origin.y }
  }

  // Where the grabbed cells are headed. The ghost draws these and the absorb
  // hook measures against them, so both read the one derivation.
  const destinations = (): Set<CellKey> => {
    const { dx, dy } = delta()
    const cells = new Set<CellKey>()
    for (const cell of grabbed) cells.add(translate(cell, dx, dy))
    return cells
  }

  let becoming: ReadonlySet<CellKey> = new Set(grabbed)

  const driver = beginGhostGesture({
    mapId,
    label: t('history.moveCells'),
    onChange,
    absorbing: () => absorbedCells(map, grabbed, destinations()),
    apply: (transaction) => {
      const { dx, dy } = delta()
      becoming = destinations()
      moveCellFragment(transaction, model.project, map, grabbed, dx, dy)
    },
    // What landed is what is selected, the rule a paste already follows. It has
    // to be said explicitly: a cell ref names a position, so a move invalidates
    // the very refs it is moving, and the committed prune would otherwise drop
    // the selection to whatever the fragment happened to leave behind.
    onCommit: () => {
      selection.set(
        [...becoming].map((id) => ({ kind: 'cell', id })),
        mapId,
      )
    },
  })

  return {
    get to() {
      return to
    },
    get absorbing() {
      return driver.absorbing
    },
    get becoming() {
      return driver.settled ? EMPTY : becoming
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

const EMPTY: ReadonlySet<CellKey> = new Set()
