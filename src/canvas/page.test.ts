import { describe, it, expect } from 'vitest'
import { PAGE_HOME, PAGE_PADDING, pageBounds } from './page'
import type { CellBounds } from '@/core/derive/bounds'

// One `describe` per row of the page's state table, so a row nobody covered
// reads as a missing block rather than as nothing at all.

function contains(outer: CellBounds, inner: CellBounds): boolean {
  return (
    outer.minCol <= inner.minCol &&
    outer.minRow <= inner.minRow &&
    outer.maxCol >= inner.maxCol &&
    outer.maxRow >= inner.maxRow
  )
}

function box(minCol: number, minRow: number, maxCol: number, maxRow: number): CellBounds {
  return { minCol, minRow, maxCol, maxRow }
}

describe('the home rectangle', () => {
  it('is square, odd, and centred on the world origin', () => {
    const cols = PAGE_HOME.maxCol - PAGE_HOME.minCol + 1
    const rows = PAGE_HOME.maxRow - PAGE_HOME.minRow + 1
    expect(cols).toBe(rows)
    // Odd, so cell (0,0) is the middle cell rather than the cell down-right of
    // a middle vertex.
    expect(cols % 2).toBe(1)
    expect(PAGE_HOME.minCol + PAGE_HOME.maxCol).toBe(0)
    expect(PAGE_HOME.minRow + PAGE_HOME.maxRow).toBe(0)
  })
})

describe('an empty map', () => {
  it('is exactly the home rectangle', () => {
    expect(pageBounds(null)).toEqual(PAGE_HOME)
  })

  it('hands back a copy, so a caller cannot write through to the constant', () => {
    const page = pageBounds(null)
    page.minCol = 999
    expect(PAGE_HOME.minCol).toBe(-10)
  })
})

describe('content that fits inside home once padded', () => {
  it('leaves the page exactly at home, unmoved', () => {
    expect(pageBounds(box(0, 0, 1, 1))).toEqual(PAGE_HOME)
  })

  // The reported bug: this rectangle used to slide the page sideways, because
  // reaching a minimum size meant expanding around the content's own centre.
  it('does not move when the content moves within home', () => {
    const left = pageBounds(box(-8, -8, -7, -7))
    const right = pageBounds(box(7, 7, 8, 8))
    expect(left).toEqual(PAGE_HOME)
    expect(right).toEqual(PAGE_HOME)
  })
})

describe('content padded past one edge of home', () => {
  it('grows on that edge only', () => {
    const page = pageBounds(box(0, 0, 15, 1))
    expect(page.maxCol).toBe(15 + PAGE_PADDING)
    // The other three sides are still home's.
    expect(page.minCol).toBe(PAGE_HOME.minCol)
    expect(page.minRow).toBe(PAGE_HOME.minRow)
    expect(page.maxRow).toBe(PAGE_HOME.maxRow)
  })

  it('grows on a negative edge the same way', () => {
    const page = pageBounds(box(-15, 0, 1, 1))
    expect(page.minCol).toBe(-15 - PAGE_PADDING)
    expect(page.maxCol).toBe(PAGE_HOME.maxCol)
    expect(page.minRow).toBe(PAGE_HOME.minRow)
    expect(page.maxRow).toBe(PAGE_HOME.maxRow)
  })
})

describe('content padded past home on every side', () => {
  it('is exactly the padded content, and home contributes nothing', () => {
    expect(pageBounds(box(-50, -50, 50, 50))).toEqual(box(-52, -52, 52, 52))
  })
})

describe('content entirely disjoint from home', () => {
  // The accepted degenerate case: a map living far from the origin drags the
  // page across the gap, because the page always contains home.
  it('spans the gap rather than abandoning home', () => {
    const page = pageBounds(box(200, 200, 202, 202))
    expect(page).toEqual(box(PAGE_HOME.minCol, PAGE_HOME.minRow, 204, 204))
  })
})

// The two properties no single row states on its own.
describe('the union', () => {
  const contents: CellBounds[] = [
    box(0, 0, 0, 0),
    box(0, 0, 1, 1),
    box(-8, -8, 8, 8),
    box(-50, -50, 50, 50),
    box(200, 200, 202, 202),
    box(-300, 4, -290, 6),
  ]

  it('always contains home', () => {
    for (const content of contents) {
      expect(contains(pageBounds(content), PAGE_HOME)).toBe(true)
    }
  })

  it('always contains the padded content', () => {
    for (const content of contents) {
      const padded = box(
        content.minCol - PAGE_PADDING,
        content.minRow - PAGE_PADDING,
        content.maxCol + PAGE_PADDING,
        content.maxRow + PAGE_PADDING,
      )
      expect(contains(pageBounds(content), padded)).toBe(true)
    }
  })

  // Painting outward one step at a time: the page never loses a cell it had.
  it('is monotone as content grows', () => {
    const growing = [
      box(0, 0, 0, 0),
      box(0, 0, 4, 0),
      box(0, 0, 12, 0),
      box(0, -3, 12, 9),
      box(-20, -3, 12, 9),
      box(-20, -3, 12, 40),
    ]
    let previous = pageBounds(null)
    for (const content of growing) {
      const page = pageBounds(content)
      expect(contains(page, previous)).toBe(true)
      previous = page
    }
  })

  it('returns to exactly home when the content is erased away', () => {
    expect(pageBounds(box(-20, -3, 12, 40))).not.toEqual(PAGE_HOME)
    expect(pageBounds(null)).toEqual(PAGE_HOME)
  })
})
