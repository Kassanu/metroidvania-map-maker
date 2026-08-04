// The only way to mutate the model.
//
// Every function here does three things together, which is precisely why it is
// not safe to bypass them:
//
//   1. applies the edit,
//   2. keeps the affected indices consistent (cellOwner, iconAtCell,
//      transitionsAtCell/AtEdge, teleportFarEnds),
//   3. records an exact inverse on the transaction, and marks what it touched.
//
// Because the inverse is recorded next to the mutation, undo is correct by
// construction even for cascades. Indices are restored by the same replay
// rather than being rebuilt from scratch, which is what makes a ghost cheap
// enough to re-apply on every pointer move.
//
// Ops (ops/*.ts) compose these into the operations the user actually performs.
// They enforce the rules (rooms never overlap, connectivity, validity cascades);
// the primitives enforce only internal consistency.

import { edgeCells, facingEdges, parseCell } from './cell'
import type { CellKey, EdgeKey } from './cell'
import { deleteFarEnd, getFarEnd, restoreFarEnd, setFarEnd } from './farEnds'
import type { FarEndRef } from './farEnds'
import { ModelError } from './outcome'
import type { Transaction } from './journal'
import type { AreaId, IconId, LineId, LockTypeId, MapId, RoomId, TransitionId } from './ids'
import type {
  Area,
  IconObject,
  LineObject,
  LockType,
  MapModel,
  ProjectModel,
  ProjectSettings,
  Room,
  Transition,
  WallStyle,
} from './types'

// Revisions only ever increase, on both redo and undo. A monotonic counter is
// all a derived cache needs: "is this still the number I computed against?"
// Never having to restore an old value means rev bumps compose freely with
// rollback.
// Geometry changed: the room's derived cache (outer walls, edge runs, bounding
// box) is now stale.
function bumpRoom(room: Room, map: MapModel): void {
  room.rev++
  map.rev++
}

// Identity changed. The map still repaints (a room's name and colour are on
// screen) but nothing geometric needs re-deriving.
function bumpRoomMeta(room: Room, map: MapModel): void {
  room.metaRev++
  map.rev++
}

function addTo<K, V>(index: Map<K, Set<V>>, key: K, value: V): void {
  const set = index.get(key)
  if (set) set.add(value)
  else index.set(key, new Set([value]))
}

function removeFrom<K, V>(index: Map<K, Set<V>>, key: K, value: V): void {
  const set = index.get(key)
  if (!set) return
  set.delete(value)
  if (set.size === 0) index.delete(key)
}

// ---------------------------------------------------------------------------
// Cells: the hot path
// ---------------------------------------------------------------------------

// Gives `cell` to `room`. The cell must be unowned: rooms never overlap, so
// taking a cell from another room is two edits (`removeCell` then `addCell`),
// and making the caller spell that out keeps an absorbed room's own
// bookkeeping from going stale.
export function addCell(tx: Transaction, map: MapModel, room: Room, cell: CellKey): void {
  const existing = map.cellOwner.get(cell)
  if (existing !== undefined) {
    throw new ModelError(`cell ${cell} is already owned by ${existing}`)
  }
  tx.record({
    redo() {
      room.cells.add(cell)
      map.cellOwner.set(cell, room.id)
      bumpRoom(room, map)
    },
    undo() {
      room.cells.delete(cell)
      map.cellOwner.delete(cell)
      bumpRoom(room, map)
    },
  })
  tx.touched.cells.add(cell)
  tx.touched.rooms.add(room.id)
  tx.touched.maps.add(map.id)
}

export function removeCell(tx: Transaction, map: MapModel, room: Room, cell: CellKey): void {
  if (!room.cells.has(cell)) return
  tx.record({
    redo() {
      room.cells.delete(cell)
      map.cellOwner.delete(cell)
      bumpRoom(room, map)
    },
    undo() {
      room.cells.add(cell)
      map.cellOwner.set(cell, room.id)
      bumpRoom(room, map)
    },
  })
  tx.touched.cells.add(cell)
  tx.touched.rooms.add(room.id)
  tx.touched.maps.add(map.id)
}

// ---------------------------------------------------------------------------
// Inner walls
// ---------------------------------------------------------------------------

