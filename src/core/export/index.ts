// Model in, export objects out. The half of the game-friendly export that
// needs no UI and touches no disk.
//
// This is where the model's three internal conventions are translated, and
// each one is a place a silent swap could hide:
//
//   * ownership is derived from cells, so a room's contents are found through
//     `cellOwner` rather than read off a stored id;
//   * an edge door names its ends `a`/`b` with an `aSide` of `lo`/`hi`, which
//     becomes a physical side of a named room here;
//   * outer walls are derived from adjacency and never stored, so they are
//     materialized into the same cell+side form as drawn inner walls.
//
// Nothing here validates. A subset export leaves references to rooms, areas
// and tabs outside it, on purpose: a reader ignores what it cannot resolve,
// which is what makes any subset exportable with no special handling.
//
// Pure and total: no failure mode, so no result type.

import { version as appVersion } from '../../../package.json'
import {
  SIDES,
  compareCells,
  edgeCells,
  edgeOfCell,
  facingEdges,
  neighborOn,
  parseCell,
  sideOfEdge,
} from '../cell'
import type { CellKey, EdgeKey, Side } from '../cell'
import { roomBounds } from '../derive/walls'
import { farEndsOnMap } from '../farEnds'
import type { LockTypeId, MapId, RoomId } from '../ids'
import type { Direction, MapModel, ProjectModel, Room, Transition } from '../types'
import { EXPORT_FORMAT_VERSION, GENERATOR_NAME } from './schema'
import type {
  CombinedExport,
  ExportArea,
  ExportCell,
  ExportDirection,
  ExportIcon,
  ExportLock,
  ExportRoom,
  ExportTransition,
  ExportTransitionEnd,
  ExportWall,
  RoomExport,
} from './schema'

// Which rooms to export, per tab. A tab absent from the map contributes
// nothing; omitting the scope entirely exports the whole project.
export type ExportScope = ReadonlyMap<MapId, ReadonlySet<RoomId>>

export function toCombinedExport(project: ProjectModel, scope?: ExportScope): CombinedExport {
  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    generator: generator(),
    project: { name: project.name },
    tabs: selectedTabs(project, scope).map(({ map, rooms }) => ({
      id: map.id,
      name: map.name,
      notes: map.notes,
      rooms: rooms.map((room) => buildRoom(project, map, room)),
    })),
  }
}

// One envelope per room, in the same order the combined packaging lists them.
// The room objects are built by the same code, so a room is byte-identical
// either way.
export function toRoomExports(project: ProjectModel, scope?: ExportScope): RoomExport[] {
  const files: RoomExport[] = []
  for (const { map, rooms } of selectedTabs(project, scope)) {
    for (const room of rooms) {
      files.push({
        formatVersion: EXPORT_FORMAT_VERSION,
        generator: generator(),
        project: { name: project.name },
        tab: { id: map.id, name: map.name, notes: map.notes },
        room: buildRoom(project, map, room),
      })
    }
  }
  return files
}

function generator() {
  return { name: GENERATOR_NAME, version: appVersion }
}

// Tabs in tab order, rooms in Hierarchy order, both filtered by the scope. A
// tab with no rooms left is dropped rather than written out empty.
function selectedTabs(
  project: ProjectModel,
  scope: ExportScope | undefined,
): { map: MapModel; rooms: Room[] }[] {
  const tabs: { map: MapModel; rooms: Room[] }[] = []
  for (const mapId of project.maps) {
    const map = project.mapsById.get(mapId)!
    const selected = scope?.get(mapId)
    if (scope && !selected) continue
    const rooms = map.roomOrder
      .map((roomId) => map.rooms.get(roomId)!)
      .filter((room) => !selected || selected.has(room.id))
    if (rooms.length > 0) tabs.push({ map, rooms })
  }
  return tabs
}

function buildRoom(project: ProjectModel, map: MapModel, room: Room): ExportRoom {
  const cells = [...room.cells].sort(compareCells)
  const box = roomBounds(room)!
  return {
    id: room.id,
    name: room.name,
    notes: room.notes,
    area: buildArea(project, room),
    cells: cells.map(toExportCell),
    bounds: {
      min: [box.minCol, box.minRow],
      max: [box.maxCol, box.maxRow],
      size: [box.maxCol - box.minCol + 1, box.maxRow - box.minRow + 1],
    },
    walls: buildWalls(map, room, cells),
    transitions: buildTransitions(project, map, room),
    icons: buildIcons(map, room),
  }
}

function toExportCell(key: CellKey): ExportCell {
  const { x, y } = parseCell(key)
  return [x, y]
}

