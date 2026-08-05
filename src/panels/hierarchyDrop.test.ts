import { describe, it, expect } from 'vitest'
import { dropTargetAt, planDrop, type DropRow } from './hierarchyDrop'
import type { AreaId, RoomId } from '@/core/ids'

// The drop decision, tested without a DOM, which is the reason it is a pure
// function at all: jsdom has no layout, so a component test reading real rects
// asserts nothing.

const WORLD = 'world' as AreaId
const CRATERIA = 'crateria' as AreaId
const A = 'a' as RoomId
const B = 'b' as RoomId
const C = 'c' as RoomId

// Rows 20px tall, stacked from y = 0:
//   0-20   World          (area)
//   20-40  a              (room, World)
//   40-60  Crateria       (area)
//   60-80  b              (room, Crateria)
//   80-100 c              (room, Crateria)
const ROWS: DropRow[] = [
  { kind: 'area', id: WORLD, top: 0, height: 20 },
  { kind: 'room', id: A, top: 20, height: 20 },
  { kind: 'area', id: CRATERIA, top: 40, height: 20 },
  { kind: 'room', id: B, top: 60, height: 20 },
  { kind: 'room', id: C, top: 80, height: 20 },
]

const ORDER: RoomId[] = [A, B, C]
const AREAS: Record<string, AreaId> = { a: WORLD, b: CRATERIA, c: CRATERIA }
const areaOf = (id: RoomId) => AREAS[id]

describe('dropTargetAt', () => {
  it('reads an area row as "join this area", anywhere in it', () => {
    expect(dropTargetAt(1, ROWS)).toEqual({ kind: 'intoArea', areaId: WORLD })
    expect(dropTargetAt(19, ROWS)).toEqual({ kind: 'intoArea', areaId: WORLD })
    expect(dropTargetAt(45, ROWS)).toEqual({ kind: 'intoArea', areaId: CRATERIA })
  })

  // A room row has no "drop into" of its own: rooms do not contain rooms, and a
  // third meaning in the middle would make the two useful ones harder to hit.
  it('splits a room row down the middle into before and after', () => {
    expect(dropTargetAt(20, ROWS)).toEqual({ kind: 'beside', roomId: A, after: false })
    expect(dropTargetAt(29, ROWS)).toEqual({ kind: 'beside', roomId: A, after: false })
    expect(dropTargetAt(30, ROWS)).toEqual({ kind: 'beside', roomId: A, after: true })
    expect(dropTargetAt(39, ROWS)).toEqual({ kind: 'beside', roomId: A, after: true })
  })

  it('finds nothing above or below the rows', () => {
    expect(dropTargetAt(-5, ROWS)).toBeNull()
    expect(dropTargetAt(100, ROWS)).toBeNull()
    expect(dropTargetAt(10, [])).toBeNull()
  })
})

describe('planDrop', () => {
  it('appends to the end of the area dropped on', () => {
    // `a` moving into Crateria lands after `c`. Counted without `a`, that is
    // index 2 of [b, c].
    expect(planDrop({ kind: 'intoArea', areaId: CRATERIA }, A, ORDER, areaOf)).toEqual({
      areaId: CRATERIA,
      toIndex: 2,
    })
  })

  it('leaves the order alone for an area with nothing else in it', () => {
    const empty = 'empty' as AreaId
    expect(planDrop({ kind: 'intoArea', areaId: empty }, A, ORDER, areaOf)).toEqual({
      areaId: empty,
      toIndex: null,
    })
  })

  // The index is measured with the dragged room already removed, because that
  // is what `reorderRoom` does before inserting. Counted with it still in
  // place, every forward move is off by one.
  it('counts the target index without the dragged room', () => {
    // `a` after `b`: [b, c] with a removed, so index 1.
    expect(planDrop({ kind: 'beside', roomId: B, after: true }, A, ORDER, areaOf)).toEqual({
      areaId: CRATERIA,
      toIndex: 1,
    })
    // `c` before `b`: [a, b] with c removed, so index 1.
    expect(planDrop({ kind: 'beside', roomId: B, after: false }, C, ORDER, areaOf)).toEqual({
      areaId: CRATERIA,
      toIndex: 1,
    })
  })

  // The "both" case, stated once here rather than at two call sites.
  it('a cross-area insert carries the anchor’s area with it', () => {
    expect(planDrop({ kind: 'beside', roomId: B, after: false }, A, ORDER, areaOf)).toEqual({
      areaId: CRATERIA,
      toIndex: 0,
    })
  })

  it('refuses a drop on the room being dragged', () => {
    expect(planDrop({ kind: 'beside', roomId: A, after: true }, A, ORDER, areaOf)).toBeNull()
  })

  it('refuses an anchor that is not in the order', () => {
    const ghost = 'ghost' as RoomId
    expect(planDrop({ kind: 'beside', roomId: ghost, after: true }, A, ORDER, areaOf)).toBeNull()
  })
})
