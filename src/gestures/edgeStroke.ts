// The free-form edge stroke: shared by drawing and erasing inner walls, and
// the vertex-lattice twin of `cellStroke.ts`.
//
// Same free-form rules, one lattice over: the segments under the press lock in
// first, the union only ever grows, and every re-apply runs against the
// pristine model. What differs is only what a "unit" is (a grid edge rather
// than a cell) and one rule that has no cell equivalent:
//
// The path is restricted to interior vertices, which is sufficient for
// legality: an edge is drawable exactly when both cells it borders are in the
// room, and a step between two adjacent interior vertices always satisfies
// that, because the four-cell test at each end overlaps in precisely the two
// cells the edge divides. So walking this lattice cannot produce an illegal
// edge, and `drawInnerWall`'s refusal is unreachable from here.
//
// It is sufficient but far from necessary, and that is a known defect.
// Requiring both endpoints to be interior loses every interior edge with an
// endpoint on the room's outer boundary ring: a 2x2 room can hold no inner
// wall at all, a 3x3 only 4 of its 12, a 10x10 144 of 180. Testing the step's
// edge (both its cells in the room) instead of its two endpoints recovers
// everything except rooms with no interior vertex at all. Letting a drag start
// on a boundary vertex is the harder half of that fix.

import { beginGhostGesture, type GhostGesture } from './ghostGesture'
import { nearestVertex, verticesAlong, type Vertex } from '@/canvas/vertexPath'
import { isInteriorVertex } from '@/core/derive/walls'
import { edgeFromSegment } from '@/core/cell'
import type { WorldPoint } from '@/canvas/stroke'
import type { EdgeKey } from '@/core/cell'
import type { Transaction } from '@/core/journal'
import type { MapId } from '@/core/ids'
import type { Room } from '@/core/types'

export interface EdgeStroke extends GhostGesture {
  // The accumulated union of every edge the stroke has drawn along. Read live:
  // the same set is mutated in place as the drag goes on.
  readonly edges: ReadonlySet<EdgeKey>
  extendTo(point: WorldPoint): void
}

export interface EdgeStrokeSpec {
  mapId: MapId
  // The room the stroke works inside. Locked at press like paint's origin room,
  // and for a stronger reason: an inner wall belongs to exactly one room, and
  // the lattice the drag walks is that room's.
  room: Room
  origin: WorldPoint
  // An edge to start with, for a press that landed on an existing segment
  // rather than on a vertex. Empty for a press on a vertex, which is what makes
  // a bare click on a vertex draw nothing: a wall needs two of them.
  seed?: readonly EdgeKey[]
  label: string
  onChange: () => void
  apply(transaction: Transaction, edges: ReadonlySet<EdgeKey>): void
  onCommit?(): void
}

export function beginEdgeStroke(spec: EdgeStrokeSpec): EdgeStroke {
  const room = spec.room
  const edges = new Set<EdgeKey>(spec.seed ?? [])
  // Where the next segment starts. Tracked as a vertex rather than as the raw
  // pointer position, because the lattice is what the path is drawn on, but
  // updated on every move whether or not the step was drawable, so a drag that
  // wanders outside the room and comes back resumes from where the pointer is
  // rather than from the last legal vertex.
  let last = nearestVertex(spec.origin)

  const driver = beginGhostGesture({
    mapId: spec.mapId,
    label: spec.label,
    onChange: spec.onChange,
    onCommit: spec.onCommit,
    apply: (transaction) => spec.apply(transaction, edges),
  })

  // Only when the press already had something to do: a bare click on a vertex
  // has an empty union, and applying it would be a repaint announcing nothing.
  if (edges.size > 0) driver.refresh()

  return {
    edges,
    get absorbing() {
      return driver.absorbing
    },
    extendTo(point: WorldPoint) {
      const path = verticesAlong(last, point)
      const previous = last
      last = nearestVertex(point)

      let grew = false
      let from = previous
      for (const to of path) {
        const edge = edgeBetweenInterior(room, from, to)
        from = to
        if (!edge || edges.has(edge)) continue
        edges.add(edge)
        grew = true
      }
      // Backtracking does not un-draw: the union only ever grows, exactly as
      // for a cell stroke, so a move back along the wall costs nothing.
      if (grew) driver.refresh()
    },
    commit: driver.commit,
    cancel: driver.cancel,
  }
}

// The grid edge between two adjacent interior vertices, or null when the step
// is not one the stroke may draw: off the lattice, a repeat of the same
// vertex, or a diagonal (which `verticesAlong` never emits, but the type does
// not say so).
function edgeBetweenInterior(room: Room, from: Vertex, to: Vertex): EdgeKey | null {
  if (!isInteriorVertex(room, from.x, from.y) || !isInteriorVertex(room, to.x, to.y)) return null
  return edgeFromSegment([
    [from.x, from.y],
    [to.x, to.y],
  ])
}
