// Transition creation: Door mode's three kinds, and the box-drag
// classification that decides which one a gesture produced.
//
// Door mode is fully context-inferred: there are no sub-tool buttons, so the
// gesture itself has to say what was meant. A tap starts a teleport; a drag
// rubber-bands a box whose dimensions plus a walk of its cells decide between
// an edge door and an elevator, or reject it.

import { cellKey, edgeCells, edgeOfCell, parseCell, parseEdge } from '../cell'
import type { CellKey } from '../cell'
import { farEndsOnMap, getFarEnd } from '../farEnds'
import { ModelError, mustGet, refuse } from '../outcome'
import type { Outcome } from '../outcome'
import { OPEN_LOCK_ID } from '../ids'
import type { LockTypeId, MapId, RoomId, TransitionId } from '../ids'
import type { Transaction } from '../journal'
import { putTransition, removeTransition, setTransitionField } from '../primitives'
import type {
  Direction,
  DoorSegment,
  EdgeTransition,
  ElevatorTransition,
  MapModel,
  ProjectModel,
  TeleportTransition,
  Transition,
} from '../types'

// Re-exported so the door layer stays the one import site for everything about
// a transition, model type included.
export type { Direction }
import { contiguousRuns, isGapIntact, isTransitionValid } from './transitions'

// What a gesture asks a new transition to be born with: the Door toolbar's
// creation defaults, threaded down from the strip the user set them in.
//
// Creation only. These never edit an existing transition: there is exactly
// one place to change a transition that already exists, the Inspector. A picker
// that edited whatever happened to be selected would rewrite the last door you
// drew the moment you changed the dropdown to draw a different kind next.
//
// One lock for both ends, and no `bToA`. A per-end lock and a reversed
// direction are both editing concepts: they describe a transition that already
// has an A end and a B end. At creation there is no A yet: the gesture decides
// it from the cell the drag or the first click started in, so the only
// direction a default can express is "one-way, the way I am about to draw it".
export interface TransitionOptions {
  // Applied to both ends. Omitted means `Open`.
  lockTypeId?: LockTypeId
  // One-way from the gesture's origin end to its far end.
  //
  // A boolean where the model stores a three-state, deliberately: the gesture
  // decides which end is A, so the only direction expressible at creation is
  // "the way I am about to draw it". `bToA` is an editing concept and has no
  // meaning here, and a `Direction` in this shape would offer it.
  oneWay?: boolean
}

// New transitions default to `Open`, so a fresh door reads as an open passage
// until a colour or glyph is assigned.
function defaults(options: TransitionOptions = {}) {
  const lock = options.lockTypeId ?? OPEN_LOCK_ID
  return {
    locks: { a: lock, b: lock },
    direction: (options.oneWay ? 'aToB' : 'both') as Direction,
    notes: '',
  }
}

// ---------------------------------------------------------------------------
// Box classification
// ---------------------------------------------------------------------------

export type BoxClassification =
  | { kind: 'edge'; groups: DoorSegment[][] }
  | { kind: 'elevator'; a: CellKey; b: CellKey; axis: 'h' | 'v' }
  | { kind: 'invalid' }

export function boxCells(from: CellKey, to: CellKey): CellKey[] {
  const a = parseCell(from)
  const b = parseCell(to)
  const cells: CellKey[] = []
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
      cells.push(cellKey(x, y))
    }
  }
  return cells
}

export function classifyBox(map: MapModel, from: CellKey, to: CellKey): BoxClassification {
  const a = parseCell(from)
  const b = parseCell(to)
  const width = Math.abs(a.x - b.x) + 1
  const height = Math.abs(a.y - b.y) + 1

  // "Exactly 2 thick across the boundary and N long along it." Which dimension
  // is the thickness depends on which way the boundary runs, and that is only
  // known once the cross-room edges are found, so the test is applied per
  // segment axis rather than to the raw dimensions:
  //
  //   a V-axis segment sits on a vertical seam, crossed left-to-right, so the
  //   box must be exactly 2 wide;
  //   an H-axis segment sits on a horizontal seam, so it must be exactly 2 tall.
  //
  // This keeps the N=1 door (a 1x2 or 2x1 box) and the 2x2 corner (both axes
  // legal, yielding one horizontal and one vertical door) working, while
  // rejecting e.g. a 2-wide x 4-tall box across a horizontal seam, which
  // is 4 thick across the boundary and must cancel.
  if (width === 2 || height === 2) {
    const groups = doorSegmentsInBox(map, from, to, width, height)
    if (groups.length > 0) return { kind: 'edge', groups }
  }

  // A 1-thick box is elevator territory: it has to span a gap. Anything else
  // is thicker than 2 across the boundary and is rejected outright.
  if (width !== 1 && height !== 1) return { kind: 'invalid' }
  return classifyElevator(map, from, to)
}

