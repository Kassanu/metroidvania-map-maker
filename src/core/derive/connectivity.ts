// Orthogonal connectivity: the rule that makes a room a room.
//
// "A room is a set of orthogonally connected cells" is a core invariant, and
// the split rule is its enforcement: whenever an edit can disconnect a room
// (erase, shrink, cut), the survivors are re-split into connected groups here.

import { cellKey, neighbors, parseCell } from '../cell'
import type { CellKey } from '../cell'

// Flood-fills `cells` into maximal orthogonally-connected groups. A room whose
// cells come back as one group is intact; two or more means it just split.
export function connectedComponents(cells: Iterable<CellKey>): Set<CellKey>[] {
  const remaining = new Set(cells)
  const groups: Set<CellKey>[] = []

  while (remaining.size > 0) {
    // Any seed will do: the groups are re-ordered by content below, so which
    // one the fill happens to find first does not reach the caller.
    const seed: CellKey = remaining.values().next().value!
    const group = new Set<CellKey>()
    const stack: CellKey[] = [seed]
    remaining.delete(seed)

    while (stack.length > 0) {
      const cell = stack.pop()!
      group.add(cell)
      for (const neighbor of neighbors(cell)) {
        if (remaining.delete(neighbor)) stack.push(neighbor)
      }
    }
    groups.push(group)
  }

  return orderByPosition(groups)
}

// Groups in row-major order of their top-left-most cell.
//
// The order matters: callers assign identity by order. `splitIfDisconnected`
// keeps one group and mints fresh RoomIds for the rest in this order. So the
// order must be deterministic, derived from the cells' positions.
//
// Sorting groups rather than cells keeps the fill O(n). There is almost always
// exactly one group, and the anchors cost one pass only when there is a real
// split to order.
function orderByPosition(groups: Set<CellKey>[]): Set<CellKey>[] {
  if (groups.length < 2) return groups
  return groups
    .map((group) => ({ group, anchor: parseCell(topLeftMost(group)!) }))
    .sort((a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x)
    .map((each) => each.group)
}

// The split rule's tiebreaker: top-most, then left-most (min row, min col).
// Deterministic and origin-independent, so the unbounded grid needs no (0,0).
export function topLeftMost(cells: Iterable<CellKey>): CellKey | null {
  let best: CellKey | null = null
  let bestX = 0
  let bestY = 0
  for (const cell of cells) {
    const { x, y } = parseCell(cell)
    if (best === null || y < bestY || (y === bestY && x < bestX)) {
      best = cell
      bestX = x
      bestY = y
    }
  }
  return best
}

// Which group keeps the original room's identity after an incidental split
// (an erase removed a linking cell). Returns its index in `groups`.
//
// Deliberate cut/move does NOT use this. There the grabbed cells become the
// new room and the leftover keeps the identity, because the user's selection
// signals which is which.
export function originalGroupIndex(groups: Set<CellKey>[]): number {
  let bestIndex = 0
  let bestX = 0
  let bestY = 0
  for (let i = 0; i < groups.length; i++) {
    const anchor = topLeftMost(groups[i])
    if (anchor === null) continue
    const { x, y } = parseCell(anchor)
    if (i === 0 || y < bestY || (y === bestY && x < bestX)) {
      bestIndex = i
      bestX = x
      bestY = y
    }
  }
  return bestIndex
}

// Rotation and flips work on a cell set around its bounding-box centre. The
// half-cell offset that a mixed odd/even bounding box produces is resolved
// with a consistent top-left bias, the same as the even brush and split
// tiebreaker.
export type Transform = 'rotateLeft' | 'rotateRight' | 'flipH' | 'flipV'

export function transformCells(
  cells: Iterable<CellKey>,
  transform: Transform,
): Map<CellKey, CellKey> {
  const list = [...cells]
  const result = new Map<CellKey, CellKey>()
  if (list.length === 0) return result

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const cell of list) {
    const { x, y } = parseCell(cell)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const width = maxX - minX + 1
  const height = maxY - minY + 1

  for (const cell of list) {
    const { x, y } = parseCell(cell)
    // Local coordinates within the bounding box.
    const lx = x - minX
    const ly = y - minY
    let nx: number
    let ny: number
    switch (transform) {
      case 'rotateRight':
        // (lx, ly) -> (height-1-ly, lx); the box's width and height swap.
        nx = height - 1 - ly
        ny = lx
        break
      case 'rotateLeft':
        nx = ly
        ny = width - 1 - lx
        break
      case 'flipH':
        nx = width - 1 - lx
        ny = ly
        break
      case 'flipV':
        nx = lx
        ny = height - 1 - ly
        break
    }
    result.set(cell, cellKey(nx, ny))
  }

  // A rotation swaps the box's dimensions, so re-centring it on the original
  // centre lands on a half cell whenever width - height is odd, and the result
  // has to snap back onto the grid.
  //
  // Rounding towards zero on both axes, in both directions, makes the
  // transforms compose correctly. All of these hold exactly:
  //
  //   rotate right then left, and left then right (changing your mind)
  //   four turns in the same direction, either way
  //   two rights == two lefts == flipH then flipV
  //   each flip is its own inverse
  //
  // A rotation's offset is f(w,h) = trunc((w-h)/2), and an opposing pair
  // cancels exactly when f(w,h) = -f(h,w), so the rounding must be odd
  // symmetric. `Math.trunc` is; `Math.floor` and `Math.ceil` are not, and a
  // floor/ceil pairing buys the two-opposite-turns case only by losing the
  // four-same-turns one. Relocating is destructive, so drift deletes rooms.
  //
  // On a mixed-parity box, rotating left and right land on the same footprint.
  // Direction still decides orientation, not position.
  const rotated = transform === 'rotateLeft' || transform === 'rotateRight'
  const newWidth = rotated ? height : width
  const newHeight = rotated ? width : height
  const offsetX = minX + Math.trunc((width - newWidth) / 2)
  const offsetY = minY + Math.trunc((height - newHeight) / 2)

  for (const [from, to] of result) {
    const { x, y } = parseCell(to)
    result.set(from, cellKey(x + offsetX, y + offsetY))
  }

  return result
}
