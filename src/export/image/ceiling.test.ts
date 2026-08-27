import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CEILING_STEPS,
  FALLBACK_MAX_SIDE,
  imageCeiling,
  probeCeiling,
  withinCeiling,
} from './ceiling'

// The allocator is the argument precisely so every branch is reachable without
// a real bitmap. `upTo(n)` is a device that takes squares of side n and no more.
function upTo(limit: number) {
  return vi.fn((side: number) => side <= limit)
}

const LARGEST_STEP = CEILING_STEPS[CEILING_STEPS.length - 1]!

describe('probing the ceiling', () => {
  it('keeps the largest side that works, not the first', () => {
    expect(probeCeiling(upTo(4096)).maxSide).toBe(4096)
  })

  it('stops at the first failure rather than trying every step', () => {
    const canAllocate = upTo(2048)
    probeCeiling(canAllocate)
    expect(canAllocate.mock.calls.map(([side]) => side)).toEqual([16, 1024, 2048, 4096])
  })

  it('does not step past the top of the list', () => {
    expect(probeCeiling(upTo(Infinity)).maxSide).toBe(LARGEST_STEP)
  })

  // A device that takes the control and nothing above it. The answer is the
  // control's own side rather than zero, because something did allocate.
  it('answers what did work when even the smallest step fails', () => {
    expect(probeCeiling(upTo(16)).maxSide).toBe(16)
  })

  it('squares the side to get the pixel cap', () => {
    const ceiling = probeCeiling(upTo(4096))
    expect(ceiling.maxPixels).toBe(4096 * 4096)
  })

  // The control failing means the readback is lying rather than the allocation
  // failing: canvas readback can be blocked or noised independently of
  // allocation. Without this the answer would be "nothing allocates" and every
  // export would be refused forever.
  it('falls back rather than refusing everything when the control fails', () => {
    const canAllocate = upTo(0)
    expect(probeCeiling(canAllocate).maxSide).toBe(FALLBACK_MAX_SIDE)
    expect(canAllocate).toHaveBeenCalledTimes(1)
  })
})

describe('judging a request against the ceiling', () => {
  const ceiling = { maxSide: 4096, maxPixels: 4096 * 4096 }

  it('admits a request inside both caps', () => {
    expect(withinCeiling({ width: 4096, height: 4096 }, ceiling)).toBe(true)
  })

  // The case a pixel cap alone cannot catch: far under the area, far over every
  // engine's dimension limit, and a blank bitmap on all of them.
  it('refuses a side over the cap even when the area is far under it', () => {
    expect(withinCeiling({ width: 65536, height: 4 }, ceiling)).toBe(false)
  })

  // And the case a dimension cap alone cannot catch.
  it('refuses an area over the cap when both sides are under it', () => {
    expect(withinCeiling({ width: 4096, height: 4095 }, ceiling)).toBe(true)
    expect(
      withinCeiling({ width: 4000, height: 4000 }, { maxSide: 4096, maxPixels: 4000 * 4000 - 1 }),
    ).toBe(false)
  })
})

describe('the session ceiling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // jsdom's context has no `getImageData`, so the control probe cannot read
  // back and the measurement is unavailable. That is the same situation as a
  // browser blocking readback, and it must not brick the export.
  it('falls back where the readback is unavailable, and measures only once', () => {
    const createElement = vi.spyOn(document, 'createElement')

    expect(imageCeiling().maxSide).toBe(FALLBACK_MAX_SIDE)
    const afterFirst = createElement.mock.calls.length
    expect(afterFirst).toBeGreaterThan(0)

    expect(imageCeiling().maxSide).toBe(FALLBACK_MAX_SIDE)
    expect(createElement.mock.calls.length).toBe(afterFirst)
  })
})