// Walks every internal edge of the box and keeps the ones whose two cells are
// in different rooms, then groups them per room-pair and contiguous run, so
// A<->B and A<->C inside one drag become distinct objects.
//
// This general walk is also what resolves the 2x2 corner case: doors can never
// be diagonal, so a corner box simply yields whichever cross-room edges are
// inside it: a horizontal door plus a vertical one, with no tiebreak needed.
function doorSegmentsInBox(
  map: MapModel,
  from: CellKey,
  to: CellKey,
  width: number,
  height: number,
): DoorSegment[][] {
  const cells = new Set(boxCells(from, to))
  const seen = new Set<string>()
  // Keyed by the unordered room pair, so one drag across two different
  // neighbours produces two transition objects rather than one mixed one.
  const byPair = new Map<string, DoorSegment[]>()

  for (const cell of cells) {
    const owner = map.cellOwner.get(cell)
    if (owner === undefined) continue

    for (const side of ['E', 'S'] as const) {
      const edge = edgeOfCell(cell, side)
      if (seen.has(edge)) continue
      // The thickness rule, applied per axis: see classifyBox.
      if (parseEdge(edge).axis === 'V' ? width !== 2 : height !== 2) continue
      const { lo, hi } = edgeCells(edge)
      // Both cells must be inside the box: the box is the user's statement of
      // which boundary they meant.
      if (!cells.has(lo) || !cells.has(hi)) continue

      const loOwner = map.cellOwner.get(lo)
      const hiOwner = map.cellOwner.get(hi)
      if (loOwner === undefined || hiOwner === undefined || loOwner === hiOwner) continue

      seen.add(edge)
      // A is the end the drag started from, so the per-end locks stay
      // meaningful: whichever side holds the origin cell's room is A.
      const originOwner = map.cellOwner.get(from)
      const aSide: 'lo' | 'hi' = originOwner === loOwner ? 'lo' : 'hi'
      const key = pairKey(loOwner, hiOwner)
      const bucket = byPair.get(key)
      if (bucket) bucket.push({ edge, aSide })
      else byPair.set(key, [{ edge, aSide }])
    }
  }

  const groups: DoorSegment[][] = []
  for (const segments of byPair.values()) groups.push(...contiguousRuns(segments))
  return groups
}

function pairKey(a: RoomId, b: RoomId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

// An elevator connects the facing edges of two rooms across a gap, horizontal
// or vertical only, constrained to 1 tile wide. The released cell need not be
// on the facing edge: the endpoints snap to it.
function classifyElevator(map: MapModel, from: CellKey, to: CellKey): BoxClassification {
  const a = parseCell(from)
  const b = parseCell(to)
  const axis: 'h' | 'v' = a.y === b.y ? 'h' : 'v'
  if (a.x !== b.x && a.y !== b.y) return { kind: 'invalid' }

  const originRoom = map.cellOwner.get(from)
  if (originRoom === undefined) return { kind: 'invalid' }

  const dx = Math.sign(b.x - a.x)
  const dy = Math.sign(b.y - a.y)
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))
  if (steps === 0) return { kind: 'invalid' }

  // Walk outward to the cell the user actually released on, and take the room
  // there as the destination. The gap may contain empty cells or other rooms:
  // the shaft simply renders behind them, so an intervening room must not
  // terminate the walk.
  const released = cellKey(a.x + dx * steps, a.y + dy * steps)
  const destinationRoom = map.cellOwner.get(released)
  if (destinationRoom === undefined || destinationRoom === originRoom) {
    return { kind: 'invalid' }
  }

  // Endpoints snap to the facing edges: the last origin-room cell walking out,
  // and the first destination-room cell walking back in.
  let lastOrigin = from
  for (let i = 1; i <= steps; i++) {
    const cell = cellKey(a.x + dx * i, a.y + dy * i)
    if (map.cellOwner.get(cell) === originRoom) lastOrigin = cell
    else break
  }

  let firstDestination = released
  for (let i = steps - 1; i >= 0; i--) {
    const cell = cellKey(a.x + dx * i, a.y + dy * i)
    if (map.cellOwner.get(cell) === destinationRoom) firstDestination = cell
    else break
  }

  // With no gap the two rooms are adjacent, which is a door, not an elevator.
  if (!isGapIntact(map, lastOrigin, firstDestination, originRoom, destinationRoom)) {
    return { kind: 'invalid' }
  }
  return { kind: 'elevator', a: lastOrigin, b: firstDestination, axis }
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

