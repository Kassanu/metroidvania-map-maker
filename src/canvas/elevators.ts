// Elevator geometry: the shaft's cells, and the two edges where it meets its
// rooms.
//
// The shaft draws behind room cells and only in empty cells: where it would
// cross a room, the room's cells cover it.
//
// The filtering happens here rather than in the renderer, because draw order
// alone is not enough: a third room sitting in the gap is legal and expected
// (`isGapIntact` explicitly allows it), so "only in empty cells" is a fact
// about the geometry, not an accident of what gets painted over. The renderer
// also draws shafts before room fills, so the rule holds twice: once by
// construction and once by paint order.

import { facingEdges, cellKey, parseCell } from '@/core/cell'
import type { CellKey, EdgeKey } from '@/core/cell'
import type { LockTypeId, TransitionId } from '@/core/ids'
import type { MapModel } from '@/core/types'

export interface ElevatorShaft {
  id: TransitionId
  axis: 'h' | 'v'
  // The gap cells the shaft is drawn in, in walk order from the A end to the B
  // end. Endpoint cells are excluded (they are inside their rooms), and so is
  // any cell a third room occupies, which is what makes the shaft pass behind
  // it. An elevator whose whole gap is filled by a third room draws no shaft at
  // all and is still perfectly valid.
  openCells: CellKey[]
  // The facing edges, A first: where the shaft meets each room's wall, and
  // where its endpoints snap to on screen.
  ends: [EdgeKey, EdgeKey]
  // Per-end locks, so each end can show the lock facing its own room, which an
  // elevator does naturally, having two distinct markers.
  locks: { a: LockTypeId; b: LockTypeId }
  // A one-way elevator carries an arrowhead on the shaft, pointing A to B.
  oneWay: boolean
}

export function elevatorShafts(map: MapModel): ElevatorShaft[] {
  const shafts: ElevatorShaft[] = []

  for (const transition of map.transitions.values()) {
    if (transition.kind !== 'elevator') continue
    const ends = facingEdges(transition.a, transition.b)
    // Not aligned means not an elevator; the invariant check forbids it and the
    // classifier cannot produce it, so this is the hand-edited-file guard.
    if (ends.length !== 2) continue

    shafts.push({
      id: transition.id,
      axis: transition.axis,
      openCells: gapCells(transition.a, transition.b).filter((cell) => !map.cellOwner.has(cell)),
      ends: [ends[0], ends[1]],
      locks: transition.locks,
      oneWay: transition.oneWay,
    })
  }

  return shafts
}

// The cells strictly between the two endpoints, walking A to B. Order carries
// the direction, which is what the one-way arrowhead points along.
//
// "Strictly between" overlaps with the owned-cell filter above and no test can
// tell them apart: a valid elevator's endpoints are inside rooms by definition,
// so the filter drops them whether this walk includes them or not. Kept
// exclusive anyway because this function's job is to describe the gap, and the
// filter's is to describe what is empty, though the filter is the one actually
// enforcing it.
function gapCells(a: CellKey, b: CellKey): CellKey[] {
  const from = parseCell(a)
  const to = parseCell(b)
  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))

  const cells: CellKey[] = []
  for (let i = 1; i < steps; i++) cells.push(cellKey(from.x + dx * i, from.y + dy * i))
  return cells
}
