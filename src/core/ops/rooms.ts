// Room operations: the edits the Draw/Edit and Select/Move gestures perform.
//
// These are the model-level verbs. They take a set of cells (or a delta, or a
// transform) and enforce the rules: rooms never overlap, a room is
// orthogonally connected, every destructive case resolves in favour of the
// acting room, and every cascade (icons, inner walls, transitions, splits)
// lands in the same transaction.
//
// What they deliberately do not do is decide which cells. Accumulating a
// free-form stroke, resolving a brush footprint, hit-testing an edge run:
// all of that is the gesture layer's job, on top of this. That split is what
// lets the gesture layer re-apply an op on every pointer move to drive the
// ghost.

import {
  edgeBetween,
  edgeCells,
  edgeOfCell,
  neighborOn,
  parseCell,
  translate,
  SIDES,
  SIDE_DELTA,
} from '../cell'
import type { CellKey, EdgeKey } from '../cell'
import { connectedComponents, originalGroupIndex, transformCells } from '../derive/connectivity'
import type { Transform } from '../derive/connectivity'
import { isInnerWallEdge } from '../derive/walls'
import type { EdgeRun } from '../derive/walls'
import { createRoom } from '../factory'
import { WORLD_AREA_ID } from '../ids'
import type { AreaId, RoomId } from '../ids'
import type { Transaction } from '../journal'
import {
  addCell,
  moveRoomInOrder,
  putRoom,
  relocateIcons,
  removeCell,
  removeIcon,
  removeInnerWall,
  removeRoom,
  setInnerWall,
  setRoomField,
} from '../primitives'
import { mustGet, refuse } from '../outcome'
import type { Outcome } from '../outcome'
import type { MapModel, ProjectModel, Room, WallStyle } from '../types'
import { cascadeTransitions, removeTransitionsTouching } from './transitions'

// ---------------------------------------------------------------------------
// Shared cleanup
// ---------------------------------------------------------------------------

// An inner wall is valid only while it is strictly interior: both cells it
// borders belong to the same room. Rather than tracking that per edit, every
// op ends by pruning: any wall whose two cells are no longer both in the room
// simply goes. That covers erase, shrink, split and merge in one rule.
//
// `changed` narrows the sweep to walls that could actually have been affected.
// Without it, this walks every wall in the room on every call: since a drag
// re-applies its whole operation on each pointer move, an edit touching a
// handful of cells would otherwise cost work proportional to the size of the
// room. Passing nothing still sweeps everything, which is what the load path
// and a whole-room merge want.
function pruneInnerWalls(
  tx: Transaction,
  map: MapModel,
  room: Room,
  changed?: ReadonlySet<CellKey>,
): void {
  if (changed && changed.size * 4 < room.innerWalls.size) {
    // Only the (up to four) edges around each changed cell can have become
    // non-interior.
    const seen = new Set<EdgeKey>()
    for (const cell of changed) {
      for (const side of SIDES) {
        const edge = edgeOfCell(cell, side)
        if (seen.has(edge) || !room.innerWalls.has(edge)) continue
        seen.add(edge)
        if (!isInnerWallEdge(room, edge)) removeInnerWall(tx, map, room, edge)
      }
    }
    return
  }

  for (const edge of [...room.innerWalls.keys()]) {
    if (!isInnerWallEdge(room, edge)) removeInnerWall(tx, map, room, edge)
  }
}

// An icon dies with its cell, but only when the cell becomes unowned. A
// cell changing hands (merge, absorb) carries its icon to the new owner for
// free, which is the entire point of deriving ownership from cells.
function deleteOrphanedIcons(tx: Transaction, map: MapModel, cells: Iterable<CellKey>): void {
  for (const cell of cells) {
    if (map.cellOwner.has(cell)) continue
    const iconId = map.iconAtCell.get(cell)
    if (iconId === undefined) continue
    const icon = map.icons.get(iconId)
    if (icon) removeIcon(tx, map, icon)
  }
}