// Commits whatever a box drag classified into. Returns the created
// transitions, which may be several (one drag can cross two room pairs).
// Refuses rather than returning an empty array: "the box classified to
// nothing" is a real outcome the Door-mode gesture wants to distinguish from
// "it made zero doors", and an empty array said both.
export function createFromBox(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  from: CellKey,
  to: CellKey,
  options: TransitionOptions = {},
): Outcome<Transition[]> {
  const result = classifyBox(map, from, to)
  if (result.kind === 'invalid') return refuse('no-valid-connection')

  const created: Transition[] = []

  if (result.kind === 'edge') {
    for (const segments of result.groups) {
      const door: EdgeTransition = {
        kind: 'edge',
        id: tx.ids.mint('tr'),
        segments,
        ...defaults(options),
      }
      putTransition(tx, project, map, door)
      created.push(door)
    }
    return created
  }

  const elevator: ElevatorTransition = {
    kind: 'elevator',
    id: tx.ids.mint('tr'),
    a: result.a,
    b: result.b,
    axis: result.axis,
    ...defaults(options),
  }
  putTransition(tx, project, map, elevator)
  created.push(elevator)
  return created
}

// Why a teleport cannot run between these two endpoints, or null if it can.
//
// Two distinct failures, and they need distinct messages: an endpoint on bare
// grid is `not-in-a-room`, while two endpoints inside the same room is
// `same-room`. Folding both into one predicate meant a click on empty grid was
// reported as "both ends are in the same room", which is not just unhelpful
// but describes a situation the user can see is false.
export function teleportRefusal(
  project: ProjectModel,
  origin: { mapId: MapId; cell: CellKey },
  destination: { mapId: MapId; cell: CellKey },
): 'not-in-a-room' | 'same-room' | null {
  const originRoom = project.mapsById.get(origin.mapId)?.cellOwner.get(origin.cell)
  const destRoom = project.mapsById.get(destination.mapId)?.cellOwner.get(destination.cell)
  if (originRoom === undefined || destRoom === undefined) return 'not-in-a-room'
  // Different maps cannot share a room, whatever the cell keys say.
  if (origin.mapId !== destination.mapId) return null
  return originRoom === destRoom ? 'same-room' : null
}

// A teleport's two endpoints must be in rooms, and in different rooms. Both
// failures leave the pending-state machine pending, so a misclick never forces
// a restart: the gesture layer only needs the yes/no. Derived from
// `teleportRefusal` rather than repeating its conditions, so the two cannot
// disagree about what a valid pair is.
export function canCompleteTeleport(
  project: ProjectModel,
  origin: { mapId: MapId; cell: CellKey },
  destination: { mapId: MapId; cell: CellKey },
): boolean {
  return teleportRefusal(project, origin, destination) === null
}

// Whether a teleport endpoint already occupies this cell: near end (indexed
// on the map that stores it) or far end (in the project-scope index).
export function hasTeleportAt(project: ProjectModel, mapId: MapId, cell: CellKey): boolean {
  if (getFarEnd(project.teleportFarEnds, mapId, cell) !== undefined) return true
  const map = project.mapsById.get(mapId)
  if (!map) return false
  for (const id of map.transitionsAtCell.get(cell) ?? []) {
    if (map.transitions.get(id)?.kind === 'teleport') return true
  }
  return false
}

