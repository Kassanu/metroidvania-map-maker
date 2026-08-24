import { describe, it, expect } from 'vitest'
import {
  SQUARES_PER_CELL,
  cellDevicePx,
  checkerSquarePx,
  flattensToBlend,
  snapToDevicePixel,
} from './devicePixels'

describe('cellDevicePx', () => {
  it('composes the tile size, the zoom and the ratio', () => {
    expect(cellDevicePx(32, 1, 1)).toBe(32)
    expect(cellDevicePx(32, 1, 2)).toBe(64)
    expect(cellDevicePx(32, 0.5, 2)).toBe(32)
  })
})

describe('checkerSquarePx', () => {
  it('is an eighth of the cell, in whole device pixels', () => {
    expect(checkerSquarePx(64)).toBe(8)
    expect(checkerSquarePx(32)).toBe(4)
  })

  it('rounds between round zooms rather than carrying a fraction', () => {
    expect(checkerSquarePx(40)).toBe(5)
    expect(checkerSquarePx(44)).toBe(6)
    expect(checkerSquarePx(43)).toBe(5)
  })

  // The same cell is twice as many device pixels on a retina display, so the
  // square doubles and the apparent size holds.
  it('doubles with the ratio for one apparent cell size', () => {
    expect(checkerSquarePx(cellDevicePx(32, 1, 1))).toBe(4)
    expect(checkerSquarePx(cellDevicePx(32, 1, 2))).toBe(8)
  })

  // Reachable, not defensive. Rounding reaches zero below half a device pixel
  // a square, and the floor still passes a cell that small when the ratio is
  // smaller still: browser zoom bottoms out at 25%, which is a ratio of 0.25 on
  // an ordinary display. Unclamped, createPattern gets a tile with no area.
  it('never rounds down to nothing', () => {
    const cell = cellDevicePx(32, 0.25, 0.25)
    expect(cell).toBe(2)
    expect(flattensToBlend(cell, 0.25)).toBe(false)
    expect(Math.round(cell / SQUARES_PER_CELL)).toBe(0)
    expect(checkerSquarePx(cell)).toBe(1)
  })
})

describe('flattensToBlend', () => {
  it('flattens once a square would be under one CSS pixel', () => {
    // Eight device pixels a cell is one device pixel a square, which is one CSS
    // pixel at ratio 1 and half of one at ratio 2.
    expect(flattensToBlend(8, 1)).toBe(false)
    expect(flattensToBlend(8, 2)).toBe(true)
    expect(flattensToBlend(16, 2)).toBe(false)
  })

  // The ratio cancels out of `tileSize * zoom * dpr / 8 < dpr`, which is the
  // whole reason the floor is stated in CSS pixels: the crossover is a property
  // of the zoom, not of the monitor the window happens to be on.
  it('crosses over at the same zoom on every display', () => {
    for (const dpr of [1, 1.5, 2, 3]) {
      expect(flattensToBlend(cellDevicePx(32, 0.24, dpr), dpr)).toBe(true)
      expect(flattensToBlend(cellDevicePx(32, 0.26, dpr), dpr)).toBe(false)
    }
  })

  it('puts that crossover at 25% for the default tile size', () => {
    expect(flattensToBlend(cellDevicePx(32, 0.25, 2), 2)).toBe(false)
    expect(flattensToBlend(cellDevicePx(32, 0.2499, 2), 2)).toBe(true)
  })

  // A larger tile crosses over at a smaller zoom: what the floor measures is
  // the square's apparent size, not the zoom percentage.
  it('follows the tile size, not the zoom alone', () => {
    expect(flattensToBlend(cellDevicePx(64, 0.25, 1), 1)).toBe(false)
    expect(flattensToBlend(cellDevicePx(16, 0.25, 1), 1)).toBe(true)
  })
})

describe('snapToDevicePixel', () => {
  it('leaves a coordinate already on the grid alone', () => {
    expect(snapToDevicePixel(10, 1)).toBe(10)
    expect(snapToDevicePixel(10.5, 2)).toBe(10.5)
  })

  it('moves a fractional coordinate to the nearest whole device pixel', () => {
    expect(snapToDevicePixel(10.4, 1)).toBe(10)
    expect(snapToDevicePixel(10.6, 1)).toBe(11)
    // At ratio 2 the grid is every half CSS pixel, so this one has less to move.
    expect(snapToDevicePixel(10.4, 2)).toBe(10.5)
  })

  it('answers in CSS pixels, so a renderer can use it where it stands', () => {
    expect(snapToDevicePixel(10.3, 4)).toBe(10.25)
  })

  it('snaps a negative coordinate the same way', () => {
    expect(snapToDevicePixel(-10.4, 1)).toBe(-10)
    expect(snapToDevicePixel(-10.6, 1)).toBe(-11)
  })
})

// The renderer is handed the display; it never asks for it. A module that reads
// `window` renders differently under test than it does in the app, and cannot
// be driven to a second ratio at all.
//
// `document` is not part of this: `palette.ts` resolves the theme through
// `getComputedStyle`, which is the one deliberate DOM read under this folder and
// a different concern from the display's geometry.
describe('the renderer takes the display as an argument', () => {
  const sources = import.meta.glob('/src/canvas/**/*.ts', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>

  const production = Object.entries(sources).filter(([path]) => !path.endsWith('.test.ts'))

  it('reads no window and no global from anywhere under src/canvas', () => {
    const offenders = production
      .filter(([, text]) => /\b(window|globalThis)\s*\./.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('is looking at the whole folder, not an empty glob', () => {
    expect(production.length).toBeGreaterThan(15)
    expect(production.map(([path]) => path)).toContain('/src/canvas/devicePixels.ts')
  })
})
