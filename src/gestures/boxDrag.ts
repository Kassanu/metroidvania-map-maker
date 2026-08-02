// Door mode's box drag: the rubber-band rectangle that makes an edge door or
// an elevator.
//
// Has `runResize`'s shape, not a stroke's. `moveTo` replaces the far corner
// rather than accumulating it, so backtracking shrinks the box and returning to
// the origin is a no-op. Every re-apply runs one `createFromBox` against the
// pristine model, so the state at the origin is never reconstructed.
//
// Does no geometry: `classifyBox` decides what a box means and `createFromBox`
// commits it; both already exist and are tested in core.
//
// The ghost here shows two things a speculatively-applied model cannot:
// the rectangle itself, which is in no model; and an invalid box, which applies
// nothing and would otherwise be indistinguishable from a bug. `preview` is the
// scene input for both.

import { beginGhostGesture, type GhostGesture } from './ghostGesture'
import { useModelStore } from '@/stores/model'
import { useDoorDefaultsStore } from '@/stores/doorDefaults'
import { classifyBox, createFromBox } from '@/core/ops/doors'
import { cellKey } from '@/core/cell'
import { t } from '@/i18n'
import type { WorldPoint } from '@/canvas/stroke'
import type { CellKey } from '@/core/cell'
import type { MapId } from '@/core/ids'

// What release would produce, as the ghost needs to say it.
export type BoxOutcome = 'edge' | 'elevator' | 'invalid'

export interface BoxPreview {
  from: CellKey
  to: CellKey
  outcome: BoxOutcome
}

export interface BoxDrag extends GhostGesture {
  // The rectangle and its verdict, or null while the box is still one cell.
  // Null on purpose: a press that has not moved is a click, which resolves to a
  // different gesture, and flashing "invalid" under every click would be wrong
  // and alarming. It makes returning to the origin read as "nothing here" rather
  // than as a refusal.
  readonly preview: BoxPreview | null
  moveTo(point: WorldPoint): void
}

// Returns null when the map is gone. Nothing to draw a box on, and the caller
// simply does not start a gesture.
export function beginBoxDrag(mapId: MapId, from: CellKey, onChange: () => void): BoxDrag | null {
  const model = useModelStore()
  const doorDefaults = useDoorDefaultsStore()
  const map = model.project.mapsById.get(mapId)
  if (!map) return null

  let to = from
  let outcome: BoxOutcome = 'invalid'

  const driver = beginGhostGesture({
    mapId,
    label: t('history.addTransition'),
    onChange,
    apply: (transaction) => {
      // Classified here, inside the re-apply: `reapply` rewinds first, so this
      // is the only place that sees the pristine model. Deriving it in `moveTo`
      // would classify against the model as the previous frame left it.
      outcome = classifyBox(map, from, to).kind
      // `createFromBox` refuses an invalid box on its own. This check saves a
      // second classification per frame.
      if (outcome === 'invalid') return
      // Toolbar defaults are read on every re-apply, so changing them mid-drag
      // updates the ghost live.
      createFromBox(transaction, model.project, map, from, to, doorDefaults.options)
    },
  })

  return {
    get absorbing() {
      return driver.absorbing
    },
    get preview() {
      // Nothing to show once the drag is over. Matters for Esc, where the
      // pointer keeps moving after the gesture ends.
      if (driver.settled) return null
      // One cell is not a box. See `BoxDrag.preview`.
      if (to === from) return null
      return { from, to, outcome }
    },
    moveTo(point: WorldPoint) {
      // Prevents `to` drifting after the drag is over.
      if (driver.settled) return
      const next = cellKey(Math.floor(point.x), Math.floor(point.y))
      // Gated on the far corner actually changing cells, like resize's distance:
      // moving within one cell is free, and costs neither a re-apply nor a
      // repaint.
      if (next === to) return
      to = next
      driver.refresh()
    },
    commit: driver.commit,
    cancel: driver.cancel,
  }
}