// Stored once, under its origin map, cross-tab when the endpoint mapIds
// differ. The destination tab's marker is rebuilt from the far-end index, so
// nothing is duplicated and there is no two-copy sync problem.
export function createTeleport(
  tx: Transaction,
  project: ProjectModel,
  origin: { mapId: MapId; cell: CellKey },
  destination: { mapId: MapId; cell: CellKey },
  options: TransitionOptions = {},
): Outcome<TeleportTransition> {
  const originMap = mustGet(project.mapsById, origin.mapId, 'map')
  // Both of these leave the pending-state machine pending: an invalid second
  // click is ignored and the gesture stays live, so they must be
  // distinguishable from a hard failure and from each other, since each
  // refusal reason maps to one translated message.
  const blocked = teleportRefusal(project, origin, destination)
  if (blocked) return refuse(blocked)

  // At most one teleport per cell, unlike edge transitions which are per-edge
  // and allow four to a cell. Checked at both ends: enforcing it only at the
  // origin would let two teleports share a destination cell.
  if (hasTeleportAt(project, origin.mapId, origin.cell)) return refuse('teleport-exists')
  if (hasTeleportAt(project, destination.mapId, destination.cell)) {
    return refuse('teleport-exists')
  }

  const teleport: TeleportTransition = {
    kind: 'teleport',
    id: tx.ids.mint('tr'),
    a: { mapId: origin.mapId, cell: origin.cell },
    b: { mapId: destination.mapId, cell: destination.cell },
    ...defaults(options),
  }
  putTransition(tx, project, originMap, teleport)
  return teleport
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

// Finds a transition by id from whichever tab the user is looking at.
//
// A cross-tab teleport is stored once, under its origin map, while the
// destination tab draws a marker rebuilt from the far-end index. The marker
// is hit-testable and selectable, so editing a teleport from its destination
// tab requires a lookup through the far-end index to find which map stores it.
// Ops must then operate on that map, not the one they were handed:
// `removeTransition` and friends maintain indices on the storing map.
export function resolveTransition(
  project: ProjectModel,
  map: MapModel,
  transitionId: TransitionId,
): { map: MapModel; transition: Transition } {
  const local = map.transitions.get(transitionId)
  if (local) return { map, transition: local }

  for (const ref of farEndsOnMap(project.teleportFarEnds, map.id).values()) {
    if (ref.transitionId !== transitionId) continue
    const owner = mustGet(project.mapsById, ref.originMapId, 'map')
    return { map: owner, transition: mustGet(owner.transitions, transitionId, 'transition') }
  }

  // Genuinely not here, on this tab or the other end of anything on it.
  throw new ModelError(`no transition with id ${transitionId}`)
}

export function setDirection(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  transitionId: TransitionId,
  direction: Direction,
): void {
  // Everything below works on the map the transition is stored under, which
  // is not necessarily the tab the user is on: see `resolveTransition`.
  const { map: owner, transition } = resolveTransition(project, map, transitionId)
  setTransitionField(tx, owner, transition, 'direction', direction)
}

// Per-end lock assignment. The panel defaults to synced, so `both` is the
// common case and setting one end independently is what models an asymmetric
// door (missile on one side, open on the other).
export function setLock(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  transitionId: TransitionId,
  end: 'a' | 'b' | 'both',
  lockTypeId: LockTypeId,
): void {
  const { map: owner, transition } = resolveTransition(project, map, transitionId)
  const locks =
    end === 'both' ? { a: lockTypeId, b: lockTypeId } : { ...transition.locks, [end]: lockTypeId }
  setTransitionField(tx, owner, transition, 'locks', locks)
}

export function setTransitionNotes(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  transitionId: TransitionId,
  notes: string,
): void {
  const { map: owner, transition } = resolveTransition(project, map, transitionId)
  setTransitionField(tx, owner, transition, 'notes', notes)
}

// Right-click deletes a transition.
export function deleteTransition(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  transitionId: TransitionId,
): void {
  const { map: owner, transition } = resolveTransition(project, map, transitionId)
  removeTransition(tx, project, owner, transition)
}

export function isValid(project: ProjectModel, map: MapModel, transition: Transition): boolean {
  return isTransitionValid(project, map, transition)
}