// Splits a room that an edit disconnected. One group keeps the identity (the
// one holding the top-most-then-left-most cell); the rest become new rooms
// inheriting a copy of its properties (same area, name, notes).
function splitIfDisconnected(tx: Transaction, map: MapModel, room: Room): Room[] {
  if (room.cells.size === 0) return []
  const groups = connectedComponents(room.cells)
  if (groups.length <= 1) return []

  const keepIndex = originalGroupIndex(groups)
  const created: Room[] = []
  const insertAt = map.roomOrder.indexOf(room.id) + 1

  groups.forEach((group, index) => {
    if (index === keepIndex) return
    const split = createRoom(room.areaId, tx.ids.mint('room'))
    split.name = room.name
    split.notes = room.notes
    putRoom(tx, map, split, insertAt + created.length)

    for (const cell of group) {
      removeCell(tx, map, room, cell)
      addCell(tx, map, split, cell)
    }
    created.push(split)
  })

  // Walls follow their cells: a segment whose two cells landed in a split-off
  // room moves there; one straddling the split boundary is now an outer
  // boundary and is dropped by the prune below.
  for (const edge of [...room.innerWalls.keys()]) {
    const style = room.innerWalls.get(edge)!
    const { lo, hi } = edgeCells(edge)
    const owner = created.find((candidate) => candidate.cells.has(lo) && candidate.cells.has(hi))
    if (owner) {
      removeInnerWall(tx, map, room, edge)
      setInnerWall(tx, map, owner, edge, style)
    }
  }

  pruneInnerWalls(tx, map, room)
  for (const split of created) pruneInnerWalls(tx, map, split)

  return created
}

// Every op funnels its affected rooms through here before cascading
// transitions: prune walls, drop rooms that lost all their cells, split rooms
// that lost their connectivity.
//
// `removed` is the set of cells the op took away from these rooms. It is what
// makes settling proportional to the edit rather than to the room:
//
//   * wall pruning only inspects the edges around removed cells;
//   * connectivity is only re-checked when a removed cell bordered the room.
//
// That matters because a drag re-applies its whole operation on every pointer
// move: erasing 50 cells from a 3600-cell room would otherwise run a full
// flood fill per frame.
//
// Omitting `removed` means "unknown, re-check everything", which is the
// opposite of passing an empty set. Callers that add cells must not assume
// they are safe: an op that only adds cells can still leave a room in pieces
// if the cells it adds do not touch the room or each other, which is exactly
// what a sampled pointer path does. `paintCells` earns its skip by proving
// the stroke links every piece first; nothing else should assume it.
function settleRooms(
  tx: Transaction,
  map: MapModel,
  roomIds: Iterable<RoomId>,
  removed?: ReadonlySet<CellKey>,
): void {
  for (const roomId of roomIds) {
    // Tolerant on purpose, unlike the public ops, which `mustGet`. These ids
    // come from the op that just ran, and it may legitimately have removed one
    // already: a merge absorbs a room whole, a donor can be emptied. A
    // missing id here means "already settled", not "stale caller".
    const room = map.rooms.get(roomId)
    if (!room) continue
    if (room.cells.size === 0) {
      pruneInnerWallsAll(tx, map, room)
      removeRoom(tx, map, room)
      continue
    }
    pruneInnerWalls(tx, map, room, removed)
    // Only a removal can disconnect a room.
    if (removed && !hasAnyOf(removed, room, map)) continue
    splitIfDisconnected(tx, map, room)
  }
}

// Whether any of the removed cells was adjacent to this room, i.e. whether
// the removal could plausibly have cut it. Cheap compared with a flood fill.
function hasAnyOf(removed: ReadonlySet<CellKey>, room: Room, map: MapModel): boolean {
  for (const cell of removed) {
    if (map.cellOwner.get(cell) === room.id) return true
    for (const side of SIDES) {
      if (room.cells.has(neighborOn(cell, side))) return true
    }
  }
  return false
}

// An empty removal set: "this op removed no cells", which lets settleRooms
// skip both the connectivity check and the wall sweep. Omitting the argument
// entirely means the opposite: "unknown, re-check everything".
const NO_CELLS: ReadonlySet<CellKey> = new Set()
const RECHECK = undefined

