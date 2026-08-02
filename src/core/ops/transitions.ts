// The transition attachment lifecycle: ride-along and re-validation.
//
// When cells move: any anchor cell sitting on a moved cell translates with it,
// so the transition travels with the room.
//
// After any edit: run the per-type validity predicate. Invalid transitions are
// deleted as part of the same undo transaction.
//
// Every room-mutating op ends by calling `cascadeTransitions`. That is the
// whole contract: ops change cells, this file makes the transitions attached
// to those cells consistent again, and because it all lands in one transaction
// a single Ctrl+Z puts back the room and the doors that died with it.

import { cellKey, edgeCells, parseCell, parseEdge, translateEdge } from '../cell'
import type { CellKey, EdgeKey } from '../cell'
import { farEndsOnMap } from '../farEnds'
import type { Transaction } from '../journal'
import { newTransitionId } from '../ids'
import type { MapId, RoomId, TransitionId } from '../ids'
import {
  putTransition,
  removeTransition,
  replaceTransition,
  transitionAnchors,
} from '../primitives'
import type { DoorSegment, EdgeTransition, MapModel, ProjectModel, Transition } from '../types'

function ownerOn(project: ProjectModel, mapId: MapId, cell: CellKey): RoomId | undefined {
  return project.mapsById.get(mapId)?.cellOwner.get(cell)
}

// ---------------------------------------------------------------------------
// Validity
// ---------------------------------------------------------------------------

// A door segment survives while its two cells are in different rooms. They
// are always adjacent (that is what being one edge means), so adjacency needs
// no separate check. What changes under edits is whether both cells are still
// owned and by different rooms.
export function isSegmentValid(map: MapModel, segment: DoorSegment): boolean {
  const { lo, hi } = edgeCells(segment.edge)
  const a = map.cellOwner.get(lo)
  const b = map.cellOwner.get(hi)
  return a !== undefined && b !== undefined && a !== b
}

export function isTransitionValid(
  project: ProjectModel,
  map: MapModel,
  transition: Transition,
): boolean {
  switch (transition.kind) {
    case 'edge':
      return transition.segments.some((segment) => isSegmentValid(map, segment))

    case 'elevator': {
      const a = map.cellOwner.get(transition.a)
      const b = map.cellOwner.get(transition.b)
      if (a === undefined || b === undefined || a === b) return false
      return isGapIntact(map, transition.a, transition.b, a, b)
    }

    case 'teleport': {
      const a = ownerOn(project, transition.a.mapId, transition.a.cell)
      const b = ownerOn(project, transition.b.mapId, transition.b.cell)
      if (a === undefined || b === undefined) return false
      // Two endpoints on different maps are necessarily different rooms; on
      // the same map they must not be the same room (no self-connect).
      if (transition.a.mapId !== transition.b.mapId) return true
      return a !== b
    }
  }
}

