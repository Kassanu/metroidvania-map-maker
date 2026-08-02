import { describe, expect, it } from 'vitest'
import { clamp } from './math'

describe('clamp', () => {
  it('passes through a value already inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('clamps to the bounds', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })

  it('includes the bounds themselves', () => {
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })

  it('handles fractional bounds', () => {
    expect(clamp(0.05, 0.1, 8)).toBeCloseTo(0.1)
  })
})