// Whether a paint stroke provably leaves the room in one piece, decided from
// the stroke's own cells and their immediate neighbours: O(stroke), not
// O(room).
//
// Adding cells to a connected room usually cannot disconnect it, which is why
// painting skips the flood fill. But the cells being added need not touch the
// room, or each other: a pointer sampled along a diagonal gives a staircase,
// which is not orthogonally connected, and a stroke absorbs any room it
// crosses whole, however far away that room's other cells are.
//
// So the pieces being joined are the origin room, each absorbed room, and each
// newly painted free cell; the question is whether the stroke links them all.
// A union-find over those pieces answers it without touching the rest of the
// room.
//
// Deliberately conservative: two rooms that already touched, with no stroke
// cell bridging them, read as separate here. That costs a flood fill that was
// not strictly needed, never a missed split.
//
// Must be called before anything mutates, while `map.cellOwner` still
// describes the pre-stroke grid.
function paintStaysConnected(
  map: MapModel,
  room: Room,
  targets: ReadonlySet<CellKey>,
  absorbed: ReadonlySet<RoomId>,
): boolean {
  const parent = new Map<string, string>()
  const find = (node: string): string => {
    let root = parent.get(node)
    if (root === undefined) {
      parent.set(node, node)
      return node
    }
    while (root !== parent.get(root)) root = parent.get(root)!
    parent.set(node, root)
    return root
  }
  const union = (a: string, b: string): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootA, rootB)
  }

  // Which piece of the painted room a cell belongs to, or null if it is not
  // part of it at all: free grid, or a room this stroke never touches.
  const pieceOf = (cell: CellKey): string | null => {
    const owner = map.cellOwner.get(cell)
    if (owner === undefined) return targets.has(cell) ? cell : null
    if (owner === room.id || absorbed.has(owner)) return owner
    return null
  }

  const pieces = new Set<string>()
  if (room.cells.size > 0) pieces.add(room.id)
  for (const id of absorbed) pieces.add(id)

  for (const cell of targets) {
    const piece = pieceOf(cell)
    if (piece === null) continue
    pieces.add(piece)
    for (const side of SIDES) {
      const neighbour = pieceOf(neighborOn(cell, side))
      if (neighbour !== null) union(piece, neighbour)
    }
  }

  const roots = new Set<string>()
  for (const piece of pieces) roots.add(find(piece))
  return roots.size <= 1
}

function pruneInnerWallsAll(tx: Transaction, map: MapModel, room: Room): void {
  for (const edge of [...room.innerWalls.keys()]) removeInnerWall(tx, map, room, edge)
}

// Takes cells away from whichever rooms own them, returning those rooms' ids
// so the caller can settle them once the dust has cleared.
function vacate(
  tx: Transaction,
  map: MapModel,
  cells: Iterable<CellKey>,
  except?: RoomId,
): Set<RoomId> {
  const donors = new Set<RoomId>()
  for (const cell of cells) {
    const ownerId = map.cellOwner.get(cell)
    if (ownerId === undefined || ownerId === except) continue
    const owner = map.rooms.get(ownerId)
    if (!owner) continue
    removeCell(tx, map, owner, cell)
    donors.add(ownerId)
  }
  return donors
}

// ---------------------------------------------------------------------------
// Paint / grow / merge
// ---------------------------------------------------------------------------

export interface PaintOptions {
  // The room the stroke started in: the room that wins when the stroke
  // crosses others. Undefined starts a new room, the empty-cell case.
  intoRoomId?: RoomId
  // Area for a newly created room; ignored when growing an existing one.
  areaId: AreaId
}

// Paints a set of cells into one room, absorbing any room the stroke crosses.
//
// Merge is whole-room and destructive by design: crossing into room B makes
// all of B part of the origin room and deletes B. That is different from
// resize and move, which take only the cells they land on.
export function paintCells(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  cells: Iterable<CellKey>,
  options: PaintOptions,
): Room {
  const targets = new Set(cells)
  // An empty stroke still has to name a room: growing an existing one returns
  // it untouched, and starting a new one creates it empty rather than handing
  // back a null the gesture layer would have to special-case every frame.

  // A stale `intoRoomId` is a bug in the caller, not a request to start a new
  // room: since the ghost re-applies this on every pointer move, silently
  // falling back would turn a grow stroke into a new room per frame while
  // still handing the gesture layer a plausible-looking Room back. `undefined`
  // still means "start a new room": that is the empty-cell case, and it is
  // explicit.
  let room = options.intoRoomId ? mustGet(map.rooms, options.intoRoomId, 'room') : undefined
  if (!room) {
    room = createRoom(options.areaId, tx.ids.mint('room'))
    putRoom(tx, map, room)
  }

  // Every room the stroke touches is absorbed whole.
  const absorbed = new Set<RoomId>()
  for (const cell of targets) {
    const ownerId = map.cellOwner.get(cell)
    if (ownerId !== undefined && ownerId !== room.id) absorbed.add(ownerId)
  }

  // Decided before anything moves, while cellOwner still describes the
  // pre-stroke grid.
  const staysConnected = paintStaysConnected(map, room, targets, absorbed)

  for (const ownerId of absorbed) {
    const owner = map.rooms.get(ownerId)
    if (!owner) continue
    // Inner walls come across with the cells; they stay interior because the
    // whole room is being adopted.
    const walls = [...owner.innerWalls.entries()]
    for (const cell of [...owner.cells]) {
      removeCell(tx, map, owner, cell)
      addCell(tx, map, room, cell)
    }
    for (const [edge, style] of walls) {
      removeInnerWall(tx, map, owner, edge)
      setInnerWall(tx, map, room, edge, style)
    }
    removeRoom(tx, map, owner)
  }

  for (const cell of targets) {
    if (!map.cellOwner.has(cell)) addCell(tx, map, room, cell)
  }

  // Painting removes no cells, so the wall sweep has nothing to do either way.
  // Connectivity is the part that has to be earned: see `paintStaysConnected`
  // for why "adding cells cannot disconnect a room" is false for a stroke.
  settleRooms(tx, map, [room.id], staysConnected ? NO_CELLS : RECHECK)
  cascadeTransitions(tx, project, map)
  return room
}

