// Edge-door geometry: which stretch of wall a door breaks, and where its
// marker goes.
//
// A transition on a shared wall breaks the wall at its location, a doorway
// gap, rather than sitting as a box over an unbroken wall. Rendering only:
// walls remain derived, not stored.
//
// The hole and the marker are two readings of one measurement, so this file
// owns it and `renderMap.ts` only paints: the wall omits exactly what the
// marker covers. `wallGaps` derives from the same `opening()` the marker is
// drawn along, rather than repeating the inset in edge-parameter space,
// so the two cannot drift apart.
//
// Pure, like everything in this directory: a model in, geometry out, no camera
// and no context. Screen conversion is the renderer's job.

import { parseEdge, segmentFromEdge } from '@/core/cell'
import type { EdgeAxis, EdgeKey } from '@/core/cell'
import { contiguousRuns } from '@/core/ops/transitions'
import type { LockTypeId, TransitionId } from '@/core/ids'
import type { Direction, MapModel } from '@/core/types'

// How much wall is left standing at each end of a door's opening, as a
// fraction of one cell.
//
// Without it, a door that spans the entire boundary its two rooms share would
// erase that boundary completely and the two rooms would read as one. The
// jambs keep the opening bounded by wall at both ends, so a door that fills a
// whole seam still reads as a door rather than a missing wall.
//
// A first sketch: exact marker geometry, and how far it reaches into
// adjoining cells, may still change.
export const DOOR_JAMB = 1 / 6

// One door object's contiguous stretch of boundary, ready to draw.
//
// `axis` is the seam's own axis, not the run's: a run of V edges lies on a
// vertical seam and extends in y. `fixed` is the coordinate the seam sits on and
// `start`/`end` bracket the run along the other one, all in vertex (= world)
// coordinates.
export interface DoorRun {
  id: TransitionId
  axis: EdgeAxis
  fixed: number
  start: number
  end: number
  // Ascending along the run, which is what lets the renderer walk it without
  // caring which way the user dragged.
  edges: EdgeKey[]
  locks: { a: LockTypeId; b: LockTypeId }
  // Which of the seam's two sides is room A's: `lo` is west of a V seam, north
  // of an H one. A one-way door's arrow points from A's side to B's, so this is
  // what turns "one-way in stored order" into a direction on screen.
  //
  // Taken from the run's first segment. Every segment of one door object shares
  // it in practice: a run lies on one seam between one room pair, so the same
  // room is on the `lo` side throughout. But the type permits a mixture and one
  // arrow cannot draw two directions, so the first segment decides.
  aSide: 'lo' | 'hi'
  // Which way the arrow through the edge points, or `both` for no arrow at
  // all. `aToB` runs from A's side across the seam; `bToA` is the same line
  // travelled the other way.
  direction: Direction
}

// The open part of one edge, as a fraction of that edge's own length measured
// the way `segmentFromEdge` orders it (ascending). A whole-edge gap is `{0, 1}`;
// `from === to` means nothing is open.
export interface OpenSpan {
  from: number
  to: number
}

// Every edge door on the map, split into contiguous runs.
//
// A stored `EdgeTransition` is normally already one contiguous run: that is
// what `classifyBox` produces and what the cascade's trim maintains. But the
// type does not enforce it, and a hand-edited file need not honour it. Grouping
// through core's own `contiguousRuns` is both the robust answer and the one
// that cannot disagree with the model about what "contiguous" means.
export function doorRuns(map: MapModel): DoorRun[] {
  const runs: DoorRun[] = []

  for (const transition of map.transitions.values()) {
    if (transition.kind !== 'edge') continue
    for (const segments of contiguousRuns(transition.segments)) {
      const axis = parseEdge(segments[0].edge).axis
      // Ascending along the run. `contiguousRuns` grows a run by scanning, so
      // its order follows the drag rather than the geometry.
      const edges = segments
        .map((segment) => segment.edge)
        .sort((a, b) => along(a, axis) - along(b, axis))
      runs.push({
        id: transition.id,
        axis,
        fixed: across(edges[0], axis),
        start: along(edges[0], axis),
        end: along(edges[edges.length - 1], axis) + 1,
        edges,
        locks: transition.locks,
        aSide: segments[0].aSide,
        direction: transition.direction,
      })
    }
  }

  return runs
}

// The run's opening in world coordinates: the whole run, inset by a jamb at
// each end. The single geometric fact this file exists to state: the marker is
// drawn along it and the wall is absent along it.
export function doorOpening(run: DoorRun): {
  from: [number, number]
  to: [number, number]
} {
  const { start, end } = opening(run)
  return run.axis === 'V'
    ? { from: [run.fixed, start], to: [run.fixed, end] }
    : { from: [start, run.fixed], to: [end, run.fixed] }
}

// Where the wall is missing, per edge: the same opening, expressed against
// each edge the run covers.
//
// Two door objects can share an edge: a drag from any room cell makes a new
// transition even when one already covers that cell, so a second box over
// part of an existing door is ordinary. The wall is then broken wherever
// either door breaks it, so spans are unioned rather than overwritten, since
// a last-writer-wins map would let one door's jamb re-appear in the middle of
// the other's opening.
export function wallGaps(runs: readonly DoorRun[]): Map<EdgeKey, OpenSpan> {
  const gaps = new Map<EdgeKey, OpenSpan>()

  for (const run of runs) {
    const { start, end } = opening(run)
    for (const edge of run.edges) {
      const base = along(edge, run.axis)
      const span = { from: clamp01(start - base), to: clamp01(end - base) }
      const existing = gaps.get(edge)
      if (existing) {
        existing.from = Math.min(existing.from, span.from)
        existing.to = Math.max(existing.to, span.to)
      } else {
        gaps.set(edge, span)
      }
    }
  }

  return gaps
}

function opening(run: DoorRun): { start: number; end: number } {
  return { start: run.start + DOOR_JAMB, end: run.end - DOOR_JAMB }
}

// The run-wise coordinate of an edge: y for a vertical seam, x for a horizontal
// one. Taken from the segment rather than from `parseEdge` so this file has one
// idea of an edge's extent, the same one the renderer traces walls with.
function along(edge: EdgeKey, axis: EdgeAxis): number {
  const [[x, y]] = segmentFromEdge(edge)
  return axis === 'V' ? y : x
}

function across(edge: EdgeKey, axis: EdgeAxis): number {
  const [[x, y]] = segmentFromEdge(edge)
  return axis === 'V' ? x : y
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
