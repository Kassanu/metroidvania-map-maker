// The cross-map teleport far-end index. A cross-tab teleport is stored once,
// under its origin map. The destination tab must draw a marker and answer
// hit-tests, so this index maps a landing cell to the origin transition.
//
// This module exists to avoid spelling out the key format at three call sites
// (primitives, serializer, cascade's prefix scan) and to make lookups efficient.
// A flat `Map<"mapId:cell", TransitionId>` would force iteration over every far
// end. Nesting by map makes both lookups O(1). Storing the origin map id means
// finding the transition object doesn't require searching `mapsById`.
//
// At most one teleport per cell is an invariant, so a cell holds at most one
// far end and a plain value is correct here.

import type { CellKey } from './cell'
import type { MapId, TransitionId } from './ids'

export interface FarEndRef {
  transitionId: TransitionId
  // The map the transition is stored under (its origin endpoint's map, not the
  // map this far end sits on).
  originMapId: MapId
}

export type FarEndIndex = Map<MapId, Map<CellKey, FarEndRef>>

export function createFarEndIndex(): FarEndIndex {
  return new Map()
}

export function getFarEnd(index: FarEndIndex, mapId: MapId, cell: CellKey): FarEndRef | undefined {
  return index.get(mapId)?.get(cell)
}

export function setFarEnd(index: FarEndIndex, mapId: MapId, cell: CellKey, ref: FarEndRef): void {
  const perMap = index.get(mapId)
  if (perMap) perMap.set(cell, ref)
  else index.set(mapId, new Map([[cell, ref]]))
}

export function deleteFarEnd(index: FarEndIndex, mapId: MapId, cell: CellKey): void {
  const perMap = index.get(mapId)
  if (!perMap) return
  perMap.delete(cell)
  // Drop the empty bucket so iteration stays proportional to live data.
  if (perMap.size === 0) index.delete(mapId)
}

// Restores whatever was at this slot before. A journal inverse needs this shape.
// Passing `undefined` means nothing was here. A plain delete-on-undo would fail:
// it would wipe an entry another teleport owned.
export function restoreFarEnd(
  index: FarEndIndex,
  mapId: MapId,
  cell: CellKey,
  previous: FarEndRef | undefined,
): void {
  if (previous === undefined) deleteFarEnd(index, mapId, cell)
  else setFarEnd(index, mapId, cell, previous)
}

// The far ends landing on one map. Empty (not a scan of everything) when the
// map has none.
export function farEndsOnMap(index: FarEndIndex, mapId: MapId): ReadonlyMap<CellKey, FarEndRef> {
  return index.get(mapId) ?? EMPTY
}

const EMPTY: ReadonlyMap<CellKey, FarEndRef> = new Map()

// Total entries, for tests and diagnostics.
export function farEndCount(index: FarEndIndex): number {
  let count = 0
  for (const perMap of index.values()) count += perMap.size
  return count
}
