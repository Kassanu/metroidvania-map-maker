// What is under the pointer.
//
// A hit region is what you can see, except the two in-cell markers (icon,
// teleport endpoint), which claim their whole cell. Ties break by paint order,
// topmost first, except that 1-D targets (lines, edge doors) are tested before
// 2-D ones: a grab band straddles two cells that both have a full area claim,
// and an edge door inside a room would otherwise be unreachable.
//
// Lives here rather than in `src/core/` because it needs the camera and the
// tile size, which are screen state the model has no business knowing; core
// stays selection-free.

import { screenToWorld, type ScreenPoint } from './viewport'
import { wallWidth } from './renderMap'
import type { Camera } from './camera'
import { cellKey, edgeCells, parseCell, segmentFromEdge } from '@/core/cell'
import type { CellKey, EdgeKey } from '@/core/cell'
import type { MapModel, ObjectRef, ProjectModel } from '@/core/types'
import { farEndsOnMap } from '@/core/farEnds'

// How far outside a 1-D target still counts as pointing at it, in screen px on
// top of half the drawn line. Touch will want more than a mouse; kept as one
// constant so it can become input-mode-dependent later without the geometry
// changing.
export const GRAB_MARGIN_PX = 4

export interface HitScene {
  project: ProjectModel
  map: MapModel
  camera: Camera
  tileSize: number
}

// The cell under a screen point. Always answerable: the grid is unbounded, so
// there is no "off the grid", only cells with nothing in them.
export function cellAt(point: ScreenPoint, camera: Camera, tileSize: number): CellKey {
  const world = screenToWorld(point.x, point.y, camera, tileSize)
  return cellKey(Math.floor(world.x), Math.floor(world.y))
}

// The topmost object at a screen point, or null on empty grid.
//
// A teleport's far end is a real target on the destination tab even though the
// transition is stored under its origin map. The id comes back either way;
// pass it through `resolveTransition` to get the transition and the map that
// actually holds it.
export function hitTest(point: ScreenPoint, scene: HitScene): ObjectRef | null {
  const band = grabBand(scene)

  // 1-D targets, topmost first.
  const line = lineAt(point, scene, band)
  if (line) return line

  const edge = edgeTransitionAt(point, scene, band)
  if (edge) return edge

  // 2-D targets, topmost first.
  const cell = cellAt(point, scene.camera, scene.tileSize)

  const iconId = scene.map.iconAtCell.get(cell)
  if (iconId !== undefined) return { kind: 'icon', id: iconId }

  const teleport = teleportAt(cell, scene)
  if (teleport) return teleport

  const roomId = scene.map.cellOwner.get(cell)
  if (roomId !== undefined) return { kind: 'room', id: roomId }

  return null
}

// The transition under a point, ignoring every other kind of object.
//
// Door mode's targets are transitions and room cells only, so this must not
// let an icon or line shadow the door underneath: `hitTest` answers the
// topmost object of any kind, which for a line drawn across a door is the
// line, right for selection but wrong for a mode that cannot select lines.
//
// Same helpers, same order, same band as `hitTest`'s own two transition
// steps, edge before interior. That order is what lets four edge-transitions
// and a teleport share one cell and stay individually reachable; writing it
// out twice is how the two would come to disagree.
export function transitionAt(point: ScreenPoint, scene: HitScene): ObjectRef | null {
  const edge = edgeTransitionAt(point, scene, grabBand(scene))
  if (edge) return edge
  return teleportAt(cellAt(point, scene.camera, scene.tileSize), scene)
}

// Derived from the drawn wall weight rather than chosen independently: a band
// narrower than the line it grabs is unusable, and two constants that are meant
// to agree but are written down twice will drift.
export function grabBand(scene: Pick<HitScene, 'camera'>): number {
  return wallWidth(scene.camera.zoom) / 2 + GRAB_MARGIN_PX
}

