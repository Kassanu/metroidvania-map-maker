import { describe, it, expect } from 'vitest'
import { redistribute } from './resize'
import { PANEL_MIN_HEIGHT } from '@/config/constants'

describe('redistribute', () => {
  it('leaves the split alone when the pointer has not moved', () => {
    expect(redistribute(200, 200, 2, 0)).toEqual([1, 1])
  })

  it('always preserves the pair total, so no other panel is disturbed', () => {
    for (const dy of [-500, -60, 0, 25, 900]) {
      const [a, b] = redistribute(200, 200, 2, dy)
      expect(a + b).toBeCloseTo(2)
    }
  })

  it('converts a pixel delta into a proportional weight change', () => {
    // Dragging down 100px of a 400px pair moves a quarter of the weight.
    const [a, b] = redistribute(200, 200, 2, 100)
    expect(a).toBeCloseTo(1.5)
    expect(b).toBeCloseTo(0.5)
  })

  it('works from an uneven starting split', () => {
    const [a, b] = redistribute(100, 300, 4, 100)
    expect(a).toBeCloseTo(2) // 200 of 400px
    expect(b).toBeCloseTo(2)
  })

  it('stops at the minimum height rather than collapsing a panel', () => {
    const [a, b] = redistribute(200, 200, 2, -9999)
    expect(a).toBeCloseTo((2 * PANEL_MIN_HEIGHT) / 400)
    expect(b).toBeCloseTo(2 - (2 * PANEL_MIN_HEIGHT) / 400)
    expect(a).toBeGreaterThan(0)
  })

  it('applies the same floor to the other panel', () => {
    const [, b] = redistribute(200, 200, 2, 9999)
    expect(b).toBeCloseTo((2 * PANEL_MIN_HEIGHT) / 400)
    expect(b).toBeGreaterThan(0)
  })

  it('settles at the midpoint when the pair is too short for two minimums', () => {
    const tiny = PANEL_MIN_HEIGHT / 2
    const [a, b] = redistribute(tiny, tiny, 2, -9999)
    expect(a).toBeCloseTo(1)
    expect(b).toBeCloseTo(1)
  })

  it('does not divide by zero on a zero-height pair', () => {
    expect(redistribute(0, 0, 2, 50)).toEqual([1, 1])
  })
})