// Inlined whole rather than referenced into a project-level table. Every room
// has exactly one area and it is always resolvable: deleting an area reassigns
// its rooms to World.
function buildArea(project: ProjectModel, room: Room): ExportArea {
  const area = project.areas.get(room.areaId)!
  return {
    id: area.id,
    name: area.name,
    cellColor: area.cellColor,
    wallColor: area.wallColor,
    notes: area.notes,
  }
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

// Every wall of the room in one coordinate system, so the reader's loop is the
// obvious one: for each cell, for each of four sides, is there a wall.
//
// An inner wall appears twice, once from each of the two cells it separates,
// since both are in the room. An outer wall appears once, from the only cell
// that has it. An edge carrying a transition carries no wall, so a reader
// cannot build a wall across a doorway.
function buildWalls(map: MapModel, room: Room, cells: CellKey[]): ExportWall[] {
  const walls: ExportWall[] = []
  for (const cell of cells) {
    for (const side of SIDES) {
      const edge = edgeOfCell(cell, side)
      if (hasTransition(map, edge)) continue
      const inner = room.innerWalls.get(edge)
      if (inner) {
        walls.push({ cell: toExportCell(cell), side, boundary: 'inner', style: inner })
      } else if (!room.cells.has(neighborOn(cell, side))) {
        // Outer walls are derived from adjacency and the user can never draw
        // one, so there is no style to carry: they are always solid.
        walls.push({ cell: toExportCell(cell), side, boundary: 'outer', style: 'solid' })
      }
    }
  }
  return walls
}

// Doors and elevator endpoints anchor to edges; teleports anchor to cells, so
// they suppress nothing. A teleport sits in a cell rather than on an edge, and
// the room's outline around it is real.
function hasTransition(map: MapModel, edge: EdgeKey): boolean {
  const at = map.transitionsAtEdge.get(edge)
  return at !== undefined && at.size > 0
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

// Every transition with an end in this room, stated from this room.
//
// Two sources, because a cross-tab teleport is stored once under its origin
// tab: the transitions anchored in this map, then the far ends arriving from
// another one. A room on the destination tab is invisible to the first source
// and would silently lose its links.
function buildTransitions(project: ProjectModel, map: MapModel, room: Room): ExportTransition[] {
  const out: ExportTransition[] = []

  for (const transition of map.transitions.values()) {
    const built = buildTransition(project, map, room, transition)
    if (built) out.push(built)
  }

  // Landing cell order, so the arrivals are in a stable order of their own
  // rather than in whatever order the index happens to hold them.
  const arrivals = [...farEndsOnMap(project.teleportFarEnds, map.id)]
    .filter(([cell]) => map.cellOwner.get(cell) === room.id)
    .sort(([a], [b]) => compareCells(a, b))
  for (const [, ref] of arrivals) {
    const origin = project.mapsById.get(ref.originMapId)!
    const transition = origin.transitions.get(ref.transitionId)!
    const built = buildTransition(project, map, room, transition)
    if (built) out.push(built)
  }

  return out
}

function buildTransition(
  project: ProjectModel,
  map: MapModel,
  room: Room,
  transition: Transition,
): ExportTransition | null {
  const ends = resolveEnds(project, map, room, transition)
  if (!ends) return null
  const { near, far, nearIsA } = ends
  return {
    id: transition.id,
    kind: transition.kind,
    direction: directionFrom(transition.direction, nearIsA),
    ...(transition.kind === 'elevator' ? { axis: transition.axis } : {}),
    notes: transition.notes,
    from: buildEnd(project, near, nearIsA ? transition.locks.a : transition.locks.b),
    to: buildEnd(project, far, nearIsA ? transition.locks.b : transition.locks.a),
  }
}

// The model states direction against the A end; the export states it against
// `from`. When this room is the B end the two swap, so a one-way read straight
// off the model would point backwards in half the room objects.
function directionFrom(direction: Direction, nearIsA: boolean): ExportDirection {
  if (direction === 'both') return 'both'
  const away = direction === 'aToB' ? nearIsA : !nearIsA
  return away ? 'fromTo' : 'toFrom'
}

// One end before its lock is attached: which tab and room it is on, which
// cells it occupies there, and which way it faces.
interface EndCells {
  mapId: MapId
  roomId: RoomId
  cells: CellKey[]
  side?: Side
}

function buildEnd(project: ProjectModel, end: EndCells, lockId: LockTypeId): ExportTransitionEnd {
  return {
    tab: end.mapId,
    room: end.roomId,
    cells: end.cells.map(toExportCell),
    ...(end.side ? { side: end.side } : {}),
    lock: buildLock(project, lockId),
  }
}

// Inlined whole, like the area. Always resolvable: a deleted lock type
// reassigns its ends to Open.
function buildLock(project: ProjectModel, lockId: LockTypeId): ExportLock {
  const lock = project.lockTypes.get(lockId)!
  return { id: lock.id, name: lock.name, color: lock.color, glyph: lock.glyph }
}

// Splits a transition into the end in this room and the end elsewhere, or null
// when it does not touch this room. `nearIsA` is what the per-end locks and
// the direction are then read through.
function resolveEnds(
  project: ProjectModel,
  map: MapModel,
  room: Room,
  transition: Transition,
): { near: EndCells; far: EndCells; nearIsA: boolean } | null {
  switch (transition.kind) {
    case 'edge': {
      const near: CellKey[] = []
      const far: CellKey[] = []
      let nearIsA = false
      let nearSide: Side | undefined
      let farSide: Side | undefined
      let farRoom: RoomId | undefined

      for (const segment of transition.segments) {
        const { lo, hi } = edgeCells(segment.edge)
        const mineIsLo = map.cellOwner.get(lo) === room.id
        if (!mineIsLo && map.cellOwner.get(hi) !== room.id) continue
        const mine = mineIsLo ? lo : hi
        const theirs = mineIsLo ? hi : lo
        near.push(mine)
        far.push(theirs)
        nearIsA = segment.aSide === (mineIsLo ? 'lo' : 'hi')
        // One side per end, not per segment. Every segment of one door joins
        // the same two rooms, and two orthogonally connected rooms cannot swap
        // sides along a run without their cells crossing, so the sides are
        // constant and the first segment answers for all of them.
        nearSide ??= sideOfEdge(segment.edge, mine)!
        farSide ??= sideOfEdge(segment.edge, theirs)!
        farRoom ??= map.cellOwner.get(theirs)!
      }

      if (near.length === 0) return null
      return {
        near: { mapId: map.id, roomId: room.id, cells: near, side: nearSide },
        far: { mapId: map.id, roomId: farRoom!, cells: far, side: farSide },
        nearIsA,
      }
    }

    case 'elevator': {
      const nearIsA = map.cellOwner.get(transition.a) === room.id
      if (!nearIsA && map.cellOwner.get(transition.b) !== room.id) return null
      const mine = nearIsA ? transition.a : transition.b
      const theirs = nearIsA ? transition.b : transition.a
      // The two facing edges across the gap: the side of each cell pointing at
      // the other.
      const [mineEdge, theirsEdge] = facingEdges(mine, theirs)
      return {
        near: {
          mapId: map.id,
          roomId: room.id,
          cells: [mine],
          side: sideOfEdge(mineEdge, mine)!,
        },
        far: {
          mapId: map.id,
          roomId: map.cellOwner.get(theirs)!,
          cells: [theirs],
          side: sideOfEdge(theirsEdge, theirs)!,
        },
        nearIsA,
      }
    }

    case 'teleport': {
      const aIsMine =
        transition.a.mapId === map.id && map.cellOwner.get(transition.a.cell) === room.id
      const bIsMine =
        transition.b.mapId === map.id && map.cellOwner.get(transition.b.cell) === room.id
      if (!aIsMine && !bIsMine) return null
      const mine = aIsMine ? transition.a : transition.b
      const theirs = aIsMine ? transition.b : transition.a
      const farMap = project.mapsById.get(theirs.mapId)!
      // No side: a teleport occupies a cell, not one of its edges.
      return {
        near: { mapId: mine.mapId, roomId: room.id, cells: [mine.cell] },
        far: {
          mapId: theirs.mapId,
          roomId: farMap.cellOwner.get(theirs.cell)!,
          cells: [theirs.cell],
        },
        nearIsA: aIsMine,
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

// Icons always sit inside a room, and ownership is the cell's owner. `type` is
// the library key as a plain string; what is in the library is not the model's
// business and it is not the export's either.
function buildIcons(map: MapModel, room: Room): ExportIcon[] {
  const icons: ExportIcon[] = []
  for (const icon of map.icons.values()) {
    if (map.cellOwner.get(icon.cell) !== room.id) continue
    icons.push({
      id: icon.id,
      type: icon.iconType,
      cell: toExportCell(icon.cell),
      label: icon.label,
      plateColor: icon.plateColor,
      glyphColor: icon.glyphColor,
      notes: icon.notes,
    })
  }
  return icons
}
