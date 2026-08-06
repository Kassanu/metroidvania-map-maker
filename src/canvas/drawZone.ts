// Which zone of a room is under the pointer.
//
// Three rules:
//
//   1. The pointer's own cell decides the room, and every test runs against
//      that cell's own edges and corners. A band never reaches out of its
//      cell, so standing just outside a wall is empty grid: otherwise painting
//      a room flush against an existing one would start a resize.
//   2. 0-D before 1-D before 2-D: a point beats a line beats an area. A vertex
//      disc and an edge band can overlap without either naturally being on
//      top, so the order needs stating; it matches `hitTest`'s rule one
//      dimension down. Within the 1-D class the nearest edge wins.
//   3. A length-1 face has no handle and resolves as interior, from consulting
//      `resizableRuns` rather than `edgeRuns`.
//
// Deliberately not `hitTest`: that resolver answers "which object is under the
// pointer" with an `ObjectRef`; walls and vertices have none and are edited by
// gestures against geometry instead. The two share only the grab band.
//
// Every tolerance here is in screen pixels, like `hitTest`: a target you have
// to aim at should be the same size under the pointer at every zoom.

import { screenToWorld, type ScreenPoint } from './viewport'
import { grabBand } from './hitTest'
import type { Camera } from './camera'
import { SIDES, cellKey, edgeOfCell, segmentFromEdge } from '@/core/cell'
import { isWallVertex, resizableRuns } from '@/core/derive/walls'
import type { CellKey, EdgeKey } from '@/core/cell'
import type { EdgeRun } from '@/core/derive/walls'
import type { RoomId } from '@/core/ids'
import type { MapModel, Room } from '@/core/types'

// A vertex is a point target where a wall is a line target, and a point is
// harder to hit, so it earns a larger tolerance than the band. Derived from
// the band rather than picked, so the two stay in proportion if the band is
// ever retuned.
export const VERTEX_RADIUS_FACTOR = 1.5

// Ceilings on both tolerances, as a fraction of the drawn cell. Load-bearing:
// MIN_ZOOM is 0.1, so at tileSize 32 a cell is 3.2px on screen while the
// unclamped band is 4.5px. Without the ceiling, every point in every cell
// would be within band of some edge, and `interior` (the zone that sets the
// active room, paints, grows and merges) would never resolve at all.
//
// A quarter-cell band leaves the middle half of the cell interior at every
// zoom: zoomed far out you want broad strokes, not precision resizing.
export const MAX_BAND_FRACTION = 0.25
export const MAX_VERTEX_FRACTION = 0.25

export interface Vertex {
  x: number
  y: number
}

export interface ZoneScene {
  map: MapModel
  camera: Camera
  tileSize: number
}

// Always answerable: the grid is unbounded, so there is no "off the grid",
// only cells with nothing in them. `empty` is a zone, not a failure, which is
// why nothing here returns null.
export type DrawZone =
  | { kind: 'empty'; cell: CellKey }
  | { kind: 'interior'; cell: CellKey; roomId: RoomId }
  | { kind: 'edgeRun'; cell: CellKey; roomId: RoomId; run: EdgeRun }
  | { kind: 'vertex'; cell: CellKey; roomId: RoomId; vertex: Vertex }
  | { kind: 'innerWall'; cell: CellKey; roomId: RoomId; edge: EdgeKey }

// The tolerances, resolved for a camera. Exported because handle rendering has
// to draw handles at exactly the size this grabs them at: build them against
// anything else and the handle disagrees with the thing it grabs.
export interface ZoneTolerances {
  band: number
  vertexRadius: number
}

export function zoneTolerances(scene: Pick<ZoneScene, 'camera' | 'tileSize'>): ZoneTolerances {
  const cellPx = scene.tileSize * scene.camera.zoom
  const raw = grabBand(scene)
  return {
    band: Math.min(raw, cellPx * MAX_BAND_FRACTION),
    vertexRadius: Math.min(raw * VERTEX_RADIUS_FACTOR, cellPx * MAX_VERTEX_FRACTION),
  }
}

export function resolveZone(point: ScreenPoint, scene: ZoneScene): DrawZone {
  const world = screenToWorld(point.x, point.y, scene.camera, scene.tileSize)
  const cellX = Math.floor(world.x)
  const cellY = Math.floor(world.y)
  const cell = cellKey(cellX, cellY)

  // Rule 1: the cell decides the room. No room, no zones, and no reaching into
  // a neighbour's.
  const roomId = scene.map.cellOwner.get(cell)
  if (roomId === undefined) return { kind: 'empty', cell }
  const room = scene.map.rooms.get(roomId)
  if (!room) return { kind: 'empty', cell }

  const { band, vertexRadius } = zoneTolerances(scene)
  const base = { cell, roomId }

  // Rule 2, 0-D: a vertex beats everything, including a resizable run it sits
  // on. Two cases need it. An inner wall runs between vertices and so is in
  // band wherever a vertex is, which would make the targets walls are drawn
  // from unreachable at their own ends. And a wall vertex on the outer
  // boundary sits in the middle of a run: yielding to the run there would put
  // a wall out of reach in any room with no interior vertex, which is every
  // room one cell thick.
  //
  // The run keeps the middle half of each of its cells, since the vertex
  // radius is clamped to a quarter of the drawn cell at both ends.
  const vertex = nearestVertex(point, cellX, cellY, room, scene, vertexRadius)
  if (vertex) return { ...base, kind: 'vertex', vertex }

  // Rule 2, 1-D: nearest candidate edge wins, and only this cell's own edges
  // are eligible. Ties favour the inner wall: see `nearestEdgeZone`.
  const found = nearestEdgeZone(point, cell, room, scene, band)
  if (found?.inner) return { ...base, kind: 'innerWall', edge: found.edge }
  if (found) return { ...base, kind: 'edgeRun', run: found.run }

  return { ...base, kind: 'interior' }
}

