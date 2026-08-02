// Shared fixtures for the core tests. Core is plain TS with no Vue, Pinia or
// DOM involvement, so these need nothing but the model itself.

import { cellKey, edgeCells, isAdjacent8, parseCell } from './cell'
import type { CellKey } from './cell'
import { connectedComponents } from './derive/connectivity'
import { createProject } from './factory'
import { History } from './history'
import { WORLD_AREA_ID } from './ids'
import type { RoomId } from './ids'
import { Transaction } from './journal'
import type { IconColors } from './ops/markup'
import { paintCells } from './ops/rooms'
import { isTransitionValid } from './ops/transitions'
import { wasRefused } from './outcome'
import type { Outcome, RefusalReason } from './outcome'
import { transitionAnchors } from './primitives'
import type { MapModel, ProjectModel, Room } from './types'

// English names live here rather than in the factory: core takes them as
// required parameters so it never holds a second copy of what i18n owns, and a
// test fixture is exactly the caller that should supply plain strings.
export const TEST_SEED = {
  projectName: 'Untitled Project',
  firstMapName: 'Map 1',
  worldAreaName: 'World',
  openLockName: 'Open',
  lockedLockName: 'Locked',
}

// Same idea for undo-step labels: `pushNavigation` takes one, because core
// holds no user-visible strings of its own. The app passes a translated string;
// tests pass this.
export const TEST_NAV_LABEL = 'Switch tab'

// Badge colours for tests that place an icon and do not care what it looks
// like. The app takes these from the icon registry, which core cannot see.
export const TEST_ICON_COLORS: IconColors = {
  plateColor: '#e0e0e0',
  glyphColor: '#202020',
}

export function setup() {
  const project = createProject(TEST_SEED)
  const map = project.mapsById.get(project.maps[0])!
  const history = new History(project)
  return { project, map, history }
}

export function tx(map?: MapModel): Transaction {
  return new Transaction('test', map ? { kind: 'map', mapId: map.id } : { kind: 'project' })
}

// Parses a compact ASCII grid into cell keys, so tests read like the diagrams
// in the specs. `#` marks a cell; the top-left character is (0,0).
//
//   grid(`
//     ##.
//     ##.
//     ###
//   `)
export function grid(art: string): CellKey[] {
  const rows = art
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.length > 0)
  const cells: CellKey[] = []
  rows.forEach((row, y) => {
    ;[...row].forEach((char, x) => {
      if (char === '#') cells.push(cellKey(x, y))
    })
  })
  return cells
}

export function rect(x0: number, y0: number, width: number, height: number): CellKey[] {
  const cells: CellKey[] = []
  for (let y = y0; y < y0 + height; y++) {
    for (let x = x0; x < x0 + width; x++) cells.push(cellKey(x, y))
  }
  return cells
}

// Paints a room and commits it, for tests that need a starting state rather
// than to exercise painting itself.
export function makeRoom(
  project: ProjectModel,
  map: MapModel,
  cells: CellKey[],
  intoRoomId?: RoomId,
): Room {
  const transaction = tx(map)
  const room = paintCells(transaction, project, map, cells, {
    areaId: WORLD_AREA_ID,
    intoRoomId,
  })
  transaction.commit()
  return room
}

// Unwraps an op that could have refused, failing the test loudly if it did.
// Tests that are *about* a refusal use `refusal()` instead, so the two read
// differently at a glance.
export function ok<T>(result: Outcome<T>): T {
  if (wasRefused(result)) {
    throw new Error(`expected success, got refusal: ${result.refused}`)
  }
  return result as T
}

// Asserts the op refused, and hands back the reason to compare against.
export function refusal<T>(result: Outcome<T>): RefusalReason {
  if (!wasRefused(result)) throw new Error('expected a refusal, got success')
  return result.refused
}

export function cellsOf(room: Room): CellKey[] {
  return [...room.cells].sort()
}

export function sorted(cells: Iterable<CellKey>): CellKey[] {
  return [...cells].sort()
}