// ---------------------------------------------------------------------------
// Erase
// ---------------------------------------------------------------------------

// Erases cells wherever they are. May split the rooms it cuts through; deletes
// icons and inner walls that lose their cell; re-validates transitions.
export function eraseCells(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  cells: Iterable<CellKey>,
): void {
  const targets = new Set(cells)
  const donors = vacate(tx, map, targets)
  if (donors.size === 0) return

  deleteOrphanedIcons(tx, map, targets)
  settleRooms(tx, map, donors, targets)
  cascadeTransitions(tx, project, map)
}

// ---------------------------------------------------------------------------
// Delete whole rooms
// ---------------------------------------------------------------------------

export function deleteRooms(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  roomIds: Iterable<RoomId>,
): void {
  const cells = new Set<CellKey>()
  const rooms: Room[] = []
  for (const roomId of roomIds) {
    const room = mustGet(map.rooms, roomId, 'room')
    rooms.push(room)
    for (const cell of room.cells) cells.add(cell)
  }
  if (rooms.length === 0) return

  // Explicit rather than left to re-validation: deleting a room deletes all
  // its transitions, including a teleport whose other end is still fine.
  removeTransitionsTouching(tx, project, map, cells)

  for (const room of rooms) {
    for (const cell of [...room.cells]) removeCell(tx, map, room, cell)
    pruneInnerWallsAll(tx, map, room)
    removeRoom(tx, map, room)
  }

  deleteOrphanedIcons(tx, map, cells)
  cascadeTransitions(tx, project, map)
}

// ---------------------------------------------------------------------------
// Resize by edge run
// ---------------------------------------------------------------------------

// Extrudes or retracts the grabbed run by `distance` cells (positive = expand
// outward, negative = shrink inward).
//
// Grabbed-run-only: only the cells of the run the user originally grabbed
// move, and the run never picks up extra length as the shape changes
// mid-drag. That is what makes a drag out-N-then-back-N restore the exact
// original geometry, so out-and-back-to-start is a true no-op.
export function resizeRun(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  roomId: RoomId,
  run: EdgeRun,
  distance: number,
): void {
  const room = mustGet(map.rooms, roomId, 'room')
  if (distance === 0) return

  const { dx, dy } = SIDE_DELTA[run.side]
  // Cells this resize takes away from the resizing room itself: empty for an
  // expansion, which therefore skips the connectivity re-check.
  let shrunk: ReadonlySet<CellKey> = NO_CELLS

  if (distance > 0) {
    const added: CellKey[] = []
    for (const cell of run.cells) {
      for (let step = 1; step <= distance; step++) {
        added.push(translate(cell, dx * step, dy * step))
      }
    }
    // Expansion is destructive: the resizing room wins and absorbs the cells
    // it lands on, cells only, not the whole donor room.
    const donors = vacate(tx, map, added, room.id)
    for (const cell of added) {
      if (!map.cellOwner.has(cell)) addCell(tx, map, room, cell)
    }
    settleRooms(tx, map, [...donors], new Set(added))
  } else {
    // Shrink floors at one cell: resize can never delete a room outright.
    const removable = Math.min(-distance, maxShrink(room, run))
    if (removable <= 0) return
    // Stop each ray at the first cell the room does not own. `depthAt`, which
    // `maxShrink` budgets from, already stops at a gap: a removal loop that
    // did not stop there would remove more cells than the budget accounts
    // for on a non-rectangular room, emptying it outright, and would reach
    // cells on the far side of a hole that are not part of the grabbed run's
    // extrusion.
    const removed: CellKey[] = []
    for (const cell of run.cells) {
      for (let step = 0; step < removable; step++) {
        const target = translate(cell, -dx * step, -dy * step)
        if (!room.cells.has(target)) break
        removed.push(target)
      }
    }
    for (const cell of removed) removeCell(tx, map, room, cell)
    // Removed cells follow erase semantics: their icons and inner walls go,
    // and a shrink that disconnects the room triggers the split rule.
    deleteOrphanedIcons(tx, map, removed)
    shrunk = new Set(removed)
  }

  settleRooms(tx, map, [room.id], shrunk)
  cascadeTransitions(tx, project, map)
}

