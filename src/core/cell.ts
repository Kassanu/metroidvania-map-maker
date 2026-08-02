// The coordinate language the whole model speaks.
//
// Two key types do all the work:
//
//   CellKey: a cell on the unbounded signed-integer grid, "x,y".
//   EdgeKey: one unit edge between two cells, "x,y,V" or "x,y,H".
//
// Canonicalising edges is the point of this file. The edge between cells
// (3,7) and (4,7) is one edge, but it is reachable as "(3,7)'s east side" or
// "(4,7)'s west side". If those were distinct values, every wall lookup would
// have to try both, and outer walls, inner walls, edge doors and hit-testing
// would each grow their own convention. Instead every edge has exactly one
// name:
//
//   "x,y,V" is the edge on the WEST side of cell (x,y), separating
//           (x-1,y) from (x,y).
//   "x,y,H" is the edge on the NORTH side of cell (x,y), separating
//           (x,y-1) from (x,y).
//
// Everything positional in the model (outer walls, inner walls, edge-door
// segments, elevator endpoints) reduces to these two.
//
// Keys are strings rather than bit-packed numbers deliberately. Packing into
// a single int is faster but caps a grid that is unbounded by design, and
// makes every debugger session an arithmetic exercise. Map lookups on
// short interned strings are far from the bottleneck here, and if profiling
// ever says otherwise this is the one file that has to change.

export type CellKey = string
export type EdgeKey = string

export interface Cell {
  x: number
  y: number
}

// N/E/S/W as the user thinks of them. Screen orientation: +y is down, so
// north is toward smaller y. Used by wall derivation, resize handles, and
// door geometry.
export type Side = 'N' | 'E' | 'S' | 'W'
export const SIDES: readonly Side[] = ['N', 'E', 'S', 'W']

// The unit step outward through a side: away from the cell, and away from
// the room for a boundary edge.
//
// A frozen table rather than a function returning a literal, because the
// callers are hot (wall derivation runs per room per frame) and a per-call
// allocation there buys nothing. `neighborOn` keeps its own switch for the
// same reason: it never needs the components, only the resulting key.
export const SIDE_DELTA: Readonly<Record<Side, { readonly dx: number; readonly dy: number }>> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
}

export function cellKey(x: number, y: number): CellKey {
  return `${x},${y}`
}

export function toKey(cell: Cell): CellKey {
  return `${cell.x},${cell.y}`
}

export function parseCell(key: CellKey): Cell {
  const comma = key.indexOf(',')
  return { x: Number(key.slice(0, comma)), y: Number(key.slice(comma + 1)) }
}

// The four orthogonal neighbours. Room connectivity is orthogonal-only (a
// room is "a set of orthogonally connected cells"), so this is what the split
// rule, wall derivation and paint-growth all walk.
export function neighbors(key: CellKey): CellKey[] {
  const { x, y } = parseCell(key)
  return [cellKey(x, y - 1), cellKey(x + 1, y), cellKey(x, y + 1), cellKey(x - 1, y)]
}

export function neighborOn(key: CellKey, side: Side): CellKey {
  const { x, y } = parseCell(key)
  switch (side) {
    case 'N':
      return cellKey(x, y - 1)
    case 'E':
      return cellKey(x + 1, y)
    case 'S':
      return cellKey(x, y + 1)
    case 'W':
      return cellKey(x - 1, y)
  }
}

// All eight neighbours, for path lines: each segment can go to any of the 8
// adjacent cells (orthogonal or diagonal).
export function neighbors8(key: CellKey): CellKey[] {
  const { x, y } = parseCell(key)
  const out: CellKey[] = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx !== 0 || dy !== 0) out.push(cellKey(x + dx, y + dy))
    }
  }
  return out
}

export function isAdjacent8(a: CellKey, b: CellKey): boolean {
  const p = parseCell(a)
  const q = parseCell(b)
  const dx = Math.abs(p.x - q.x)
  const dy = Math.abs(p.y - q.y)
  return dx <= 1 && dy <= 1 && dx + dy > 0
}

