// The rectangle a selection occupies on one map.
//
// Every `ObjectRef` kind resolves to cells, and the answer is their bounding
// box. Two rules make it well defined:
//
//   1. Only cells on the map being asked about count. A teleport is the one
//      ref that can reach across tabs, so a selected pair with its far end
//      elsewhere contributes one end here, not two. Without that the box would
//      stretch to another map's coordinates, which name nothing on this one.
//   2. A ref that has nothing on this map contributes nothing rather than
//      failing. A selection can outlive the thing it names, and an empty box
//      is not an error.
//
// Null means the selection covers no cell here, which is what disables the
// commands that need something to frame.

import { areaBoundsOnMap, boundsOfCells, unionBounds } from '@/core/derive/bounds'
import { edgeCells } from '@/core/cell'
import type { CellBounds } from '@/core/derive/bounds'
import type { CellKey } from '@/core/cell'
import type { MapId } from '@/core/ids'
import type { MapModel, ObjectRef, Transition } from '@/core/types'

function* transitionCells(transition: Transition, mapId: MapId): Generator<CellKey> {
  if (transition.kind === 'edge') {
    // Both sides of every segment: a door sits between two cells and belongs
    // to neither more than the other.
    for (const segment of transition.segments) {
      const { lo, hi } = edgeCells(segment.edge)
      yield lo
      yield hi
    }
    return
  }
  if (transition.kind === 'elevator') {
    yield transition.a
    yield transition.b
    return
  }
  // Rule 1: a teleport's ends carry their own map.
  if (transition.a.mapId === mapId) yield transition.a.cell
  if (transition.b.mapId === mapId) yield transition.b.cell
}

function* refCells(ref: ObjectRef, map: MapModel): Generator<CellKey> {
  switch (ref.kind) {
    case 'cell':
      yield ref.id
      return
    case 'room': {
      const room = map.rooms.get(ref.id)
      if (room) yield* room.cells
      return
    }
    case 'icon': {
      const icon = map.icons.get(ref.id)
      if (icon) yield icon.cell
      return
    }
    case 'line': {
      const line = map.lines.get(ref.id)
      if (line) yield* line.points
      return
    }
    case 'transition': {
      const transition = map.transitions.get(ref.id)
      if (transition) yield* transitionCells(transition, map.id)
      return
    }
    case 'area':
      // An area is not made of cells: it is however much of this map its rooms
      // cover, which the model already derives.
      return
  }
}

export function selectionBounds(refs: readonly ObjectRef[], map: MapModel): CellBounds | null {
  const cells: CellKey[] = []
  let box: CellBounds | null = null

  for (const ref of refs) {
    if (ref.kind === 'area') {
      const area = areaBoundsOnMap(map, ref.id)
      if (area) box = box ? unionBounds(box, area) : area
      continue
    }
    cells.push(...refCells(ref, map))
  }

  const fromCells = boundsOfCells(cells)
  if (!fromCells) return box
  return box ? unionBounds(box, fromCells) : fromCells
}