// How far this run can retract before it would empty the room. Shrink floors
// at one cell: resize can never delete a room outright; that is what erase is
// for.
//
// Each run cell has its own depth, so a step of N removes sum(min(N, depth_i))
// cells rather than N per cell: the two differ as soon as the room is not a
// rectangle, which is most of the time.
function maxShrink(room: Room, run: EdgeRun): number {
  const depths = run.cells.map((cell) => depthAt(room, cell, run.side))
  const deepest = Math.max(0, ...depths)

  let best = 0
  for (let distance = 1; distance <= deepest; distance++) {
    const removed = depths.reduce((sum, depth) => sum + Math.min(distance, depth), 0)
    if (room.cells.size - removed < 1) break
    best = distance
  }
  return best
}

// How many of the room's cells lie in an unbroken line inward from `cell`.
function depthAt(room: Room, cell: CellKey, side: EdgeRun['side']): number {
  const { dx, dy } = SIDE_DELTA[side]
  let count = 0
  let probe = cell
  while (room.cells.has(probe)) {
    count++
    probe = translate(probe, -dx, -dy)
  }
  return count
}

// ---------------------------------------------------------------------------
// Move, rotate, flip
// ---------------------------------------------------------------------------

// Relocates whole rooms by an arbitrary cell mapping. Destructive: the moving
// rooms take their whole new footprint, and whatever held those cells loses
// them (and any inner wall that is no longer between two of its own cells).
//
// Icons are the exception, and deliberately: one is destroyed only when a
// carried icon replaces it, so an empty-handed cell leaves the icon standing
// and merely changes its owner. That makes move agree with paint-merge and
// resize-expand, which have always kept them.
//
// Identity, name, notes and area are preserved, and transitions ride along
// then re-validate.
function relocateRooms(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  rooms: Room[],
  mapping: Map<CellKey, CellKey>,
  // Who owned each source cell before anything moved. Step 1 empties the
  // rooms, so by step 3 there is no way left to ask.
  //
  // A required parameter, not a side channel: an empty or missing snapshot
  // means step 3 adds nothing back, every moving room ends at zero cells, and
  // `settleRooms` deletes them all. Total data loss, no error, from a caller
  // that gets this wrong.
  snapshot: Map<CellKey, RoomId>,
): void {
  const destinations = new Set(mapping.values())
  const movingIds = new Set(rooms.map((room) => room.id))

  // 1. Lift the moving rooms off the grid, remembering their walls.
  const wallsByRoom = new Map<RoomId, [EdgeKey, WallStyle][]>()
  for (const room of rooms) {
    wallsByRoom.set(room.id, [...room.innerWalls.entries()])
    for (const edge of [...room.innerWalls.keys()]) removeInnerWall(tx, map, room, edge)
    for (const cell of [...room.cells]) removeCell(tx, map, room, cell)
  }

  // 2. Clear the destination. The cells are taken outright: the moving rooms
  // win the footprint. Icons standing on them are not: an icon only dies when
  // a carried icon actually lands on it and replaces it; otherwise it
  // survives and changes owner, exactly as it does under a paint-merge or a
  // resize-expand.
  const donors = vacate(tx, map, destinations)
  for (const cell of arrivingIconCells(map, mapping)) {
    const iconId = map.iconAtCell.get(cell)
    if (iconId === undefined) continue
    const icon = map.icons.get(iconId)
    // The occupant may itself be riding along (overlapping source and
    // destination footprints). Those are relocated in step 4, not replaced.
    if (icon && !mapping.has(icon.cell)) removeIcon(tx, map, icon)
  }

  // 3. Set the moving rooms back down.
  for (const [from, to] of mapping) {
    const ownerId = snapshot.get(from)
    if (ownerId === undefined || !movingIds.has(ownerId)) continue
    const room = map.rooms.get(ownerId)
    if (room) addCell(tx, map, room, to)
  }

  // 4. Icons ride to their new cell, as one atomic step so a shift-by-one
  // never trips the one-icon-per-cell guard mid-loop.
  relocateIcons(tx, map, mapping)

  // 5. Inner walls transform with the room.
  for (const room of rooms) {
    for (const [edge, style] of wallsByRoom.get(room.id) ?? []) {
      const moved = mapEdge(edge, mapping)
      if (moved) setInnerWall(tx, map, room, moved, style)
    }
  }

  // The donors genuinely need the connectivity re-check, since they just lost
  // cells to the incoming rooms, but the prune can be narrowed to the cells
  // that actually left them.
  settleRooms(
    tx,
    map,
    [...donors].filter((id) => !movingIds.has(id)),
    destinations,
  )
  // The moving rooms cannot have been disconnected: every relocation here is
  // an isometry, so cells that were adjacent still are. Re-running the flood
  // fill for them would cost a quarter to a half of a room move, on every
  // pointer move, to prove something the transform already guarantees.
  //
  // This is the exact shortcut that is wrong in `paintCells` (a sampled
  // pointer path can add cells that touch nothing), and right here for the
  // opposite reason. `NO_CELLS` rather than an omitted argument, because
  // omitting it means "unknown, re-check everything".
  settleRooms(tx, map, movingIds, NO_CELLS)
  cascadeTransitions(tx, project, map, mapping)
}

