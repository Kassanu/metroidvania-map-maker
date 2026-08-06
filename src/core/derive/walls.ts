// Outer walls and edge runs: derived from cell adjacency, never stored.
//
// Walls are auto-derived from cell adjacency: boundary edges (those with no
// same-room neighbour across them) have walls, shared edges do not. The user
// cannot manually add or remove outer walls, so there is nothing to persist.
// The cells are the truth and this file reads it.
//
// Two consumers, both hot: the renderer draws these every frame, and Draw/Edit
// needs the *runs* to place resize handles. Hence the per-room memo at the
// bottom, keyed on the room's revision counter.

import { SIDES, cellKey, edgeCells, edgeOfCell, neighborOn, parseCell } from '../cell'
import type { CellKey, EdgeKey, Side } from '../cell'
import type { Room } from '../types'

// A maximal straight run of boundary edges on one side of a room.
//
// Resize handles appear on runs of length >= 2 only; a length-1 face has no
// handle and is grown by painting instead. `cells` is the run's room cells in
// ascending order, which is what an extrusion needs: dragging out by N adds N
// rows/columns to *these cells only*, never picking up extra length as the
// shape changes mid-drag (the locked grabbed-run-only rule).
export interface EdgeRun {
  side: Side
  cells: CellKey[]
  edges: EdgeKey[]
}

// The boundary of an arbitrary cell set: every edge with no member across it.
//
// A room's outer walls are this over its own cells, and a cell selection's
// outline is this over cells that may span several rooms or none. Two disjoint
// clumps yield both their boundaries in one set, so the result draws as two
// outlines without anything here knowing about connectivity.
export function boundaryEdges(cells: ReadonlySet<CellKey>): Set<EdgeKey> {
  const edges = new Set<EdgeKey>()
  for (const cell of cells) {
    for (const side of SIDES) {
      if (!cells.has(neighborOn(cell, side))) edges.add(edgeOfCell(cell, side))
    }
  }
  return edges
}

export function computeOuterWalls(room: Room): Set<EdgeKey> {
  return boundaryEdges(room.cells)
}

// An edge can carry an inner wall exactly when both cells it separates belong
// to the room. Anything else is an outer boundary, and outer walls are derived
// from adjacency rather than drawn.
//
// Stated once because four things enforce it: the op that draws a wall, the
// sweep that prunes walls whose cells left the room, and the stroke that walks
// the lattice. A filter stronger than this one silently makes edges
// undrawable; a weaker one hands the op something it refuses.
export function isInnerWallEdge(room: Room, edge: EdgeKey): boolean {
  const { lo, hi } = edgeCells(edge)
  return room.cells.has(lo) && room.cells.has(hi)
}

export function computeEdgeRuns(room: Room): EdgeRun[] {
  const runs: EdgeRun[] = []

  for (const side of SIDES) {
    // Boundary cells on this side, bucketed by the line they sit on: for N/S
    // that is the row, for E/W the column. Within a bucket, consecutive
    // positions form one run.
    const buckets = new Map<number, number[]>()
    const horizontal = side === 'N' || side === 'S'

    for (const cell of room.cells) {
      if (room.cells.has(neighborOn(cell, side))) continue
      const { x, y } = parseCell(cell)
      const line = horizontal ? y : x
      const position = horizontal ? x : y
      const bucket = buckets.get(line)
      if (bucket) bucket.push(position)
      else buckets.set(line, [position])
    }

    for (const [line, positions] of buckets) {
      positions.sort((a, b) => a - b)
      let start = 0
      for (let i = 1; i <= positions.length; i++) {
        const broken = i === positions.length || positions[i] !== positions[i - 1] + 1
        if (!broken) continue
        const cells: CellKey[] = []
        for (let j = start; j < i; j++) {
          cells.push(horizontal ? cellKey(positions[j], line) : cellKey(line, positions[j]))
        }
        runs.push({ side, cells, edges: cells.map((cell) => edgeOfCell(cell, side)) })
        start = i
      }
    }
  }

  return runs
}

// Bounding box in cell coordinates, inclusive on both ends. Null for an empty
// cell set, which only occurs transiently while a room is being built up.
export interface CellBounds {
  minCol: number
  minRow: number
  maxCol: number
  maxRow: number
}

