import { describe, it, expect } from 'vitest'
import { worldToScreen, screenToWorld } from './viewport'
import type { Camera } from './camera'

// A tile size deliberately not 32, the app's default, so a passing test
// proves this parameter reaches the maths rather than a hardcoded constant.
const TILE = 24

describe('viewport conversions', () => {
  const still: Camera = { pan: { x: 0, y: 0 }, zoom: 1 }

  it('places world (0,0) at the screen origin with no pan or zoom', () => {
    expect(worldToScreen(0, 0, still, TILE)).toEqual({ x: 0, y: 0 })
  })

  it('scales by the tile size at zoom 1', () => {
    expect(worldToScreen(2, 3, still, TILE)).toEqual({ x: 2 * TILE, y: 3 * TILE })
  })

  it('scales by tile size and zoom together', () => {
    const zoomed: Camera = { pan: { x: 0, y: 0 }, zoom: 2 }
    expect(worldToScreen(2, 3, zoomed, TILE)).toEqual({ x: 2 * TILE * 2, y: 3 * TILE * 2 })
  })

  // A doubled tile size at half the zoom is the same picture: neither value
  // has a privileged position, they compose as one scale factor.
  it('trades tile size against zoom', () => {
    const big: Camera = { pan: { x: 0, y: 0 }, zoom: 1 }
    const small: Camera = { pan: { x: 0, y: 0 }, zoom: 2 }
    expect(worldToScreen(3, 5, small, TILE)).toEqual(worldToScreen(3, 5, big, TILE * 2))
  })

  it('pan shifts the world coordinate that lands at the screen origin', () => {
    const camera: Camera = { pan: { x: 5, y: -2 }, zoom: 1 }
    // world (5, -2) is "at the camera", so it lands at screen (0, 0)
    expect(worldToScreen(5, -2, camera, TILE)).toEqual({ x: 0, y: 0 })
  })

  it('screenToWorld is the inverse of worldToScreen', () => {
    const camera: Camera = { pan: { x: -4, y: 7.5 }, zoom: 1.75 }
    const original = { x: 12, y: -6 }
    const screen = worldToScreen(original.x, original.y, camera, TILE)
    const back = screenToWorld(screen.x, screen.y, camera, TILE)
    expect(back.x).toBeCloseTo(original.x)
    expect(back.y).toBeCloseTo(original.y)
  })

  it('round-trips at a different tile size too', () => {
    const camera: Camera = { pan: { x: 2.5, y: -1 }, zoom: 0.6 }
    const screen = worldToScreen(7, 11, camera, 48)
    const back = screenToWorld(screen.x, screen.y, camera, 48)
    expect(back.x).toBeCloseTo(7)
    expect(back.y).toBeCloseTo(11)
  })
})