// The destination cells a carried icon is about to land on: the only cells a
// relocation is entitled to clear an icon off, since destruction is only
// authorised as replacement, not as sweeping the footprint.
//
// Driven off the icons rather than off `destinations` because "is an icon
// arriving here?" is a question about the source side of the mapping: it is
// the icons standing inside the moving footprint that carry.
function arrivingIconCells(map: MapModel, mapping: Map<CellKey, CellKey>): Set<CellKey> {
  const arriving = new Set<CellKey>()
  for (const icon of map.icons.values()) {
    const to = mapping.get(icon.cell)
    if (to !== undefined) arriving.add(to)
  }
  return arriving
}

// Where an inner wall lands when the room it belongs to moves.
//
// An edge is defined by the two cells it separates, so it follows them: find
// where both went, and take the edge between their images. Both must move:
// a wall with only one of its cells in the mapping is no longer interior, and
// the caller's prune drops it.
//
// This deliberately does not translate the edge by a delta. That only holds
// while both cells move together, which is true of a translation and false of
// a rotation or a mirror: a vertical wall becomes a horizontal one, and a
// delta-based translation would reject every wall in the room. `edgeBetween`
// gets all four transforms right because they are isometries: adjacent cells
// stay adjacent.
function mapEdge(edge: EdgeKey, mapping: Map<CellKey, CellKey>): EdgeKey | null {
  const { lo, hi } = edgeCells(edge)
  const loTo = mapping.get(lo)
  const hiTo = mapping.get(hi)
  if (loTo === undefined || hiTo === undefined) return null
  return edgeBetween(loTo, hiTo)
}

function snapshotOwnership(map: MapModel, mapping: Map<CellKey, CellKey>): Map<CellKey, RoomId> {
  const snapshot = new Map<CellKey, RoomId>()
  for (const cell of mapping.keys()) {
    const owner = map.cellOwner.get(cell)
    if (owner !== undefined) snapshot.set(cell, owner)
  }
  return snapshot
}

// Room-select move: identity preserved, transitions ride along.
export function moveRooms(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  roomIds: Iterable<RoomId>,
  dx: number,
  dy: number,
): void {
  if (dx === 0 && dy === 0) return
  const rooms = [...roomIds].map((id) => mustGet(map.rooms, id, 'room'))
  if (rooms.length === 0) return

  const mapping = new Map<CellKey, CellKey>()
  for (const room of rooms) {
    for (const cell of room.cells) mapping.set(cell, translate(cell, dx, dy))
  }
  relocateRooms(tx, project, map, rooms, mapping, snapshotOwnership(map, mapping))
}