export function translate(key: CellKey, dx: number, dy: number): CellKey {
  const { x, y } = parseCell(key)
  return cellKey(x + dx, y + dy)
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

export type EdgeAxis = 'V' | 'H'

export function edgeKey(x: number, y: number, axis: EdgeAxis): EdgeKey {
  return `${x},${y},${axis}`
}

export function parseEdge(key: EdgeKey): { x: number; y: number; axis: EdgeAxis } {
  const first = key.indexOf(',')
  const second = key.indexOf(',', first + 1)
  return {
    x: Number(key.slice(0, first)),
    y: Number(key.slice(first + 1, second)),
    axis: key.slice(second + 1) as EdgeAxis,
  }
}

// The canonical key for a given cell's given side. N and W are already
// canonical; S and E are the neighbour's N and W.
export function edgeOfCell(key: CellKey, side: Side): EdgeKey {
  const { x, y } = parseCell(key)
  switch (side) {
    case 'N':
      return edgeKey(x, y, 'H')
    case 'S':
      return edgeKey(x, y + 1, 'H')
    case 'W':
      return edgeKey(x, y, 'V')
    case 'E':
      return edgeKey(x + 1, y, 'V')
  }
}

// The two cells an edge separates, in canonical order: `lo` is the one on the
// smaller-coordinate side (west of a V edge, north of an H edge), `hi` the
// other. That fixed order lets an edge door name its A/B sides stably.
export function edgeCells(key: EdgeKey): { lo: CellKey; hi: CellKey } {
  const { x, y, axis } = parseEdge(key)
  return axis === 'V'
    ? { lo: cellKey(x - 1, y), hi: cellKey(x, y) }
    : { lo: cellKey(x, y - 1), hi: cellKey(x, y) }
}

// Which side of `cell` this edge is, or null if the edge doesn't touch it.
export function sideOfEdge(edge: EdgeKey, cell: CellKey): Side | null {
  const { lo, hi } = edgeCells(edge)
  const { axis } = parseEdge(edge)
  if (cell === lo) return axis === 'V' ? 'E' : 'S'
  if (cell === hi) return axis === 'V' ? 'W' : 'N'
  return null
}

export function translateEdge(key: EdgeKey, dx: number, dy: number): EdgeKey {
  const { x, y, axis } = parseEdge(key)
  return edgeKey(x + dx, y + dy, axis)
}

// The edge two orthogonally adjacent cells share, or null if they are not
// neighbours.
//
// Edges follow a transform by asking where the two cells went and taking the
// edge between their images. Translating the edge itself fails for rotation
// and mirror (the axis changes). The cell-based approach works for all four
// transforms, since every one the model supports is a grid isometry and
// preserves adjacency.
export function edgeBetween(a: CellKey, b: CellKey): EdgeKey | null {
  const p = parseCell(a)
  const q = parseCell(b)
  const dx = q.x - p.x
  const dy = q.y - p.y
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null
  if (dx === 1) return edgeOfCell(a, 'E')
  if (dx === -1) return edgeOfCell(a, 'W')
  return edgeOfCell(a, dy === 1 ? 'S' : 'N')
}

// The two edges that face each other across a gap: the side of `a` pointing at
// `b`, and the side of `b` pointing back. Elevators are anchored to these
// pairs. Returns an empty array when the cells are not aligned on a row or
// column (elevators must be axis-aligned).
export function facingEdges(a: CellKey, b: CellKey): EdgeKey[] {
  const p = parseCell(a)
  const q = parseCell(b)
  if (p.x === q.x && p.y === q.y) return []

  if (p.y === q.y) {
    const aSide: Side = q.x > p.x ? 'E' : 'W'
    const bSide: Side = q.x > p.x ? 'W' : 'E'
    return [edgeOfCell(a, aSide), edgeOfCell(b, bSide)]
  }
  if (p.x === q.x) {
    const aSide: Side = q.y > p.y ? 'S' : 'N'
    const bSide: Side = q.y > p.y ? 'N' : 'S'
    return [edgeOfCell(a, aSide), edgeOfCell(b, bSide)]
  }
  return []
}

// ---------------------------------------------------------------------------
// Edges <-> stored vertex segments
// ---------------------------------------------------------------------------
//
// Inner walls persist as vertex pairs (`seg: [[vx,vy],[vx,vy]]`) because that
// is the natural way to describe a drawn segment. Vertex (vx,vy) is the grid
// corner at the top-left of cell (vx,vy), so a unit segment maps onto exactly
// one canonical edge:
//
//   (vx,vy) -> (vx+1,vy)   horizontal, along the top of cell (vx,vy)   = H
//   (vx,vy) -> (vx,vy+1)   vertical, along the left of cell (vx,vy)    = V
//
// These two functions are the whole serialisation boundary for wall geometry.

export type VertexSegment = [[number, number], [number, number]]

export function edgeFromSegment(seg: VertexSegment): EdgeKey | null {
  const [[ax, ay], [bx, by]] = seg
  // Normalise direction so a segment drawn right-to-left is the same edge.
  const x = Math.min(ax, bx)
  const y = Math.min(ay, by)
  if (ay === by && Math.abs(ax - bx) === 1) return edgeKey(x, y, 'H')
  if (ax === bx && Math.abs(ay - by) === 1) return edgeKey(x, y, 'V')
  // Not a unit segment: a corrupt or hand-edited file that the caller drops.
  return null
}

export function segmentFromEdge(key: EdgeKey): VertexSegment {
  const { x, y, axis } = parseEdge(key)
  return axis === 'H'
    ? [
        [x, y],
        [x + 1, y],
      ]
    : [
        [x, y],
        [x, y + 1],
      ]
}