// The nearest of the pointer cell's four corners that is a wall vertex, within
// the radius. Four tests rather than a search: only corners of this cell can be
// in range, because the radius is clamped below half a cell.
//
// A wall vertex on the room's outer boundary is reachable only from inside the
// room, because rule 1 bounds every test by the pointer's own cell. Standing
// just outside the wall is empty grid, exactly as it is for a resize handle.
function nearestVertex(
  point: ScreenPoint,
  cellX: number,
  cellY: number,
  room: Room,
  scene: ZoneScene,
  radius: number,
): Vertex | null {
  const corners: Vertex[] = [
    { x: cellX, y: cellY },
    { x: cellX + 1, y: cellY },
    { x: cellX, y: cellY + 1 },
    { x: cellX + 1, y: cellY + 1 },
  ]

  let best: Vertex | null = null
  let bestDistance = radius
  for (const corner of corners) {
    if (!isWallVertex(room, corner.x, corner.y)) continue
    const at = worldToScreenPoint(corner.x, corner.y, scene)
    const distance = Math.hypot(point.x - at.x, point.y - at.y)
    // `<=` so that an exact tie between two corners resolves to the later one
    // in the fixed order above rather than to neither. Ties are measure-zero;
    // resolving them consistently is the point.
    if (distance <= bestDistance) {
      best = corner
      bestDistance = distance
    }
  }
  return best
}

// What a cell's four edges can resolve to. An edge that is neither a drawn
// inner wall nor part of a resizable run is not one of these at all.
type EdgeZone = { edge: EdgeKey; inner: true } | { edge: EdgeKey; inner: false; run: EdgeRun }

// The nearest of the cell's four edges within the band, considering only
// edges that are candidates.
//
// A non-candidate must not compete: the edge between two cells of the same
// room carries no wall and no handle, so nothing happens there. Filtering it
// out before the distance comparison keeps it from shadowing a real target
// that happens to be slightly further away.
//
// Ties between two genuine candidates go to an inner wall: inner walls are
// stroked after outer ones, and hit-testing's rule 2 is that whatever is drawn
// last is hit first.
function nearestEdgeZone(
  point: ScreenPoint,
  cell: CellKey,
  room: Room,
  scene: ZoneScene,
  band: number,
): EdgeZone | null {
  let best: EdgeZone | null = null
  let bestDistance = Infinity

  for (const side of SIDES) {
    const edge = edgeOfCell(cell, side)

    const inner = room.innerWalls.has(edge)
    // Rule 3: `resizableRuns`, not `edgeRuns`. A length-1 face has no handle,
    // so it is not a candidate and the cell falls through to interior.
    const run = inner ? null : runContaining(room, edge)
    if (!inner && !run) continue

    const distance = distanceToEdge(point, edge, scene)
    if (distance > band) continue

    const tiedButDrawnOnTop = distance === bestDistance && inner && best !== null && !best.inner
    if (distance < bestDistance || tiedButDrawnOnTop) {
      best = inner ? { edge, inner: true } : { edge, inner: false, run: run! }
      bestDistance = distance
    }
  }
  return best
}

function runContaining(room: Room, edge: EdgeKey): EdgeRun | null {
  for (const run of resizableRuns(room)) {
    if (run.edges.includes(edge)) return run
  }
  return null
}

function worldToScreenPoint(x: number, y: number, scene: ZoneScene): ScreenPoint {
  const scale = scene.tileSize * scene.camera.zoom
  return {
    x: (x - scene.camera.pan.x) * scale,
    y: (y - scene.camera.pan.y) * scale,
  }
}

function distanceToEdge(point: ScreenPoint, edge: EdgeKey, scene: ZoneScene): number {
  const [[ax, ay], [bx, by]] = segmentFromEdge(edge)
  return distanceToSegment(
    point,
    worldToScreenPoint(ax, ay, scene),
    worldToScreenPoint(bx, by, scene),
  )
}

// Perpendicular distance to a segment, clamped to its ends so the region is a
// capsule rather than an infinite strip. Same shape as `hitTest`'s; kept local
// because exporting it would make two subsystems share a helper they only
// coincidentally agree on, where the band is the genuine shared contract.
function distanceToSegment(point: ScreenPoint, from: ScreenPoint, to: ScreenPoint): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y)

  const t = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
  )
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy))
}