// Rotate / flip. Discrete, immediate and destructive: not ghosted, because
// there is no drag to preview; undo is the safety net. A multi-room selection
// transforms as a rigid group around the selection's bounding-box centre.
export function transformRooms(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  roomIds: Iterable<RoomId>,
  transform: Transform,
): void {
  const rooms = [...roomIds].map((id) => mustGet(map.rooms, id, 'room'))
  if (rooms.length === 0) return

  const all: CellKey[] = []
  for (const room of rooms) all.push(...room.cells)
  const mapping = transformCells(all, transform)
  relocateRooms(tx, project, map, rooms, mapping, snapshotOwnership(map, mapping))
}

// ---------------------------------------------------------------------------
// Cell-fragment move (Select/Move, cell sub-mode)
// ---------------------------------------------------------------------------

// Moving a cell-selection is deliberately not a room move: the grabbed
// cells become new room(s) by connectivity, losing identity, name, notes and
// transitions, while the leftover keeps the original room's identity. That is
// the explicit signal the Rooms/Cells toggle exists to give.
export function moveCellFragment(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  cells: Iterable<CellKey>,
  dx: number,
  dy: number,
  nameFor?: (index: number) => string,
): Room[] {
  if (dx === 0 && dy === 0) return []
  // Only cells that are actually in a room can be dragged out of one. A
  // marquee is a rectangle over the grid, so it routinely covers empty space,
  // and taking that space at face value would materialise rooms out of it: a
  // 3x3 marquee containing one painted cell would land nine cells at the
  // destination as a new room.
  //
  // Filtering the same way `copyCells` does keeps a copy-then-paste and a
  // move of the same marquee producing the same geometry.
  const grabbed = new Set([...cells].filter((cell) => map.cellOwner.has(cell)))
  if (grabbed.size === 0) return []

  // Remember each grabbed cell's source area before anything moves: a
  // fragment spanning two areas takes its top-left-most cell's area.
  const sourceArea = new Map<CellKey, AreaId>()
  const carriedWalls: [EdgeKey, WallStyle][] = []
  for (const cell of grabbed) {
    const ownerId = map.cellOwner.get(cell)
    if (ownerId === undefined) continue
    const owner = map.rooms.get(ownerId)
    if (owner) sourceArea.set(cell, owner.areaId)
  }
  // Segments strictly interior to the grabbed cells travel; one straddling the
  // cut boundary is carried by neither piece.
  for (const room of map.rooms.values()) {
    for (const [edge, style] of room.innerWalls) {
      const { lo, hi } = edgeCells(edge)
      if (grabbed.has(lo) && grabbed.has(hi)) carriedWalls.push([edge, style])
    }
  }

  const mapping = new Map<CellKey, CellKey>()
  for (const cell of grabbed) mapping.set(cell, translate(cell, dx, dy))

  // Lift the fragment: the leftover keeps the original identity and splits by
  // the normal top-left tiebreaker if it is itself disconnected.
  const donors = vacate(tx, map, grabbed)
  const destinations = new Set(mapping.values())

  // The drop is fully destructive at the destination.
  const overwritten = vacate(tx, map, destinations)
  for (const cell of destinations) {
    const iconId = map.iconAtCell.get(cell)
    if (iconId === undefined) continue
    const icon = map.icons.get(iconId)
    if (icon && !mapping.has(icon.cell)) removeIcon(tx, map, icon)
  }

  // New rooms, one per connected group of the moved fragment.
  const groups = connectedComponents(destinations)
  const created: Room[] = []
  groups.forEach((group, index) => {
    const areaId = areaForGroup(group, mapping, sourceArea)
    const room = createRoom(areaId, tx.ids.mint('room'))
    if (nameFor) room.name = nameFor(index)
    putRoom(tx, map, room)
    for (const cell of group) addCell(tx, map, room, cell)
    created.push(room)
  })

  // Icons ride with their cells.
  relocateIcons(tx, map, mapping)

  // Carried inner walls land on whichever new room now owns both their cells.
  for (const [edge, style] of carriedWalls) {
    const moved = mapEdge(edge, mapping)
    if (!moved) continue
    const { lo, hi } = edgeCells(moved)
    const owner = created.find((room) => room.cells.has(lo) && room.cells.has(hi))
    if (owner) setInnerWall(tx, map, owner, moved, style)
  }

  deleteOrphanedIcons(tx, map, grabbed)
  settleRooms(tx, map, [...donors, ...overwritten])
  settleRooms(
    tx,
    map,
    created.map((room) => room.id),
  )
  // Transitions are never carried by a cell move; the fragment's old anchors
  // are gone, so re-validation deletes what no longer connects two rooms.
  cascadeTransitions(tx, project, map)
  return created
}

