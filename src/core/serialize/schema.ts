// The on-disk shape of a `.mvm` file, as types.
//
// This is deliberately NOT the runtime shape. The file is flat ordered arrays
// with short stable ids, because that is compact, diffable and obvious to read;
// the runtime is keyed Maps plus indices, because that is fast. index.ts is
// the only place the two meet.
//
// Two extensions to the schema:
//   * `settings` carries `backgroundColor`, `gridColor`, and `gridInExports`.
//   * Edge door segments carry `aSide` to name which boundary cell owns `locks.a`.

export const FILE_FORMAT = 'metroidvania-map-maker'
// Bumped to 2 when `oneWay: boolean` became `direction`. A replaced field, not
// an added one: a v1 file's one-way transitions would otherwise load two-way,
// which loses data silently rather than loudly.
export const FILE_VERSION = 2

export type JsonCell = [number, number]
export type JsonVertexSegment = [[number, number], [number, number]]
export type JsonSide = 'N' | 'E' | 'S' | 'W'

export interface JsonSettings {
  tileSize: number
  backgroundColor?: string | null
  gridColor?: string | null
  gridInExports?: boolean
}

export interface JsonArea {
  id: string
  name: string
  cellColor?: string | null
  wallColor?: string | null
  notes?: string
}

export interface JsonLockType {
  id: string
  name: string
  color?: string | null
  glyph?: string | null
}

export interface JsonInnerWall {
  seg: JsonVertexSegment
  style: 'solid' | 'dotted' | 'doorway'
}

export interface JsonRoom {
  id: string
  areaId: string
  name?: string
  notes?: string
  cells: JsonCell[]
  innerWalls?: JsonInnerWall[]
}

// Edge doors persist as cell + side. The runtime's canonical edge key is
// recovered from the pair.
export interface JsonDoorSegment {
  cell: JsonCell
  side: JsonSide
  aSide?: 'lo' | 'hi'
}

export type JsonGeometry =
  | { segments: JsonDoorSegment[] }
  | { a: JsonCell; b: JsonCell; axis: 'h' | 'v' }
  | { a: { mapId: string; cell: JsonCell }; b: { mapId: string; cell: JsonCell } }

export interface JsonTransition {
  id: string
  type: 'edge' | 'elevator' | 'teleport'
  locks: { a: string; b: string }
  notes?: string
  // Omitted means two-way, which is what most transitions are. Replaced v1's
  // `oneWay: boolean`, which could not express a reversed one-way.
  direction?: 'both' | 'aToB' | 'bToA'
  geometry: JsonGeometry
}

export interface JsonIcon {
  id: string
  iconType: string
  cell: JsonCell
  plateColor?: string
  glyphColor?: string
  label?: string
  notes?: string
}

export interface JsonLine {
  id: string
  color: string
  points: JsonCell[]
  arrowStart?: boolean
  arrowEnd?: boolean
  label?: string
  notes?: string
}

export interface JsonMap {
  id: string
  name: string
  notes?: string
  rooms: JsonRoom[]
  transitions: JsonTransition[]
  icons: JsonIcon[]
  lines: JsonLine[]
}

export interface JsonProject {
  name: string
  settings: JsonSettings
  lockTypes: JsonLockType[]
  areas: JsonArea[]
  // In tab order.
  maps: JsonMap[]
}

export interface JsonFile {
  format: typeof FILE_FORMAT
  version: number
  project: JsonProject
}