// A complete structural fingerprint of the project: everything a rollback must
// restore.
//
// Covering only rooms, cells and transition ids is enough to pass "rolls back
// exactly" while doors survive with empty segments, teleport endpoints sit on
// the wrong map, or the far-end index loses an entry on undo. None of those
// change a room or a cell: they change transition geometry and the indices. If
// it is state, it belongs here.
export function snapshot(project: ProjectModel): unknown {
  return {
    name: project.name,
    settings: { ...project.settings },
    areas: [...project.areas.entries()].map(([id, area]) => [id, { ...area }]),
    lockTypes: [...project.lockTypes.entries()].map(([id, lock]) => [id, { ...lock }]),
    maps: [...project.maps],
    farEnds: [...project.teleportFarEnds.entries()]
      .map(([mapId, perMap]) => [mapId, [...perMap.entries()].sort()])
      .sort(),
    // Keyed off `mapsById`, not `project.maps`. Mapping the tab list would hide
    // a map leaked by a botched detach from every "rolls back exactly" test.
    content: [...project.mapsById.keys()]
      .sort()
      .map((mapId) => mapSnapshot(project.mapsById.get(mapId)!)),
  }
}

function mapSnapshot(map: MapModel): unknown {
  return {
    id: map.id,
    name: map.name,
    notes: map.notes,
    roomOrder: [...map.roomOrder],
    rooms: [...map.rooms.values()]
      .map((room) => ({
        id: room.id,
        areaId: room.areaId,
        name: room.name,
        notes: room.notes,
        cells: sorted(room.cells),
        innerWalls: [...room.innerWalls.entries()].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    // Full geometry, not just ids. An emptied door keeps its id.
    transitions: [...map.transitions.values()]
      .map((transition) => JSON.parse(JSON.stringify(transition)) as unknown)
      .sort((a, b) =>
        String((a as { id: string }).id).localeCompare(String((b as { id: string }).id)),
      ),
    icons: [...map.icons.values()].map((icon) => ({ ...icon })).sort(byId),
    lines: [...map.lines.values()]
      .map((line) => ({ ...line, points: [...line.points] }))
      .sort(byId),
    // The indices are state too, and they are where the subtle divergence hides.
    cellOwner: [...map.cellOwner.entries()].sort(),
    iconAtCell: [...map.iconAtCell.entries()].sort(),
    transitionsAtCell: indexSnapshot(map.transitionsAtCell),
    transitionsAtEdge: indexSnapshot(map.transitionsAtEdge),
  }
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id)
}

function indexSnapshot<K extends string>(index: Map<K, Set<string>>): [K, string[]][] {
  return [...index.entries()].map(([key, set]) => [key, [...set].sort()] as [K, string[]]).sort()
}

// Asserts the model's structural invariants. Anything that mutates the model
// should leave every one of these true: they are the contract `primitives.ts`
// exists to keep.
export function checkInvariants(project: ProjectModel): string[] {
  const problems: string[] = []

  // Project scope: the tab list and the lookup agree in both directions. A
  // one-way check misses a map leaked by a botched detach/undo (gone from the
  // tab bar but still holding rooms, transitions, and far-end entries).
  if (new Set(project.maps).size !== project.maps.length) {
    problems.push(`maps contains a duplicate id`)
  }
  const listed = new Set(project.maps)
  for (const mapId of project.mapsById.keys()) {
    if (!listed.has(mapId)) problems.push(`mapsById holds orphan map ${mapId}`)
  }
  for (const [key, map] of project.mapsById) {
    if (map.id !== key) problems.push(`mapsById key ${key} holds map ${map.id}`)
  }

  for (const mapId of project.maps) {
    const map = project.mapsById.get(mapId)
    if (!map) {
      problems.push(`maps lists ${mapId} but mapsById has no such map`)
      continue
    }

    // cellOwner is exactly the union of every room's cells.
    const owned = new Set<CellKey>()
    for (const [key, room] of map.rooms) {
      if (room.id !== key) problems.push(`rooms key ${key} holds room ${room.id}`)
      if (room.cells.size === 0) problems.push(`room ${room.id} has no cells`)
      // Every room resolves to a live area. Deleting an area reassigns rooms to
      // World rather than leaving this dangling, so a miss means the cascade
      // was skipped.
      if (!project.areas.has(room.areaId)) {
        problems.push(`room ${room.id} names missing area ${room.areaId}`)
      }
      if (connectedComponents(room.cells).length > 1) {
        problems.push(`room ${room.id} is not orthogonally connected`)
      }
      for (const cell of room.cells) {
        if (owned.has(cell)) problems.push(`cell ${cell} is owned by two rooms`)
        owned.add(cell)
        if (map.cellOwner.get(cell) !== room.id) {
          problems.push(`cellOwner[${cell}] disagrees with room ${room.id}`)
        }
      }
      for (const edge of room.innerWalls.keys()) {
        const { lo, hi } = edgeCells(edge)
        if (!room.cells.has(lo) || !room.cells.has(hi)) {
          problems.push(`room ${room.id} has a non-interior inner wall at ${edge}`)
        }
      }
    }
    for (const cell of map.cellOwner.keys()) {
      if (!owned.has(cell)) problems.push(`cellOwner has stale cell ${cell}`)
    }

    // roomOrder is a permutation of rooms.keys().
    if (map.roomOrder.length !== map.rooms.size) {
      problems.push(`roomOrder has ${map.roomOrder.length} ids for ${map.rooms.size} rooms`)
    }
    if (new Set(map.roomOrder).size !== map.roomOrder.length) {
      problems.push(`roomOrder contains a duplicate id`)
    }
    for (const roomId of map.roomOrder) {
      if (!map.rooms.has(roomId)) problems.push(`roomOrder names missing room ${roomId}`)
    }

    // Icons: one per cell, always on an owned cell, index in step.
    for (const icon of map.icons.values()) {
      if (!map.cellOwner.has(icon.cell)) problems.push(`icon ${icon.id} is not in a room`)
      if (map.iconAtCell.get(icon.cell) !== icon.id) {
        problems.push(`iconAtCell[${icon.cell}] disagrees with icon ${icon.id}`)
      }
    }
    for (const [cell, iconId] of map.iconAtCell) {
      if (map.icons.get(iconId)?.cell !== cell) {
        problems.push(`iconAtCell has stale entry at ${cell}`)
      }
    }

    // Lines: at least one segment, and every step lands on one of the eight
    // neighbours. A malformed polyline renders as a jump across the map.
    for (const [key, line] of map.lines) {
      if (line.id !== key) problems.push(`lines key ${key} holds line ${line.id}`)
      if (line.points.length < 2) {
        problems.push(`line ${line.id} has ${line.points.length} point(s), needs at least 2`)
        continue
      }
      for (let i = 1; i < line.points.length; i++) {
        if (!isAdjacent8(line.points[i - 1], line.points[i])) {
          problems.push(`line ${line.id} jumps from ${line.points[i - 1]} to ${line.points[i]}`)
        }
      }
    }

    // Transitions: every live one indexed, every index entry live, and no
    // transition left in an invalid state.
    for (const [key, transition] of map.transitions) {
      if (transition.id !== key) {
        problems.push(`transitions key ${key} holds transition ${transition.id}`)
      }
      if (transition.kind === 'edge' && transition.segments.length === 0) {
        problems.push(`edge transition ${transition.id} survived with no segments`)
      }
      if (!isTransitionValid(project, map, transition)) {
        problems.push(`transition ${transition.id} is live but invalid`)
      }
      // Both ends resolve to a live lock type. Deleting a type reassigns every
      // end using it to Open, so a dangling id means that pass was skipped.
      for (const end of ['a', 'b'] as const) {
        if (!project.lockTypes.has(transition.locks[end])) {
          problems.push(
            `transition ${transition.id} end ${end} names missing lock type ${transition.locks[end]}`,
          )
        }
      }
      // An edge door is one door between one pair of rooms. `classifyBox` groups
      // by room pair so this cannot arise from an edit. Re-validation after a
      // room edit is the path that can break it.
      if (transition.kind === 'edge' && transition.segments.length > 0) {
        const pairs = new Set(
          transition.segments.map((segment) => {
            const { lo, hi } = edgeCells(segment.edge)
            return [map.cellOwner.get(lo) ?? '∅', map.cellOwner.get(hi) ?? '∅'].sort().join('|')
          }),
        )
        if (pairs.size > 1) {
          problems.push(
            `edge transition ${transition.id} spans ${pairs.size} room pairs: ${[...pairs].join(', ')}`,
          )
        }
      }
      // An elevator's stored axis must match where its endpoints actually are.
      if (transition.kind === 'elevator') {
        const a = parseCell(transition.a)
        const b = parseCell(transition.b)
        const axis = a.y === b.y ? 'h' : a.x === b.x ? 'v' : null
        if (axis === null) {
          problems.push(`elevator ${transition.id} endpoints are not aligned on either axis`)
        } else if (axis !== transition.axis) {
          problems.push(`elevator ${transition.id} says axis ${transition.axis} but runs ${axis}`)
        }
      }

      const { cells, edges } = transitionAnchors(transition, map.id)
      for (const cell of cells) {
        if (!map.transitionsAtCell.get(cell)?.has(transition.id)) {
          problems.push(`transition ${transition.id} not indexed at cell ${cell}`)
        }
      }
      for (const edge of edges) {
        if (!map.transitionsAtEdge.get(edge)?.has(transition.id)) {
          problems.push(`transition ${transition.id} not indexed at edge ${edge}`)
        }
      }
    }

    // Reverse of the anchor check above: an index entry must name a transition
    // that genuinely anchors there. Asking only "does this id exist?" lets a
    // relocated endpoint stay indexed at the cell it used to occupy.
    for (const [cell, ids] of map.transitionsAtCell) {
      if (ids.size === 0) problems.push(`transitionsAtCell has an empty bucket at ${cell}`)
      let teleports = 0
      for (const id of ids) {
        const transition = map.transitions.get(id)
        if (!transition) {
          problems.push(`stale cell index ${cell} -> ${id}`)
          continue
        }
        if (!transitionAnchors(transition, map.id).cells.includes(cell)) {
          problems.push(`transition ${id} is indexed at cell ${cell} but not anchored there`)
        }
        if (transition.kind === 'teleport') teleports++
      }
      // At most one teleport endpoint per cell.
      if (teleports > 1) {
        problems.push(`cell ${cell} carries ${teleports} teleport endpoints`)
      }
    }
    for (const [edge, ids] of map.transitionsAtEdge) {
      if (ids.size === 0) problems.push(`transitionsAtEdge has an empty bucket at ${edge}`)
      for (const id of ids) {
        const transition = map.transitions.get(id)
        if (!transition) {
          problems.push(`stale edge index ${edge} -> ${id}`)
          continue
        }
        if (!transitionAnchors(transition, map.id).edges.includes(edge)) {
          problems.push(`transition ${id} is indexed at edge ${edge} but not anchored there`)
        }
      }
    }

    // Icons keyed by their own id.
    for (const [key, icon] of map.icons) {
      if (icon.id !== key) problems.push(`icons key ${key} holds icon ${icon.id}`)
    }
  }

  // Far ends resolve, and name a transition that really is a cross-map teleport
  // landing there.
  let farEnds = 0
  for (const [mapId, perMap] of project.teleportFarEnds) {
    if (perMap.size === 0) problems.push(`teleportFarEnds has an empty bucket for map ${mapId}`)
    for (const [cell, ref] of perMap) {
      farEnds++
      const origin = project.mapsById.get(ref.originMapId)
      const transition = origin?.transitions.get(ref.transitionId)
      if (!transition) {
        problems.push(`far end ${mapId}:${cell} names missing transition ${ref.transitionId}`)
        continue
      }
      if (
        transition.kind !== 'teleport' ||
        transition.b.mapId !== mapId ||
        transition.b.cell !== cell
      ) {
        problems.push(`far end ${mapId}:${cell} does not match transition ${ref.transitionId}`)
        continue
      }
      // A teleport is stored once, under its origin map. If the ref points at a
      // map other than `a.mapId`, the transition has been re-homed without the
      // index following, and the cascade can no longer reach it.
      if (transition.a.mapId !== ref.originMapId) {
        problems.push(
          `far end ${mapId}:${cell} says origin ${ref.originMapId} but the teleport starts on ${transition.a.mapId}`,
        )
      }
      // A same-map teleport has no far end to register.
      if (transition.a.mapId === transition.b.mapId) {
        problems.push(`far end ${mapId}:${cell} names same-map teleport ${transition.id}`)
      }
    }
  }

  // Reverse check plus count reconciliation. Without it, two entries claiming
  // one teleport (or one entry doing double duty) reads as clean from both
  // directions taken separately.
  let expected = 0
  for (const map of project.mapsById.values()) {
    for (const transition of map.transitions.values()) {
      if (transition.kind !== 'teleport') continue
      if (transition.a.mapId === transition.b.mapId) continue
      expected++
      const ref = project.teleportFarEnds.get(transition.b.mapId)?.get(transition.b.cell)
      if (ref?.transitionId !== transition.id) {
        problems.push(`cross-map teleport ${transition.id} is missing its far-end entry`)
      }
    }
  }
  if (farEnds !== expected) {
    problems.push(`teleportFarEnds holds ${farEnds} entries for ${expected} cross-map teleports`)
  }

  return problems
}
