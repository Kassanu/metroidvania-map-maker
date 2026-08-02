import { describe, it, expect } from 'vitest'
import { MIN_PAGE_COLS, MIN_PAGE_ROWS, PAGE_PADDING, pageBounds } from './page'

describe('pageBounds', () => {
  it('gives a blank map a minimum sheet to draw on', () => {
    const page = pageBounds(null)
    expect(page.maxCol - page.minCol + 1).toBe(MIN_PAGE_COLS)
    expect(page.maxRow - page.minRow + 1).toBe(MIN_PAGE_ROWS)
  })

  it('pads around small content and keeps it centred on the minimum sheet', () => {
    const page = pageBounds({ minCol: 0, minRow: 0, maxCol: 1, maxRow: 1 })
    expect(page.maxCol - page.minCol + 1).toBe(MIN_PAGE_COLS)
    // The 2x2 of content sits inside, not against a corner.
    expect(page.minCol).toBeLessThan(0)
    expect(page.maxCol).toBeGreaterThan(1)
  })

  it('grows with the content once it exceeds the minimum', () => {
    const page = pageBounds({ minCol: 0, minRow: 0, maxCol: 99, maxRow: 99 })
    expect(page.minCol).toBe(-PAGE_PADDING)
    expect(page.maxCol).toBe(99 + PAGE_PADDING)
    expect(page.minRow).toBe(-PAGE_PADDING)
    expect(page.maxRow).toBe(99 + PAGE_PADDING)
  })

  it('follows content into negative coordinates: the grid is unbounded', () => {
    const page = pageBounds({ minCol: -50, minRow: -30, maxCol: -40, maxRow: -20 })
    expect(page.minCol).toBeLessThanOrEqual(-50 - PAGE_PADDING)
    expect(page.maxRow).toBeGreaterThanOrEqual(-20 + PAGE_PADDING)
  })
})
