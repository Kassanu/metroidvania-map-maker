// The runtime data model. Plain TypeScript, deliberately outside Vue's
// reactivity: wrapping thousands of cells in reactive proxies wastes memory and
// tanks the render loop, and canvas drawing is imperative anyway. Vue learns
// about changes through a revision counter, never by observing these objects.
//
// The shape here is NOT the shape on disk. At runtime, the same data is keyed
// Maps plus indices for O(1) hit-testing and ownership queries. serialize/
// owns the conversion.
//
// Ownership is derived from cells, never stored. An icon knows only its cell;
// the room that owns it is whichever room contains that cell. Transitions anchor
// to cells and edges. That is what makes room move/split/merge carry their
// contents for free: there is no roomId anywhere to keep in sync.

import type { CellKey, EdgeKey } from './cell'
import type { FarEndIndex } from './farEnds'
import type { AreaId, IconId, LineId, LockTypeId, MapId, RoomId, TransitionId } from './ids'

// ---------------------------------------------------------------------------
// Project scope
// ---------------------------------------------------------------------------

export interface ProjectSettings {
  // Grid tile size in px. Purely visual; it never affects cell coordinates.
  // This is the real home of what viewport.ts currently calls CELL_SIZE.
  tileSize: number
  // Project-wide canvas colours, also the image exporter's defaults.
  // null means "follow the app theme", which is how a fresh project starts.
  // Unset = theme-derived; set = the user pinned a colour and it wins in both
  // light and dark.
  backgroundColor: string | null
  gridColor: string | null
  // Whether an exported image draws the grid. Named gridInExports to avoid
  // confusion with canvasView.showGrid, the View menu's grid toggle. This is
  // project state (serialised, undoable, dirties the file); the View toggle is a
  // per-user preference in localStorage that follows the user across every
  // project. Nothing syncs them.
  gridInExports: boolean
}

export interface Area {
  id: AreaId
  name: string
  // null means "resolve from the active theme". The immutable World area gets
  // its neutral fallback fill in both light and dark. Every user-created area
  // has concrete colours.
  cellColor: string | null
  wallColor: string | null
  notes: string
}

export interface LockType {
  id: LockTypeId
  name: string
  // Both optional. A colourless lock renders as a clean doorway gap, which is
  // exactly what the immutable `Open` type must always look like. The glyph is
  // a single character from a small curated Unicode set, so lock types stay
  // distinguishable without relying on colour.
  color: string | null
  glyph: string | null
}

export interface ProjectModel {
  name: string
  settings: ProjectSettings
  // Insertion-ordered: this is the order the settings dialog and the area
  // dropdown list them in, and the order they serialise in.
  areas: Map<AreaId, Area>
  lockTypes: Map<LockTypeId, LockType>
  // Tab order. The array is the authority; mapsById is the lookup.
  maps: MapId[]
  mapsById: Map<MapId, MapModel>

  // --- project-scope index
  // A cross-tab teleport is stored once, under its origin map. The destination
  // tab still needs to draw a marker, so this index answers "which teleport lands
  // on this cell of this map?" without scanning every map. Nested by map so both
  // that lookup and "every far end on this map" are O(1).
  teleportFarEnds: FarEndIndex

  // Bumped by every committed change. The Vue bridge watches this; the
  // serializer compares it when deciding what to re-derive.
  rev: number

  // Bumped by changes to the project's structure rather than a map's content:
  // settings, areas, lock types, and the map list itself. Those touch no
  // map.rev, so a cache keyed only on map revisions would never see an area
  // recolour or a tab reorder.
  structureRev: number
}

// ---------------------------------------------------------------------------
// Map scope (one tab)
// ---------------------------------------------------------------------------

export interface MapModel {
  id: MapId
  name: string
  notes: string

  rooms: Map<RoomId, Room>
  // Hierarchy display order. Reordering rooms within an area is cosmetic but it
  // persists; array order in the file carries it.
  roomOrder: RoomId[]
  transitions: Map<TransitionId, Transition>
  icons: Map<IconId, IconObject>
  lines: Map<LineId, LineObject>

  // --- indices, all derived, maintained by primitives.ts
  // Rooms never overlap, so a cell has at most one owner. Paint, erase, merge,
  // hit-testing and ownership questions go through cellOwner.
  cellOwner: Map<CellKey, RoomId>
  // One icon per cell, so a plain value, not a set.
  iconAtCell: Map<CellKey, IconId>
  // Teleport endpoints, hit by clicking a cell's interior.
  transitionsAtCell: Map<CellKey, Set<TransitionId>>
  // Edge doors and elevator endpoints, hit by clicking near an edge. A cell
  // has four edges and can host a transition on each, which is why this is
  // keyed by edge rather than by cell.
  transitionsAtEdge: Map<EdgeKey, Set<TransitionId>>