export function setInnerWall(
  tx: Transaction,
  map: MapModel,
  room: Room,
  edge: EdgeKey,
  style: WallStyle,
): void {
  const before = room.innerWalls.get(edge)
  if (before === style) return
  tx.record({
    redo() {
      room.innerWalls.set(edge, style)
      bumpRoom(room, map)
    },
    undo() {
      if (before === undefined) room.innerWalls.delete(edge)
      else room.innerWalls.set(edge, before)
      bumpRoom(room, map)
    },
  })
  tx.touched.rooms.add(room.id)
  tx.touched.maps.add(map.id)
}

export function removeInnerWall(tx: Transaction, map: MapModel, room: Room, edge: EdgeKey): void {
  const before = room.innerWalls.get(edge)
  if (before === undefined) return
  tx.record({
    redo() {
      room.innerWalls.delete(edge)
      bumpRoom(room, map)
    },
    undo() {
      room.innerWalls.set(edge, before)
      bumpRoom(room, map)
    },
  })
  tx.touched.rooms.add(room.id)
  tx.touched.maps.add(map.id)
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

// Adds a room object to a map. The room's cells are added separately, so a new
// room is always "created empty, then filled": that keeps cell ownership in
// exactly one place (addCell) instead of two.
export function putRoom(tx: Transaction, map: MapModel, room: Room, index?: number): void {
  const at = index ?? map.roomOrder.length
  tx.record({
    redo() {
      map.rooms.set(room.id, room)
      map.roomOrder.splice(at, 0, room.id)
      map.rev++
    },
    undo() {
      map.rooms.delete(room.id)
      map.roomOrder.splice(at, 1)
      map.rev++
    },
  })
  tx.touched.rooms.add(room.id)
  tx.touched.maps.add(map.id)
}

// Detaches an empty room. Callers remove its cells first (which is what makes
// those cells available to whoever is absorbing them); anything left in
// `cells` here would leave cellOwner pointing at a room that no longer exists.
export function removeRoom(tx: Transaction, map: MapModel, room: Room): void {
  if (room.cells.size > 0) {
    throw new ModelError(`room ${room.id} still owns ${room.cells.size} cells`)
  }
  const at = map.roomOrder.indexOf(room.id)
  if (at === -1) return
  tx.record({
    redo() {
      map.rooms.delete(room.id)
      map.roomOrder.splice(at, 1)
      map.rev++
    },
    undo() {
      map.rooms.set(room.id, room)
      map.roomOrder.splice(at, 0, room.id)
      map.rev++
    },
  })
  tx.touched.removedRooms.add(room.id)
  tx.touched.maps.add(map.id)
}

// Metadata only: name, notes, area. These bump metaRev, never rev, since
// nothing derived from the room's geometry changes. Bumping rev here would
// invalidate the memoised outer walls and edge runs on every keystroke of a
// rename.
export function setRoomField<K extends 'areaId' | 'name' | 'notes'>(
  tx: Transaction,
  map: MapModel,
  room: Room,
  key: K,
  value: Room[K],
): void {
  const before = room[key]
  if (before === value) return
  tx.record({
    redo() {
      room[key] = value
      bumpRoomMeta(room, map)
    },
    undo() {
      room[key] = before
      bumpRoomMeta(room, map)
    },
  })
  tx.touched.rooms.add(room.id)
  tx.touched.maps.add(map.id)
}

// Hierarchy drag-reorder. Purely cosmetic list order, but it persists.
export function moveRoomInOrder(
  tx: Transaction,
  map: MapModel,
  roomId: RoomId,
  toIndex: number,
): void {
  const from = map.roomOrder.indexOf(roomId)
  if (from === -1 || from === toIndex) return
  tx.record({
    redo() {
      map.roomOrder.splice(from, 1)
      map.roomOrder.splice(toIndex, 0, roomId)
      map.rev++
    },
    undo() {
      map.roomOrder.splice(toIndex, 1)
      map.roomOrder.splice(from, 0, roomId)
      map.rev++
    },
  })
  tx.touched.rooms.add(roomId)
  tx.touched.maps.add(map.id)
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

// Where a transition is anchored within one map: the keys it occupies in that
// map's hit-testing indices. A cross-tab teleport contributes only its near
// endpoint here; its far end is registered in teleportFarEnds instead.
export function transitionAnchors(
  transition: Transition,
  mapId: MapId,
): { cells: CellKey[]; edges: EdgeKey[] } {
  switch (transition.kind) {
    case 'edge':
      return { cells: [], edges: transition.segments.map((segment) => segment.edge) }
    case 'elevator':
      // Indexed by EDGE, like a door. Door and elevator endpoints are anchored
      // to a cell edge, not the cell centre. The interior-vs-edge zone split
      // lets a teleport and an elevator end share a cell yet stay individually
      // selectable. Endpoints are the two facing edges, so each contributes the
      // edge on the side pointing at the other end.
      return { cells: [], edges: facingEdges(transition.a, transition.b) }
    case 'teleport': {
      const cells: CellKey[] = []
      if (transition.a.mapId === mapId) cells.push(transition.a.cell)
      if (transition.b.mapId === mapId) cells.push(transition.b.cell)
      return { cells, edges: [] }
    }
  }
}

// Where a cross-tab teleport's far end lands, or null when the transition
// lives entirely on one map.
export function farEndOf(
  transition: Transition,
): { mapId: MapId; cell: CellKey; ref: FarEndRef } | null {
  if (transition.kind !== 'teleport') return null
  if (transition.a.mapId === transition.b.mapId) return null
  return {
    mapId: transition.b.mapId,
    cell: transition.b.cell,
    ref: { transitionId: transition.id, originMapId: transition.a.mapId },
  }
}

export function putTransition(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  transition: Transition,
): void {
  const { cells, edges } = transitionAnchors(transition, map.id)
  const far = farEndOf(transition)
  // Captured before the change, so undo restores what was in the slot rather
  // than clearing it. Deleting on undo would wipe the entry a different
  // teleport owns, and because the ghost re-applies through this same path,
  // one pointer move could corrupt the index for good.
  const previousFar = far ? getFarEnd(project.teleportFarEnds, far.mapId, far.cell) : undefined

  tx.record({
    redo() {
      map.transitions.set(transition.id, transition)
      for (const cell of cells) addTo(map.transitionsAtCell, cell, transition.id)
      for (const edge of edges) addTo(map.transitionsAtEdge, edge, transition.id)
      if (far) setFarEnd(project.teleportFarEnds, far.mapId, far.cell, far.ref)
      map.rev++
    },
    undo() {
      map.transitions.delete(transition.id)
      for (const cell of cells) removeFrom(map.transitionsAtCell, cell, transition.id)
      for (const edge of edges) removeFrom(map.transitionsAtEdge, edge, transition.id)
      if (far) restoreFarEnd(project.teleportFarEnds, far.mapId, far.cell, previousFar)
      map.rev++
    },
  })
  tx.touched.transitions.add(transition.id)
  tx.touched.maps.add(map.id)
}

export function removeTransition(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  transition: Transition,
): void {
  if (!map.transitions.has(transition.id)) return
  const { cells, edges } = transitionAnchors(transition, map.id)
  const far = farEndOf(transition)
  const previousFar = far ? getFarEnd(project.teleportFarEnds, far.mapId, far.cell) : undefined

  tx.record({
    redo() {
      map.transitions.delete(transition.id)
      for (const cell of cells) removeFrom(map.transitionsAtCell, cell, transition.id)
      for (const edge of edges) removeFrom(map.transitionsAtEdge, edge, transition.id)
      // Only clear the slot if this transition is the one occupying it. A stale
      // entry belonging to another teleport must survive.
      if (far && previousFar?.transitionId === transition.id) {
        deleteFarEnd(project.teleportFarEnds, far.mapId, far.cell)
      }
      map.rev++
    },
    undo() {
      map.transitions.set(transition.id, transition)
      for (const cell of cells) addTo(map.transitionsAtCell, cell, transition.id)
      for (const edge of edges) addTo(map.transitionsAtEdge, edge, transition.id)
      if (far) restoreFarEnd(project.teleportFarEnds, far.mapId, far.cell, previousFar)
      map.rev++
    },
  })
  tx.touched.removedTransitions.add(transition.id)
  tx.touched.maps.add(map.id)
}

// Geometry changes (an N-wide door trimmed to its surviving segments, an
// endpoint riding along with a moved room) go through remove + put rather than
// an in-place edit, so the indices follow automatically.
export function replaceTransition(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  before: Transition,
  after: Transition,
): void {
  removeTransition(tx, project, map, before)
  putTransition(tx, project, map, after)
  // remove marks it as removed; it is not, it moved.
  tx.touched.removedTransitions.delete(after.id)
}

export function setTransitionField<K extends 'locks' | 'direction' | 'notes'>(
  tx: Transaction,
  map: MapModel,
  transition: Transition,
  key: K,
  value: Transition[K],
): void {
  const before = transition[key]
  if (before === value) return
  tx.record({
    redo() {
      transition[key] = value
      map.rev++
    },
    undo() {
      transition[key] = before
      map.rev++
    },
  })
  tx.touched.transitions.add(transition.id)
  tx.touched.maps.add(map.id)
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

export function putIcon(tx: Transaction, map: MapModel, icon: IconObject): void {
  const displaced = map.iconAtCell.get(icon.cell)
  if (displaced !== undefined && displaced !== icon.id) {
    throw new ModelError(`cell ${icon.cell} already holds icon ${displaced}`)
  }
  tx.record({
    redo() {
      map.icons.set(icon.id, icon)
      map.iconAtCell.set(icon.cell, icon.id)
      map.rev++
    },
    undo() {
      map.icons.delete(icon.id)
      map.iconAtCell.delete(icon.cell)
      map.rev++
    },
  })
  tx.touched.icons.add(icon.id)
  tx.touched.maps.add(map.id)
}

export function removeIcon(tx: Transaction, map: MapModel, icon: IconObject): void {
  if (!map.icons.has(icon.id)) return
  tx.record({
    redo() {
      map.icons.delete(icon.id)
      map.iconAtCell.delete(icon.cell)
      map.rev++
    },
    undo() {
      map.icons.set(icon.id, icon)
      map.iconAtCell.set(icon.cell, icon.id)
      map.rev++
    },
  })
  tx.touched.removedIcons.add(icon.id)
  tx.touched.maps.add(map.id)
}

// Icons are cell-anchored, so moving one is an index move as well as a field
// change: hence its own primitive rather than setIconField('cell', ...).
export function moveIcon(tx: Transaction, map: MapModel, icon: IconObject, to: CellKey): void {
  const from = icon.cell
  if (from === to) return
  const displaced = map.iconAtCell.get(to)
  if (displaced !== undefined && displaced !== icon.id) {
    throw new ModelError(`cell ${to} already holds icon ${displaced}`)
  }
  tx.record({
    redo() {
      map.iconAtCell.delete(from)
      map.iconAtCell.set(to, icon.id)
      icon.cell = to
      map.rev++
    },
    undo() {
      map.iconAtCell.delete(to)
      map.iconAtCell.set(from, icon.id)
      icon.cell = from
      map.rev++
    },
  })
  tx.touched.icons.add(icon.id)
  tx.touched.maps.add(map.id)
}

// Batch relocation, for icons riding along with a moved/rotated room. It has
// to be one atomic change rather than a loop of moveIcon: two icons swapping
// cells, or a shift by one where every icon lands on its neighbour's cell,
// would trip the one-icon-per-cell guard halfway through. Vacating the whole
// set before re-seating it is the only order that always works.
export function relocateIcons(
  tx: Transaction,
  map: MapModel,
  mapping: Map<CellKey, CellKey>,
): void {
  const moves: { icon: IconObject; from: CellKey; to: CellKey }[] = []
  for (const icon of map.icons.values()) {
    const to = mapping.get(icon.cell)
    if (to !== undefined && to !== icon.cell) moves.push({ icon, from: icon.cell, to })
  }
  if (moves.length === 0) return

  tx.record({
    redo() {
      for (const move of moves) map.iconAtCell.delete(move.from)
      for (const move of moves) {
        move.icon.cell = move.to
        map.iconAtCell.set(move.to, move.icon.id)
      }
      map.rev++
    },
    undo() {
      for (const move of moves) map.iconAtCell.delete(move.to)
      for (const move of moves) {
        move.icon.cell = move.from
        map.iconAtCell.set(move.from, move.icon.id)
      }
      map.rev++
    },
  })
  for (const move of moves) tx.touched.icons.add(move.icon.id)
  tx.touched.maps.add(map.id)
}

export function setIconField<
  K extends 'iconType' | 'plateColor' | 'glyphColor' | 'label' | 'notes',
>(tx: Transaction, map: MapModel, icon: IconObject, key: K, value: IconObject[K]): void {
  const before = icon[key]
  if (before === value) return
  tx.record({
    redo() {
      icon[key] = value
      map.rev++
    },
    undo() {
      icon[key] = before
      map.rev++
    },
  })
  tx.touched.icons.add(icon.id)
  tx.touched.maps.add(map.id)
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------
// Lines carry no index: they are an independent overlay with no room owner, so
// nothing queries them by cell during an edit. Hit-testing walks them.

export function putLine(tx: Transaction, map: MapModel, line: LineObject): void {
  tx.record({
    redo() {
      map.lines.set(line.id, line)
      map.rev++
    },
    undo() {
      map.lines.delete(line.id)
      map.rev++
    },
  })
  tx.touched.lines.add(line.id)
  tx.touched.maps.add(map.id)
}

export function removeLine(tx: Transaction, map: MapModel, line: LineObject): void {
  if (!map.lines.has(line.id)) return
  tx.record({
    redo() {
      map.lines.delete(line.id)
      map.rev++
    },
    undo() {
      map.lines.set(line.id, line)
      map.rev++
    },
  })
  tx.touched.removedLines.add(line.id)
  tx.touched.maps.add(map.id)
}

export function setLinePoints(
  tx: Transaction,
  map: MapModel,
  line: LineObject,
  points: CellKey[],
): void {
  const before = line.points
  tx.record({
    redo() {
      line.points = points
      map.rev++
    },
    undo() {
      line.points = before
      map.rev++
    },
  })
  tx.touched.lines.add(line.id)
  tx.touched.maps.add(map.id)
}

export function setLineField<K extends 'color' | 'arrowStart' | 'arrowEnd' | 'label' | 'notes'>(
  tx: Transaction,
  map: MapModel,
  line: LineObject,
  key: K,
  value: LineObject[K],
): void {
  const before = line[key]
  if (before === value) return
  tx.record({
    redo() {
      line[key] = value
      map.rev++
    },
    undo() {
      line[key] = before
      map.rev++
    },
  })
  tx.touched.lines.add(line.id)
  tx.touched.maps.add(map.id)
}

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

// The map list and everything at project scope bump structureRev rather than any
// map.rev: a tab reorder or an area recolour changes no map's content, so a
// cache keyed only on map revisions would never see it. Monotonic in both
// directions, same as the other counters.
function bumpStructure(project: ProjectModel): void {
  project.structureRev++
}

export function insertMap(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  index?: number,
): void {
  const at = index ?? project.maps.length
  tx.record({
    redo() {
      project.mapsById.set(map.id, map)
      project.maps.splice(at, 0, map.id)
      bumpStructure(project)
    },
    undo() {
      project.mapsById.delete(map.id)
      project.maps.splice(at, 1)
      bumpStructure(project)
    },
  })
  tx.touched.maps.add(map.id)
}

// Detaching a map keeps the whole MapModel object alive in the journal's
// closure, which is exactly what makes undo of a tab delete restore its full
// content rather than an empty tab. The cascaded cross-tab transitions are
// separate journal entries recorded by the op before this one.
export function detachMap(tx: Transaction, project: ProjectModel, map: MapModel): void {
  const at = project.maps.indexOf(map.id)
  if (at === -1) return
  tx.record({
    redo() {
      project.mapsById.delete(map.id)
      project.maps.splice(at, 1)
      bumpStructure(project)
    },
    undo() {
      project.mapsById.set(map.id, map)
      project.maps.splice(at, 0, map.id)
      bumpStructure(project)
    },
  })
  tx.touched.maps.add(map.id)
}

export function moveMap(
  tx: Transaction,
  project: ProjectModel,
  mapId: MapId,
  toIndex: number,
): void {
  const from = project.maps.indexOf(mapId)
  if (from === -1 || from === toIndex) return
  tx.record({
    redo() {
      project.maps.splice(from, 1)
      project.maps.splice(toIndex, 0, mapId)
      bumpStructure(project)
    },
    undo() {
      project.maps.splice(toIndex, 1)
      project.maps.splice(from, 0, mapId)
      bumpStructure(project)
    },
  })
  tx.touched.maps.add(mapId)
}

// A map's name is structure, not content: the tab bar renders {id, name} per
// map, so a mirror keyed on structureRev alone would never see a rename.
// Bumping only map.rev would force that mirror to depend on every map's rev,
// which means the tab bar re-evaluating on every paint stroke. notes is
// genuinely content and stays out of it.
export function setMapField<K extends 'name' | 'notes'>(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  key: K,
  value: MapModel[K],
): void {
  const before = map[key]
  if (before === value) return
  const structural = key === 'name'
  tx.record({
    redo() {
      map[key] = value
      map.rev++
      if (structural) project.structureRev++
    },
    undo() {
      map[key] = before
      map.rev++
      if (structural) project.structureRev++
    },
  })
  tx.touched.maps.add(map.id)
}

// ---------------------------------------------------------------------------
// Project scope: settings, areas, lock types
// ---------------------------------------------------------------------------

export function setProjectName(tx: Transaction, project: ProjectModel, name: string): void {
  const before = project.name
  if (before === name) return
  tx.record({
    redo() {
      project.name = name
      bumpStructure(project)
    },
    undo() {
      project.name = before
      bumpStructure(project)
    },
  })
}

export function setProjectSetting<K extends keyof ProjectSettings>(
  tx: Transaction,
  project: ProjectModel,
  key: K,
  value: ProjectSettings[K],
): void {
  const before = project.settings[key]
  if (before === value) return
  tx.record({
    redo() {
      project.settings[key] = value
      bumpStructure(project)
    },
    undo() {
      project.settings[key] = before
      bumpStructure(project)
    },
  })
}

export function putArea(tx: Transaction, project: ProjectModel, area: Area): void {
  tx.record({
    redo() {
      project.areas.set(area.id, area)
      bumpStructure(project)
    },
    undo() {
      project.areas.delete(area.id)
      bumpStructure(project)
    },
  })
}

// Map insertion order is the display order, so re-inserting a deleted area on
// undo has to put it back where it was rather than at the end.
export function removeArea(tx: Transaction, project: ProjectModel, areaId: AreaId): void {
  const area = project.areas.get(areaId)
  if (!area) return
  const order = [...project.areas.keys()]
  const at = order.indexOf(areaId)
  tx.record({
    redo() {
      project.areas.delete(areaId)
      bumpStructure(project)
    },
    undo() {
      reinsertAt(project.areas, areaId, area, at)
      bumpStructure(project)
    },
  })
}

// Takes the project only to bump structureRev. An area's colours are read by
// every map that has rooms in it, so a recolour has to invalidate broadly even
// though it touches no map's content.
export function setAreaField<K extends 'name' | 'cellColor' | 'wallColor' | 'notes'>(
  tx: Transaction,
  project: ProjectModel,
  area: Area,
  key: K,
  value: Area[K],
): void {
  const before = area[key]
  if (before === value) return
  tx.record({
    redo() {
      area[key] = value
      bumpStructure(project)
    },
    undo() {
      area[key] = before
      bumpStructure(project)
    },
  })
}

export function putLockType(tx: Transaction, project: ProjectModel, lockType: LockType): void {
  tx.record({
    redo() {
      project.lockTypes.set(lockType.id, lockType)
      bumpStructure(project)
    },
    undo() {
      project.lockTypes.delete(lockType.id)
      bumpStructure(project)
    },
  })
}

export function removeLockType(
  tx: Transaction,
  project: ProjectModel,
  lockTypeId: LockTypeId,
): void {
  const lockType = project.lockTypes.get(lockTypeId)
  if (!lockType) return
  const at = [...project.lockTypes.keys()].indexOf(lockTypeId)
  tx.record({
    redo() {
      project.lockTypes.delete(lockTypeId)
      bumpStructure(project)
    },
    undo() {
      reinsertAt(project.lockTypes, lockTypeId, lockType, at)
      bumpStructure(project)
    },
  })
}

export function setLockTypeField<K extends 'name' | 'color' | 'glyph'>(
  tx: Transaction,
  project: ProjectModel,
  lockType: LockType,
  key: K,
  value: LockType[K],
): void {
  const before = lockType[key]
  if (before === value) return
  tx.record({
    redo() {
      lockType[key] = value
      bumpStructure(project)
    },
    undo() {
      lockType[key] = before
      bumpStructure(project)
    },
  })
}

// A JS Map has no insert-at-index, so restoring one to its old position means
// replaying the tail. Areas and lock types number in the dozens at most, and
// this only runs on undo of a delete.
function reinsertAt<K, V>(map: Map<K, V>, key: K, value: V, index: number): void {
  const entries = [...map.entries()]
  entries.splice(index, 0, [key, value])
  map.clear()
  for (const [k, v] of entries) map.set(k, v)
}

// Re-exported so ops can reason about where a transition is anchored without
// reaching past this module.
export { edgeCells, parseCell }
export type { RoomId, IconId, LineId, TransitionId, AreaId, LockTypeId, MapId }