function areaForGroup(
  group: Set<CellKey>,
  mapping: Map<CellKey, CellKey>,
  sourceArea: Map<CellKey, AreaId>,
): AreaId {
  // Walk back from destination cells to their sources, then take the
  // top-left-most source's area.
  const reverse = new Map<CellKey, CellKey>()
  for (const [from, to] of mapping) reverse.set(to, from)

  let best: AreaId | undefined
  let bestX = 0
  let bestY = 0
  for (const cell of group) {
    const from = reverse.get(cell)
    if (from === undefined) continue
    const area = sourceArea.get(from)
    if (area === undefined) continue
    const { x, y } = parseCell(from)
    if (best === undefined || y < bestY || (y === bestY && x < bestX)) {
      best = area
      bestX = x
      bestY = y
    }
  }
  // Nothing to inherit from (every grabbed cell was unowned) falls back to the
  // guaranteed area rather than leaving a dangling reference.
  return best ?? [...sourceArea.values()][0] ?? WORLD_AREA_ID
}

// ---------------------------------------------------------------------------
// Inner walls
// ---------------------------------------------------------------------------

// Draws or re-styles an inner wall. Only strictly-interior edges are legal:
// an edge whose two cells are not both in this room is an outer boundary, and
// outer walls can never be drawn by hand.
export function drawInnerWall(
  tx: Transaction,
  map: MapModel,
  roomId: RoomId,
  edge: EdgeKey,
  style: WallStyle,
): Outcome {
  const room = mustGet(map.rooms, roomId, 'room')
  // An edge with a cell outside this room is an outer boundary, and outer
  // walls can never be drawn by hand: worth telling the user rather than
  // silently doing nothing when they drag on the wrong vertex.
  if (!isInnerWallEdge(room, edge)) return refuse('not-interior')
  setInnerWall(tx, map, room, edge, style)
}

export function eraseInnerWall(
  tx: Transaction,
  map: MapModel,
  roomId: RoomId,
  edge: EdgeKey,
): void {
  removeInnerWall(tx, map, mustGet(map.rooms, roomId, 'room'), edge)
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------
//
// These take a RoomId, like every other op in core, rather than a Room: a
// selection holds ids (ObjectRef), so a Room parameter would push the lookup
// and guard onto every call site. `mustGet` is the guard the return
// convention says core should own.

export function renameRoom(tx: Transaction, map: MapModel, roomId: RoomId, name: string): void {
  setRoomField(tx, map, mustGet(map.rooms, roomId, 'room'), 'name', name)
}

export function setRoomNotes(tx: Transaction, map: MapModel, roomId: RoomId, notes: string): void {
  setRoomField(tx, map, mustGet(map.rooms, roomId, 'room'), 'notes', notes)
}

export function assignRoomArea(
  tx: Transaction,
  map: MapModel,
  roomId: RoomId,
  areaId: AreaId,
): void {
  setRoomField(tx, map, mustGet(map.rooms, roomId, 'room'), 'areaId', areaId)
}

// Hierarchy drag-reorder. The op exists so the Hierarchy panel has an entry
// point in `ops/` like every other gesture: `reorderMap` already does, and
// without it the only way to reorder a room would be importing
// `moveRoomInOrder` from `primitives.ts` directly, reaching through the layer
// that owns journalling.
export function reorderRoom(tx: Transaction, map: MapModel, roomId: RoomId, toIndex: number): void {
  mustGet(map.rooms, roomId, 'room')
  moveRoomInOrder(tx, map, roomId, toIndex)
}

// Handy for gesture code and tests: which rooms a cell set would absorb.
export function roomsTouchedBy(map: MapModel, cells: Iterable<CellKey>): Set<RoomId> {
  const rooms = new Set<RoomId>()
  for (const cell of cells) {
    const owner = map.cellOwner.get(cell)
    if (owner !== undefined) rooms.add(owner)
  }
  return rooms
}

// Whether a cell is orthogonally adjacent to a room: the "grow" test the
// Draw/Edit gesture uses to decide a stroke is extending rather than starting.
export function isAdjacentToRoom(map: MapModel, roomId: RoomId, cell: CellKey): boolean {
  const room = map.rooms.get(roomId)
  // A predicate, so an unknown id is simply "no" rather than a throw: asking
  // about something that is not there is a fair question.
  if (!room) return false
  return SIDES.some((side) => room.cells.has(neighborOn(cell, side)))
}
