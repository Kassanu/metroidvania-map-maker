// Map-level derived geometry: the drawn extent of a map, and the bounding box
// an area draws its border around.
//
// Note what is NOT here: the padded, minimum-sized "page" the canvas draws.
// That is a visual treatment. The grid is unbounded, and the sheet is just a
// window over the content so the view has somewhere to end, so it lives in
// `canvas/page.ts`. This file only answers "what has actually been drawn".
//
// The grid is unbounded, so "the map's bounds" is purely a function of what
// has been drawn. Storing bounds separately creates a second source of truth
// that goes stale when a room moves. Computed here and memoised per revision.

import { computeBounds } from './walls'
import type { CellBounds } from './walls'
import { parseCell } from '../cell'
import type { CellKey } from '../cell'
import type { AreaId } from '../ids'
import type { MapModel } from '../types'

export type { CellBounds }

// Every cell the map has content on: room cells, icon cells, and line points.
// Icons always sit inside rooms so they never extend the extent, but lines are
// an independent overlay and may live anywhere, including outside every room.
function* contentCells(map: MapModel): Generator<CellKey> {
  for (const room of map.rooms.values()) yield* room.cells
  for (const line of map.lines.values()) yield* line.points
}

interface MapDerived {
  rev: number
  bounds: CellBounds | null
  areaBounds: Map<AreaId, CellBounds>
}

const cache = new WeakMap<MapModel, MapDerived>()

function derived(map: MapModel): MapDerived {
  const hit = cache.get(map)
  if (hit && hit.rev === map.rev) return hit

  const areaBounds = new Map<AreaId, CellBounds>()
  for (const room of map.rooms.values()) {
    const box = computeBounds(room.cells)
    if (!box) continue
    const existing = areaBounds.get(room.areaId)
    areaBounds.set(room.areaId, existing ? union(existing, box) : box)
  }

  const fresh: MapDerived = { rev: map.rev, bounds: computeBounds(contentCells(map)), areaBounds }
  cache.set(map, fresh)
  return fresh
}

function union(a: CellBounds, b: CellBounds): CellBounds {
  return {
    minCol: Math.min(a.minCol, b.minCol),
    minRow: Math.min(a.minRow, b.minRow),
    maxCol: Math.max(a.maxCol, b.maxCol),
    maxRow: Math.max(a.maxRow, b.maxRow),
  }
}

// The map's drawn extent, or null when it is empty.
export function contentBounds(map: MapModel): CellBounds | null {
  return derived(map).bounds
}

// The bounding box for an area's labelled border on this map. An area may
// have rooms on several tabs, so this is scoped per map.
export function areaBoundsOnMap(map: MapModel, areaId: AreaId): CellBounds | null {
  return derived(map).areaBounds.get(areaId) ?? null
}

export function areaBoundsByArea(map: MapModel): ReadonlyMap<AreaId, CellBounds> {
  return derived(map).areaBounds
}

export function boundsOfCells(cells: Iterable<CellKey>): CellBounds | null {
  return computeBounds(cells)
}

export function boundsContain(bounds: CellBounds, cell: CellKey): boolean {
  const { x, y } = parseCell(cell)
  return x >= bounds.minCol && x <= bounds.maxCol && y >= bounds.minRow && y <= bounds.maxRow
}
