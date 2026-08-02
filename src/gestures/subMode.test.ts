import { describe, it, expect } from 'vitest'
import { liveRows, visibleHandles, SUB_MODES } from './subMode'
import type { SubMode } from './subMode'

// One assertion per lock, written as the table rather than as derived claims:
// the one place the four rows are readable side by side.
describe('liveRows', () => {
  it('leaves everything live under Auto', () => {
    expect(liveRows('auto')).toEqual({ cells: true, resize: true, innerWall: true })
  })

  // Cells-only collapses to paint, grow, merge and erase; edge-runs grow (no
  // resize); vertices are inert. The cell gestures stay on, which is what
  // makes an edge-run press fall through and paint rather than doing nothing.
  it('keeps only the cell gestures under Cells-only', () => {
    expect(liveRows('cells')).toEqual({ cells: true, resize: false, innerWall: false })
  })

  // Only the edge-run row is live; other presses just set the active room.
  // Unlike Cells-only, the cell gestures go off entirely.
  it('keeps only the edge-run row under Resize-only', () => {
    expect(liveRows('resize')).toEqual({ cells: false, resize: true, innerWall: false })
  })

  it('keeps only the inner-wall rows under Vertex-only', () => {
    expect(liveRows('vertex')).toEqual({ cells: false, resize: false, innerWall: true })
  })

  // The property that makes it a filter: every lock is a subset of Auto, so no
  // lock can enable something the full table does not already allow.
  it('never enables a row Auto has switched off', () => {
    const auto = liveRows('auto')
    for (const mode of SUB_MODES) {
      const rows = liveRows(mode)
      for (const key of ['cells', 'resize', 'innerWall'] as const) {
        if (!auto[key]) expect(rows[key]).toBe(false)
      }
    }
  })

  it('answers for every lock the toolbar offers', () => {
    expect(SUB_MODES).toEqual(['auto', 'cells', 'resize', 'vertex'])
    for (const mode of SUB_MODES) expect(liveRows(mode)).toBeDefined()
  })
})

// When a lock is active, only that behaviour's handles show on the active
// room.
describe('visibleHandles', () => {
  it('shows both under Auto and neither under Cells-only', () => {
    expect(visibleHandles('auto')).toEqual({ runs: true, vertices: true })
    expect(visibleHandles('cells')).toEqual({ runs: false, vertices: false })
  })

  it('shows only the family its lock can reach', () => {
    expect(visibleHandles('resize')).toEqual({ runs: true, vertices: false })
    expect(visibleHandles('vertex')).toEqual({ runs: false, vertices: true })
  })

  // The invariant behind deriving this from `liveRows` rather than listing it
  // again: a handle is drawn exactly when a press on it would do something.
  // Getting these out of step is how you end up with a handle that ignores you.
  it('draws a handle exactly when its row is live', () => {
    for (const mode of SUB_MODES as readonly SubMode[]) {
      const rows = liveRows(mode)
      const shown = visibleHandles(mode)
      expect(shown.runs).toBe(rows.resize)
      expect(shown.vertices).toBe(rows.innerWall)
    }
  })
})
