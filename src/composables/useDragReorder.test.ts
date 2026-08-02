import { describe, it, expect } from 'vitest'
import { crossedReorderIndex } from './useDragReorder'

// The DOM half of this composable can't be meaningfully unit-tested. jsdom
// has no layout, so every getBoundingClientRect() is zeroes. Pulling the
// decision out as a pure function is what makes the interesting part testable.
// The wiring is covered by the TabBar/SidebarContainer component tests.
describe('crossedReorderIndex', () => {
  // Three items, 100px apart, dragging the first one.
  const candidates = [
    { index: 1, midpoint: 150 },
    { index: 2, midpoint: 250 },
  ]

  it('returns null while the pointer is short of every midpoint', () => {
    expect(crossedReorderIndex(120, 0, candidates)).toBeNull()
  })

  it("moves forward once the pointer passes a later item's midpoint", () => {
    expect(crossedReorderIndex(160, 0, candidates)).toBe(1)
  })

  it('takes the first crossing when several are past, so the move is one step at a time', () => {
    expect(crossedReorderIndex(400, 0, candidates)).toBe(1)
  })

  it("moves backward once the pointer falls below an earlier item's midpoint", () => {
    expect(crossedReorderIndex(140, 2, candidates)).toBe(1)
  })

  it('ignores items on the far side of the drag: no crossing, no move', () => {
    // Dragging index 1: index 2's midpoint is ahead, and the pointer is behind it.
    expect(crossedReorderIndex(200, 1, [{ index: 2, midpoint: 250 }])).toBeNull()
  })

  it('is a no-op with nothing to cross', () => {
    expect(crossedReorderIndex(999, 0, [])).toBeNull()
  })
})
