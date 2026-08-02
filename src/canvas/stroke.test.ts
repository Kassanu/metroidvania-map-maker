import { describe, it, expect } from 'vitest'
import { cellsAlong, type WorldPoint } from './stroke'
import { isAdjacent8, parseCell } from '@/core/cell'
import type { CellKey } from '@/core/cell'

function orthogonallyAdjacent(a: CellKey, b: CellKey): boolean {
  const first = parseCell(a)
  const second = parseCell(b)
  return Math.abs(first.x - second.x) + Math.abs(first.y - second.y) === 1
}

// A chain is usable as a stroke only if every step is a shared edge, not a
// shared corner: a corner step is what core would split into separate rooms.
function isConnectedChain(cells: CellKey[]): boolean {
  for (let i = 1; i < cells.length; i++) {
    if (!orthogonallyAdjacent(cells[i - 1], cells[i])) return false
  }
  return true
}

// Deterministic, so a failure is reproducible: the whole point of the
// property test below is that it explores segments nobody thought to write
// out.
function randomPoints(seed: number): () => WorldPoint {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    const x = (state / 2147483648) * 40 - 20
    state = (state * 1103515245 + 12345) % 2147483648
    const y = (state / 2147483648) * 40 - 20
    return { x, y }
  }
}

describe('cellsAlong', () => {
  it('is a single cell when both ends are in it', () => {
    expect(cellsAlong({ x: 0.2, y: 0.8 }, { x: 0.9, y: 0.1 })).toEqual(['0,0'])
  })

  it('walks a horizontal run in order', () => {
    expect(cellsAlong({ x: 0.5, y: 0.5 }, { x: 3.5, y: 0.5 })).toEqual(['0,0', '1,0', '2,0', '3,0'])
  })

  it('walks backwards just as well', () => {
    expect(cellsAlong({ x: 3.5, y: 0.5 }, { x: 0.5, y: 0.5 })).toEqual(['3,0', '2,0', '1,0', '0,0'])
  })

  it('handles negative space', () => {
    expect(cellsAlong({ x: -0.5, y: -1.5 }, { x: -0.5, y: 0.5 })).toEqual([
      '-1,-2',
      '-1,-1',
      '-1,0',
    ])
  })

  // The reason this is a supercover and not Bresenham. Bresenham would return
  // 0,0 / 1,1 / 2,2: a staircase, whose cells share only corners, which core
  // correctly refuses to treat as one room. A fast diagonal drag would then
  // have painted three rooms where a slow one painted a single connected room.
  it('returns a connected chain across a diagonal, never a staircase', () => {
    const cells = cellsAlong({ x: 0.5, y: 0.5 }, { x: 3.5, y: 3.5 })

    expect(isConnectedChain(cells)).toBe(true)
    expect(cells).not.toEqual(['0,0', '1,1', '2,2', '3,3'])
    expect(cells[0]).toBe('0,0')
    expect(cells.at(-1)).toBe('3,3')
  })

  // Exactly through the corners: the degenerate case the tie-break exists
  // for. Taking neither adjacent cell would be the diagonal jump the whole
  // function exists to avoid, so it takes one, deterministically.
  it('steps through a corner rather than across it', () => {
    expect(cellsAlong({ x: 0, y: 0 }, { x: 2, y: 2 })).toEqual(['0,0', '1,0', '1,1', '2,1', '2,2'])
  })

  // A drag at speed: consecutive pointer samples land cells apart, and the
  // stroke has to fill in what the pointer flew over.
  it('fills in a long jump between two samples', () => {
    const cells = cellsAlong({ x: 0.5, y: 0.5 }, { x: 19.5, y: 4.5 })

    expect(isConnectedChain(cells)).toBe(true)
    expect(cells.length).toBeGreaterThan(19)
    expect(new Set(cells).size).toBe(cells.length)
  })

  it('holds those properties over arbitrary segments', () => {
    const next = randomPoints(20260727)

    for (let i = 0; i < 500; i++) {
      const from = next()
      const to = next()
      const cells = cellsAlong(from, to)

      expect(cells[0]).toBe(`${Math.floor(from.x)},${Math.floor(from.y)}`)
      expect(cells.at(-1)).toBe(`${Math.floor(to.x)},${Math.floor(to.y)}`)
      expect(isConnectedChain(cells)).toBe(true)
      // No cell twice: a straight segment cannot re-enter one, so a repeat
      // would mean the walk doubled back.
      expect(new Set(cells).size).toBe(cells.length)
    }
  })

  // Guards the guard: `isConnectedChain` has to be able to fail, or every
  // assertion above is vacuous.
  it('has a connectivity check that rejects a staircase', () => {
    expect(isConnectedChain(['0,0', '1,1'])).toBe(false)
    expect(isAdjacent8('0,0', '1,1')).toBe(true)
  })
})