// An elevator spans a gap between two facing edges. It dies when a room grows
// across that gap and the two ends become adjacent (gap closes). A third room
// sitting in the gap is fine: the shaft renders behind it.
export function isGapIntact(
  map: MapModel,
  a: CellKey,
  b: CellKey,
  roomA: RoomId,
  roomB: RoomId,
): boolean {
  const from = parseCell(a)
  const to = parseCell(b)
  if (from.x !== to.x && from.y !== to.y) return false // no longer aligned

  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))
  if (steps < 2) return false // adjacent: there is no gap left to span

  for (let i = 1; i < steps; i++) {
    // A third room sitting in the gap is fine: the shaft renders behind it.
    // Only the two connected rooms closing the gap themselves invalidates it.
    const between = map.cellOwner.get(cellKey(from.x + dx * i, from.y + dy * i))
    if (between === roomA || between === roomB) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Trimming an N-wide door
// ---------------------------------------------------------------------------

// Two segments are contiguous when their edges are consecutive along the same
// line. Different axes are never contiguous, so a corner resolves into a
// horizontal door plus a vertical door rather than one ambiguous diagonal.
function areContiguous(a: EdgeKey, b: EdgeKey): boolean {
  const p = parseEdge(a)
  const q = parseEdge(b)
  if (p.axis !== q.axis) return false
  return p.axis === 'H'
    ? p.y === q.y && Math.abs(p.x - q.x) === 1
    : p.x === q.x && Math.abs(p.y - q.y) === 1
}

// Groups surviving segments into contiguous runs. Each run becomes its own
// transition object.
export function contiguousRuns(segments: DoorSegment[]): DoorSegment[][] {
  const remaining = [...segments]
  const runs: DoorSegment[][] = []

  while (remaining.length > 0) {
    const run = [remaining.shift()!]
    let grew = true
    while (grew) {
      grew = false
      for (let i = 0; i < remaining.length; i++) {
        if (run.some((s) => areContiguous(s.edge, remaining[i].edge))) {
          run.push(remaining.splice(i, 1)[0])
          grew = true
          break
        }
      }
    }
    runs.push(run)
  }

  return runs
}

// ---------------------------------------------------------------------------
// Ride-along
// ---------------------------------------------------------------------------

// `moved` maps each moved cell's old key to its new key in `editedMapId`'s
// coordinate space. An anchor rides only when every cell it depends on moved
// by the same delta. A door whose two cells moved apart is no longer the same
// door and is dropped.
//
// `editedMapId` is mandatory. Every map shares the same unbounded coordinate
// space. `affectedTransitions` deliberately returns cross-tab teleports stored
// on other maps. Without the map ID check, matching endpoints by cell key alone
// would relocate a teleport's endpoint on a map the user never touched, when
// two maps happened to have content at the same coordinates.
function rideTransition(
  transition: Transition,
  moved: Map<CellKey, CellKey>,
  editedMapId: MapId,
): Transition | null {
  switch (transition.kind) {
    case 'edge': {
      const segments: DoorSegment[] = []
      for (const segment of transition.segments) {
        const { lo, hi } = edgeCells(segment.edge)
        const loMoved = moved.get(lo)
        const hiMoved = moved.get(hi)
        if (loMoved === undefined && hiMoved === undefined) {
          segments.push(segment)
          continue
        }
        // Only one side moved, or they moved by different deltas: the shared
        // boundary this segment described no longer exists.
        if (loMoved === undefined || hiMoved === undefined) continue
        const delta = deltaOf(lo, loMoved)
        if (!sameDelta(delta, deltaOf(hi, hiMoved))) continue
        segments.push({
          edge: translateEdge(segment.edge, delta.dx, delta.dy),
          aSide: segment.aSide,
        })
      }
      if (
        segments.length === transition.segments.length &&
        segments.every((s, i) => s.edge === transition.segments[i].edge)
      ) {
        return null
      }
      return { ...transition, segments }
    }

    case 'elevator': {
      const a = moved.get(transition.a) ?? transition.a
      const b = moved.get(transition.b) ?? transition.b
      if (a === transition.a && b === transition.b) return null
      return { ...transition, a, b }
    }

    case 'teleport': {
      // Endpoints ride individually. A teleport usually survives a move; it just
      // points at the room's new location. Each endpoint only rides if it actually
      // lives on the map being edited.
      const a = transition.a.mapId === editedMapId ? moved.get(transition.a.cell) : undefined
      const b = transition.b.mapId === editedMapId ? moved.get(transition.b.cell) : undefined
      if (a === undefined && b === undefined) return null
      return {
        ...transition,
        a: a === undefined ? transition.a : { ...transition.a, cell: a },
        b: b === undefined ? transition.b : { ...transition.b, cell: b },
      }
    }
  }
}

function deltaOf(from: CellKey, to: CellKey): { dx: number; dy: number } {
  const start = parseCell(from)
  const end = parseCell(to)
  return { dx: end.x - start.x, dy: end.y - start.y }
}

function sameDelta(a: { dx: number; dy: number }, b: { dx: number; dy: number }): boolean {
  return a.dx === b.dx && a.dy === b.dy
}

// ---------------------------------------------------------------------------
// The cascade
// ---------------------------------------------------------------------------

// Every transition that could be affected by a change to `map`: the ones
// stored on it, plus cross-tab teleports stored elsewhere whose far endpoint
// lands here (they are stored once, under their origin map).
function affectedTransitions(
  project: ProjectModel,
  map: MapModel,
): { map: MapModel; transition: Transition }[] {
  const out: { map: MapModel; transition: Transition }[] = []
  for (const transition of map.transitions.values()) out.push({ map, transition })

  // O(far ends on this map), not O(all far ends x all maps): the index is
  // nested by map and each entry names the map its transition is stored under.
  for (const ref of farEndsOnMap(project.teleportFarEnds, map.id).values()) {
    const owner = project.mapsById.get(ref.originMapId)
    const transition = owner?.transitions.get(ref.transitionId)
    if (owner && transition) out.push({ map: owner, transition })
  }
  return out
}

// Which teleport endpoints will sit on each cell of `mapId` once the ride is
// applied: riders at their destinations, everything else where it already is.
//
// Computing this up front is what distinguishes a cell that is genuinely
// occupied from one whose occupant is about to leave. Two endpoints in the
// same moving room shift together, so the trailing one lands exactly where the
// leading one just was; a check made mid-ride would delete a teleport that was
// never in anybody's way.
function finalTeleportOccupancy(
  affected: { map: MapModel; transition: Transition }[],
  rides: ReadonlyMap<TransitionId, Transition>,
  mapId: MapId,
): Map<CellKey, { map: MapModel; transition: Transition }[]> {
  const occupancy = new Map<CellKey, { map: MapModel; transition: Transition }[]>()
  for (const { map: owner, transition } of affected) {
    const settled = rides.get(transition.id) ?? transition
    if (settled.kind !== 'teleport') continue
    for (const cell of transitionAnchors(settled, mapId).cells) {
      const at = occupancy.get(cell)
      // Keyed on the pre-ride object, which is what `replaceTransition` and
      // `removeTransition` still expect to be handed.
      if (at) at.push({ map: owner, transition })
      else occupancy.set(cell, [{ map: owner, transition }])
    }
  }
  return occupancy
}

// Run after any room mutation, inside the same transaction. `moved` is
// supplied by ops that translate cells (move, rotate, flip); paint/erase/
// resize pass nothing and get re-validation only.
export function cascadeTransitions(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  moved?: Map<CellKey, CellKey>,
): void {
  // Step 1: ride along.
  if (moved && moved.size > 0) {
    const affected = affectedTransitions(project, map)
    const rides = new Map<TransitionId, Transition>()
    for (const { transition } of affected) {
      const ridden = rideTransition(transition, moved, map.id)
      if (ridden) rides.set(transition.id, ridden)
    }

    // A cell holds at most one teleport endpoint. `createTeleport` is not the
    // only way to put one there: a ride can carry an endpoint onto a cell
    // another teleport already holds. Resolved here rather than at the ride
    // itself, because the answer depends on where everything ends up. A teleport
    // that looks like it is in the way may be riding out of it in the same
    // cascade.
    for (const occupants of finalTeleportOccupancy(affected, rides, map.id).values()) {
      if (occupants.length < 2) continue
      // Incoming content overwrites the resident: the rider keeps the cell and
      // the resident is deleted. Deleting rather than leaving it stranded
      // matches the rest of the cascade, where invalid means deleted.
      const winner = occupants.find((each) => rides.has(each.transition.id)) ?? occupants[0]
      for (const { map: owner, transition } of occupants) {
        if (transition === winner.transition) continue
        removeTransition(tx, project, owner, transition)
        rides.delete(transition.id)
      }
    }

    // Applied only after the displacements, so no `setFarEnd` ever overwrites
    // a slot still owned by a live teleport.
    for (const { map: owner, transition } of affected) {
      const ridden = rides.get(transition.id)
      if (ridden) replaceTransition(tx, project, owner, transition, ridden)
    }
  }

  // Step 2: re-validate. Re-read, because step 1 replaced objects.
  for (const { map: owner, transition } of affectedTransitions(project, map)) {
    if (transition.kind === 'edge') {
      trimEdgeTransition(tx, project, owner, transition)
      continue
    }
    if (!isTransitionValid(project, owner, transition)) {
      removeTransition(tx, project, owner, transition)
    }
  }
}

// Splits segments the way a fresh box-drag would: one group per unordered room
// pair, then per contiguous run within it. The same two rules `classifyBox`
// applies, kept separate because that one works from a box and this one from
// an existing door. The two must agree.
function groupByPairAndRun(map: MapModel, segments: DoorSegment[]): DoorSegment[][] {
  const byPair = new Map<string, DoorSegment[]>()
  for (const segment of segments) {
    const { lo, hi } = edgeCells(segment.edge)
    const a = map.cellOwner.get(lo)!
    const b = map.cellOwner.get(hi)!
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    const bucket = byPair.get(key)
    if (bucket) bucket.push(segment)
    else byPair.set(key, [segment])
  }

  const groups: DoorSegment[][] = []
  for (const bucket of byPair.values()) groups.push(...contiguousRuns(bucket))
  return groups
}

// An N-wide door keeps the segments whose cell-pairs are still valid. If
// survivors are disjoint they become separate door objects. If none survive
// the door is deleted.
function trimEdgeTransition(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  transition: EdgeTransition,
): void {
  const surviving = transition.segments.filter((segment) => isSegmentValid(map, segment))

  // Checked before the "did anything change?" test below, which reads 0 === 0
  // for a door that ride-along already emptied and would leave it in
  // `map.transitions` while it is in no index.
  if (surviving.length === 0) {
    removeTransition(tx, project, map, transition)
    return
  }

  // Re-grouped by room pair and contiguity, exactly as `classifyBox` does.
  // Contiguity alone is not enough: a segment can stay valid while the room on
  // the other side of it changes.
  //
  // Example: A = {0,0 0,1}, B = {1,0 1,1}, D = {2,1 2,2}.
  // A 2-segment door across the A|B seam, then D takes cell 1,1 from B:
  // segment 1,0,V is A|B, segment 1,1,V is now A|D.
  // Both survive with unchanged count, leaving one door for two room pairs
  // and an `aSide` that cannot be answered. `classifyBox` cannot produce
  // that; its grouping prevents it.
  const runs = groupByPairAndRun(map, surviving)
  if (runs.length === 1 && surviving.length === transition.segments.length) return

  removeTransition(tx, project, map, transition)

  runs.forEach((segments, index) => {
    // The first run keeps the original id, so undo/redo and any selection
    // pointing at it stay meaningful; the rest are genuinely new objects.
    const replacement: EdgeTransition = {
      ...transition,
      id: index === 0 ? transition.id : newTransitionId(),
      segments,
    }
    putTransition(tx, project, map, replacement)
    if (index === 0) tx.touched.removedTransitions.delete(transition.id)
  })
}

// Deleting a room deletes its transitions outright rather than waiting for
// re-validation, so the "delete a room -> all its transitions deleted" rule
// holds even for a teleport whose other end is still perfectly valid.
export function removeTransitionsTouching(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  cells: Set<CellKey>,
): void {
  for (const { map: owner, transition } of affectedTransitions(project, map)) {
    if (touchesCells(transition, map.id, cells)) {
      removeTransition(tx, project, owner, transition)
    }
  }
}

function touchesCells(transition: Transition, mapId: MapId, cells: Set<CellKey>): boolean {
  switch (transition.kind) {
    case 'edge':
      return transition.segments.some((segment) => {
        const { lo, hi } = edgeCells(segment.edge)
        return cells.has(lo) || cells.has(hi)
      })
    case 'elevator':
      return cells.has(transition.a) || cells.has(transition.b)
    case 'teleport':
      return (
        (transition.a.mapId === mapId && cells.has(transition.a.cell)) ||
        (transition.b.mapId === mapId && cells.has(transition.b.cell))
      )
  }
}

// Convenience for ops that translate a whole cell set by a fixed delta.