// Lines are drawn through cell centres, so that is where they are grabbed.
// Later lines win: they are painted later, so they are on top.
function lineAt(point: ScreenPoint, scene: HitScene, band: number): ObjectRef | null {
  let found: ObjectRef | null = null
  for (const line of scene.map.lines.values()) {
    for (let i = 1; i < line.points.length; i++) {
      const from = cellCentre(line.points[i - 1], scene)
      const to = cellCentre(line.points[i], scene)
      if (distanceToSegment(point, from, to) <= band) {
        found = { kind: 'line', id: line.id }
        break
      }
    }
  }
  return found
}

// Edge doors and elevator endpoints both hang off `transitionsAtEdge`, which is
// keyed by edge precisely because a cell has four of them and can host one on
// each.
function edgeTransitionAt(point: ScreenPoint, scene: HitScene, band: number): ObjectRef | null {
  const cell = cellAt(point, scene.camera, scene.tileSize)
  // Only the four edges of the cell under the pointer are considered.
  //
  // Exact while the band is under half a cell, but not always: at MIN_ZOOM
  // (0.1) a cell is 3.2px at tileSize 32 while the band is 4.5px, so an edge
  // of a neighbouring cell can be in range and go untested.
  //
  // Left as is: the only effect is that an edge door's grab region stops
  // growing once it fills its cell, which at 3px per cell is invisible and
  // arguably right. `canvas/drawZone.ts` faces the same arithmetic and cannot
  // ignore it, since there an unclamped band makes the room interior
  // unreachable, so it clamps both of its tolerances to a fraction of the
  // drawn cell. Copy that approach rather than this one if this ever needs to
  // be exact.
  for (const edge of edgesAround(cell)) {
    const transitions = scene.map.transitionsAtEdge.get(edge)
    if (!transitions?.size) continue
    if (distanceToEdge(point, edge, scene) > band) continue
    // Deterministic when several share an edge: last by insertion, matching
    // "later is painted on top".
    const id = [...transitions].at(-1)!
    return { kind: 'transition', id }
  }
  return null
}

// Both ends of a teleport are hit-testable on the tab they appear on. The near
// end is in this map's own index; the far end of a cross-tab teleport is not:
// it is rebuilt from the project's far-end index, which is what makes the
// destination marker a real target rather than a drawing.
function teleportAt(cell: CellKey, scene: HitScene): ObjectRef | null {
  const local = scene.map.transitionsAtCell.get(cell)
  if (local?.size) return { kind: 'transition', id: [...local].at(-1)! }

  const farEnd = farEndsOnMap(scene.project.teleportFarEnds, scene.map.id).get(cell)
  if (farEnd) return { kind: 'transition', id: farEnd.transitionId }

  return null
}

function edgesAround(cell: CellKey): EdgeKey[] {
  const { x, y } = parseCell(cell)
  // "x,y,V" is the west side of (x,y); "x,y,H" is its north side.
  return [`${x},${y},V`, `${x + 1},${y},V`, `${x},${y},H`, `${x},${y + 1},H`]
}

function cellCentre(cell: CellKey, scene: HitScene): ScreenPoint {
  const { x, y } = parseCell(cell)
  return worldPoint(x + 0.5, y + 0.5, scene)
}

function worldPoint(x: number, y: number, scene: HitScene): ScreenPoint {
  const scale = scene.tileSize * scene.camera.zoom
  return {
    x: (x - scene.camera.pan.x) * scale,
    y: (y - scene.camera.pan.y) * scale,
  }
}

function distanceToEdge(point: ScreenPoint, edge: EdgeKey, scene: HitScene): number {
  const [[ax, ay], [bx, by]] = segmentFromEdge(edge)
  return distanceToSegment(point, worldPoint(ax, ay, scene), worldPoint(bx, by, scene))
}

// Perpendicular distance to a segment, clamped to its ends so the region is a
// capsule rather than an infinite strip: without the clamp, a point far off
// the end of a short wall would still "hit" it.
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

// Re-exported for the gesture layer, which needs "which cells does this edge
// separate" when turning a hit into an edit.
export { edgeCells }