  // Bumped on any change to this map's content. Invalidates map-level derived
  // caches (bounds, area bounding boxes).
  rev: number
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export type WallStyle = 'solid' | 'dotted' | 'doorway'

export interface Room {
  id: RoomId
  // Exactly one area, always resolvable. Deleting an area reassigns its rooms
  // to World rather than leaving a dangling reference.
  areaId: AreaId
  name: string
  notes: string

  // The room *is* its cells. Orthogonally connected, non-overlapping with
  // every other room; both invariants are enforced by the ops, not the type.
  cells: Set<CellKey>
  // Stored walls are only the inner ones. Outer walls are derived from cell
  // adjacency on demand (derive/walls.ts) and are never persisted, because
  // the user can never draw or delete one directly.
  innerWalls: Map<EdgeKey, WallStyle>

  // Bumped on any geometry change: cells and inner walls. Invalidates this
  // room's derived cache (outer walls, edge runs, bounding box). Not bumped by
  // renames, notes edits, or area changes. Those alter nothing derive/walls
  // memoises. Metadata changes bump metaRev instead.
  rev: number

  // Bumped on name, notes and area changes. A panel showing a room's identity
  // watches this; nothing derived from geometry needs to.
  metaRev: number
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export type TransitionKind = 'edge' | 'elevator' | 'teleport'

// Per-end locks: A is the origin/from end, B the destination. Direction is
// encoded by endpoint order plus oneWay, so "B -> A" is stored as one-way with
// the endpoints swapped.
export interface TransitionCommon {
  id: TransitionId
  locks: { a: LockTypeId; b: LockTypeId }
  oneWay: boolean
  notes: string
}

// A cell on a specific map. Only teleports need the mapId (they are the one
// kind that can span tabs); the others are always within one map.
export interface MapCell {
  mapId: MapId
  cell: CellKey
}

// One boundary segment of an edge door. `aSide` says which of the edge's two
// canonical cells (see cell.ts edgeCells) is on room A's side, so per-end
// locks stay stable no matter which room the user dragged from.
export interface DoorSegment {
  edge: EdgeKey
  aSide: 'lo' | 'hi'
}

export interface EdgeTransition extends TransitionCommon {
  kind: 'edge'
  // One object may span several segments: an N-wide door. If a room edit breaks
  // it into disjoint runs they become separate objects.
  segments: DoorSegment[]
}

export interface ElevatorTransition extends TransitionCommon {
  kind: 'elevator'
  // The two facing cells across a gap, A first. Axis is which way the shaft
  // runs; endpoints snap to the facing edges at creation.
  a: CellKey
  b: CellKey
  axis: 'h' | 'v'
}

export interface TeleportTransition extends TransitionCommon {
  kind: 'teleport'
  // Cross-tab exactly when a.mapId !== b.mapId. Stored once, under the origin
  // map (= a.mapId); the far end's marker is rebuilt from teleportFarEnds.
  a: MapCell
  b: MapCell
}

export type Transition = EdgeTransition | ElevatorTransition | TeleportTransition

// ---------------------------------------------------------------------------
// Markup: icons and lines
// ---------------------------------------------------------------------------

export interface IconObject {
  id: IconId
  // Which library icon. Kept as a plain string key; the concrete v1 icon list
  // is a content task, and the model should not care what is in it.
  iconType: string
  // Must be inside a room. Ownership is derived: erase the cell and the icon
  // goes with it; move the room and it rides along.
  cell: CellKey
  label: string
  notes: string
}

export interface LineObject {
  id: LineId
  color: string
  // A simple two-ended polyline of unit steps, each to one of the 8 adjacent
  // cells. No branching, no graph: it can only be extended or peeled from its
  // two ends. Independent of rooms entirely; room edits never touch it.
  points: CellKey[]
  arrowStart: boolean
  arrowEnd: boolean
  label: string
  notes: string
}

// Anything selectable, as the selection set stores it. Kind plus id, so the
// chrome can hold a selection without holding model object references.
export type ObjectRef =
  | { kind: 'room'; id: RoomId }
  | { kind: 'area'; id: AreaId }
  | { kind: 'transition'; id: TransitionId }
  | { kind: 'icon'; id: IconId }
  | { kind: 'line'; id: LineId }
