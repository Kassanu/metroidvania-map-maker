// The shape of a game-friendly export, as types.
//
// This is the map with every internal convention already resolved: the same
// data the `.mvm` holds, fully denormalized. Areas and lock types are inlined
// into every room that uses them, outer walls are materialized alongside drawn
// ones, and a transition is stated from each of the two rooms it joins rather
// than once in an abstract A/B order.
//
// One way out only. Nothing reads this back; `.mvm` is the only format the app
// opens. That asymmetry is what buys the compatibility promise below.
//
// Within a `formatVersion`, fields may be added and never renamed, removed, or
// given a new meaning. Anything else bumps the version.

export const EXPORT_FORMAT_VERSION = 1

// The app's own name, as a constant rather than a lookup into the message
// catalogue: a translated string would make the exported bytes depend on the
// language the user happens to be running in.
export const GENERATOR_NAME = 'Metroidvania Map Maker'

// [x, y] on the unbounded signed grid, absolute and never converted to
// room-local. +y is down.
export type ExportCell = [number, number]

export type ExportSide = 'N' | 'E' | 'S' | 'W'

// `outer` is the room's outline, derived from cell adjacency; `inner` is a wall
// the user drew inside it.
export type ExportBoundary = 'outer' | 'inner'

export type ExportWallStyle = 'solid' | 'dotted' | 'doorway'

// Stated against `from` rather than against the model's A end, so a room object
// never asks its reader to work out which end it is holding.
export type ExportDirection = 'both' | 'fromTo' | 'toFrom'

export type ExportTransitionKind = 'edge' | 'elevator' | 'teleport'

// A null colour means unset. The app resolves those against its theme; an
// export has no theme, and inventing a colour here would make the bytes depend
// on what the user was looking at.
export interface ExportArea {
  id: string
  name: string
  cellColor: string | null
  wallColor: string | null
  notes: string
}

export interface ExportLock {
  id: string
  name: string
  color: string | null
  glyph: string | null
}

export interface ExportWall {
  cell: ExportCell
  side: ExportSide
  boundary: ExportBoundary
  style: ExportWallStyle
}

// One end of a transition. `room` and `tab` may name things outside the export
// when a subset was exported; a reader ignores what it cannot resolve.
//
// `side` is absent on a teleport, which sits in a cell rather than on an edge.
export interface ExportTransitionEnd {
  tab: string
  room: string
  cells: ExportCell[]
  side?: ExportSide
  lock: ExportLock
}

// `from` is always the room whose object this appears in, so the same
// transition in the other room has the two ends swapped and `direction`
// restated. `axis` is present on elevators only.
export interface ExportTransition {
  id: string
  kind: ExportTransitionKind
  direction: ExportDirection
  axis?: 'h' | 'v'
  notes: string
  from: ExportTransitionEnd
  to: ExportTransitionEnd
}

export interface ExportIcon {
  id: string
  type: string
  cell: ExportCell
  label: string
  plateColor: string
  glyphColor: string
  notes: string
}

// Inclusive on both ends; `size` is the span, so a single cell is [1, 1].
// Derivable from `cells`, included because every reader computes it first.
export interface ExportBounds {
  min: ExportCell
  max: ExportCell
  size: ExportCell
}

// The unit of the format. Byte-identical whether it lands in a combined file or
// one of its own.
export interface ExportRoom {
  id: string
  name: string
  notes: string
  // Neither is a colour. Both change how the room's cells are painted, from
  // the colour its area already supplies, and the resolved result stays in the
  // app: its transform constants are an app-level preference, so exporting
  // them would make two people's export of one project differ in bytes. The
  // area's own `cellColor` is here, so a reader can apply its own transform.
  heated: boolean
  // Whole percent, 0-100, of the room's bounding box filled from the bottom.
  // The surface it derives is not exported: a reader holding this and `bounds`
  // computes the same line.
  liquidLevel: number
  area: ExportArea
  cells: ExportCell[]
  bounds: ExportBounds
  walls: ExportWall[]
  transitions: ExportTransition[]
  icons: ExportIcon[]
}

export interface ExportTab {
  id: string
  name: string
  notes: string
  rooms: ExportRoom[]
}

export interface ExportGenerator {
  name: string
  version: string
}

export interface ExportProject {
  name: string
}

export interface CombinedExport {
  formatVersion: number
  generator: ExportGenerator
  project: ExportProject
  tabs: ExportTab[]
}

// One room per file. Carries its tab's identity so a file stands alone.
export interface RoomExport {
  formatVersion: number
  generator: ExportGenerator
  project: ExportProject
  tab: Omit<ExportTab, 'rooms'>
  room: ExportRoom
}