export function computeBounds(cells: Iterable<CellKey>): CellBounds | null {
  let minCol = Infinity
  let minRow = Infinity
  let maxCol = -Infinity
  let maxRow = -Infinity
  let any = false

  for (const cell of cells) {
    const { x, y } = parseCell(cell)
    any = true
    if (x < minCol) minCol = x
    if (x > maxCol) maxCol = x
    if (y < minRow) minRow = y
    if (y > maxRow) maxRow = y
  }

  return any ? { minCol, minRow, maxCol, maxRow } : null
}

// ---------------------------------------------------------------------------
// Memo
// ---------------------------------------------------------------------------
// Every one of these is O(cells) and the renderer wants all three per room per
// frame. The room's `rev` counter (bumped by any journaled geometry change,
// in both directions) is the cache key, so a rolled-back ghost invalidates
// exactly as reliably as a committed edit does.

interface RoomDerived {
  rev: number
  outerWalls: Set<EdgeKey>
  edgeRuns: EdgeRun[]
  bounds: CellBounds | null
}

const cache = new WeakMap<Room, RoomDerived>()

function derived(room: Room): RoomDerived {
  const hit = cache.get(room)
  if (hit && hit.rev === room.rev) return hit
  const fresh: RoomDerived = {
    rev: room.rev,
    outerWalls: computeOuterWalls(room),
    edgeRuns: computeEdgeRuns(room),
    bounds: computeBounds(room.cells),
  }
  cache.set(room, fresh)
  return fresh
}

export function outerWalls(room: Room): Set<EdgeKey> {
  return derived(room).outerWalls
}

export function edgeRuns(room: Room): EdgeRun[] {
  return derived(room).edgeRuns
}

// Only runs of 2+ get a handle.
export function resizableRuns(room: Room): EdgeRun[] {
  return derived(room).edgeRuns.filter((run) => run.cells.length >= 2)
}

export function roomBounds(room: Room): CellBounds | null {
  return derived(room).bounds
}

// A vertex is a wall target when at least one of the four edges meeting at it
// can carry an inner wall, which is `isInnerWallEdge` on each in turn: the two
// cells of that edge are the two the vertex separates on one axis.
//
// Not "all four cells belong to the room". That is strictly stronger, and the
// difference is the whole ring of vertices on the outer boundary: a room one
// cell thick satisfies it nowhere, so it could hold no wall at all.
//
// The predicate as well as the list, because the two consumers want different
// things: the renderer enumerates every target, while the Draw-mode zone
// resolver only asks about the four corners of one cell and would otherwise
// scan a 20x20 room's 441 vertices on every pointer move. Both read this one
// rule, so they cannot disagree about where a wall may be started.
export function isWallVertex(room: Room, x: number, y: number): boolean {
  const nw = room.cells.has(cellKey(x - 1, y - 1))
  const ne = room.cells.has(cellKey(x, y - 1))
  const sw = room.cells.has(cellKey(x - 1, y))
  const se = room.cells.has(cellKey(x, y))
  return (nw && ne) || (sw && se) || (nw && sw) || (ne && se)
}

// Wall vertices: the targets Draw/Edit shows for inner-wall drawing.
//
// Walks the cells, not the bounding box: a sparse room's box is arbitrarily
// larger than its contents. All four corners of each cell, because a wall
// vertex need only touch the room rather than be surrounded by it, so it can
// sit at any corner of the cell that reaches it; hence the dedupe. Row-major
// order, so a set that reordered under an edit still yields the same list.
export function wallVertices(room: Room): { x: number; y: number }[] {
  const seen = new Set<string>()
  const vertices: { x: number; y: number }[] = []
  for (const cell of room.cells) {
    const { x, y } = parseCell(cell)
    for (const [vx, vy] of [
      [x, y],
      [x + 1, y],
      [x, y + 1],
      [x + 1, y + 1],
    ]) {
      const key = `${vx},${vy}`
      if (seen.has(key)) continue
      seen.add(key)
      if (isWallVertex(room, vx, vy)) vertices.push({ x: vx, y: vy })
    }
  }
  return vertices.sort((a, b) => a.y - b.y || a.x - b.x)
}
