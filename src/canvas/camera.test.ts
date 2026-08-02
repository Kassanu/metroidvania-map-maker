import { describe, it, expect } from 'vitest'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_FACTOR,
  centerOn,
  clampZoom,
  panByScreen,
  steppedZoom,
  wheelZoom,
  zoomAt,
} from './camera'
import { screenToWorld, worldToScreen } from './viewport'

// Deliberately not 32, the real tile size, so a passing test proves the tile
// size actually reaches the maths rather than being hardcoded elsewhere.
const TILE = 24

const camera = { pan: { x: 0, y: 0 }, zoom: 1 }

describe('clampZoom', () => {
  it('holds the zoom inside its limits', () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM)
    expect(clampZoom(1000)).toBe(MAX_ZOOM)
    expect(clampZoom(2)).toBe(2)
  })
})

describe('steppedZoom', () => {
  it('steps by the zoom factor in each direction', () => {
    expect(steppedZoom(1, 1)).toBeCloseTo(ZOOM_FACTOR)
    expect(steppedZoom(1, -1)).toBeCloseTo(1 / ZOOM_FACTOR)
  })

  it('stops at the limits rather than stepping past them', () => {
    expect(steppedZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(steppedZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })
})

describe('zoomAt', () => {
  // The whole contract: whatever world point sat under the anchor before the
  // zoom is still under it afterwards.
  it('keeps the world point under the anchor fixed', () => {
    const anchor = { x: 300, y: 200 }
    const before = screenToWorld(anchor.x, anchor.y, camera, TILE)

    const zoomed = zoomAt(camera, 2.5, anchor, TILE)
    const after = screenToWorld(anchor.x, anchor.y, zoomed, TILE)

    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('holds the anchor fixed from an already panned and zoomed camera', () => {
    const start = { pan: { x: -4, y: -3 }, zoom: 1.75 }
    const anchor = { x: 512, y: 77 }
    const before = screenToWorld(anchor.x, anchor.y, start, TILE)

    const zoomed = zoomAt(start, 0.6, anchor, TILE)
    const after = screenToWorld(anchor.x, anchor.y, zoomed, TILE)

    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('anchoring on the origin is the same as scaling the pan about it', () => {
    const zoomed = zoomAt({ pan: { x: 2, y: 3 }, zoom: 1 }, 2, { x: 0, y: 0 }, TILE)
    expect(zoomed.pan).toEqual({ x: 2, y: 3 })
  })

  it('clamps, and still holds the anchor at the clamped zoom', () => {
    const anchor = { x: 100, y: 100 }
    const zoomed = zoomAt(camera, 9999, anchor, TILE)
    expect(zoomed.zoom).toBe(MAX_ZOOM)

    const before = screenToWorld(anchor.x, anchor.y, camera, TILE)
    const after = screenToWorld(anchor.x, anchor.y, zoomed, TILE)
    expect(after.x).toBeCloseTo(before.x)
  })
})

describe('wheelZoom', () => {
  it('zooms in on a negative delta and out on a positive one', () => {
    expect(wheelZoom(camera, -100, { x: 0, y: 0 }, TILE).zoom).toBeGreaterThan(1)
    expect(wheelZoom(camera, 100, { x: 0, y: 0 }, TILE).zoom).toBeLessThan(1)
  })

  it('keeps the pointer over the same world point', () => {
    const anchor = { x: 250, y: 180 }
    const before = screenToWorld(anchor.x, anchor.y, camera, TILE)
    const zoomed = wheelZoom(camera, -240, anchor, TILE)
    const after = screenToWorld(anchor.x, anchor.y, zoomed, TILE)

    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })
})

describe('panByScreen', () => {
  it('converts a pixel delta into cells at the current zoom', () => {
    const panned = panByScreen(camera, TILE * 2, TILE * 3, TILE)
    expect(panned.pan).toEqual({ x: 2, y: 3 })
  })

  it('moves half as far in world terms when zoomed 2x', () => {
    const panned = panByScreen({ pan: { x: 0, y: 0 }, zoom: 2 }, TILE * 2, 0, TILE)
    expect(panned.pan.x).toBeCloseTo(1)
  })

  it('tracks the pointer: the same world point stays under it', () => {
    const start = { pan: { x: 1, y: 1 }, zoom: 1.5 }
    const worldAtOrigin = screenToWorld(0, 0, start, TILE)

    const panned = panByScreen(start, -40, -25, TILE)
    const moved = worldToScreen(worldAtOrigin.x, worldAtOrigin.y, panned, TILE)

    expect(moved.x).toBeCloseTo(40)
    expect(moved.y).toBeCloseTo(25)
  })

  it('leaves the zoom alone', () => {
    expect(panByScreen(camera, 10, 10, TILE).zoom).toBe(1)
  })
})

describe('centerOn', () => {
  const viewport = { width: 800, height: 600 }

  it('puts the point in the middle of the viewport', () => {
    const centered = centerOn(camera, { x: 10, y: 4 }, viewport, TILE)
    const onScreen = worldToScreen(10, 4, centered, TILE)

    expect(onScreen.x).toBeCloseTo(viewport.width / 2)
    expect(onScreen.y).toBeCloseTo(viewport.height / 2)
  })

  // Zoomed in, half a viewport is fewer world cells, so a centring that worked
  // in world units alone would land the point off to one side at every zoom
  // but 1.
  it('still centres it when zoomed in, and does not change the zoom', () => {
    const zoomed = { pan: { x: 0, y: 0 }, zoom: 2.5 }
    const centered = centerOn(zoomed, { x: -3, y: 7 }, viewport, TILE)
    const onScreen = worldToScreen(-3, 7, centered, TILE)

    expect(centered.zoom).toBe(2.5)
    expect(onScreen.x).toBeCloseTo(viewport.width / 2)
    expect(onScreen.y).toBeCloseTo(viewport.height / 2)
  })
})
