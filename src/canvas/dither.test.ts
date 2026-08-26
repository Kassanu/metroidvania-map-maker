import { beforeEach, describe, expect, it } from 'vitest'
import { ditherFill, resetDitherCache } from './dither'
import { createRecordingContext, type PatternToken } from './testContext'
import { recordsOf } from '@/test-setup'
import { blend } from './color'
import { cellDevicePx, checkerSquarePx } from './devicePixels'

// The dither's fill, and the two questions it answers on the caller's behalf:
// which colours the checker is made of, and whether there is a checker at all.
//
// The tile is read back through the pattern token: `createPattern` records the
// canvas it was handed, and `recordsOf` answers what was drawn into it, so a
// test asserts on the tile's own pixels rather than on the fact that some
// pattern was made.

const LIGHT = '#BD0000'
const DARK = 'rgba(94, 0, 0, 1)'

// Comfortably above the floor: 64 device pixels a cell is 8 per square.
const BIG_CELL = 64

// A fresh recording context per call. Which context builds a pattern does not
// matter to the cache, which is why it is not part of the key, and a new one
// each time is what proves it.
function ctx() {
  return createRecordingContext().ctx as unknown as CanvasRenderingContext2D
}

function fill(overrides: Partial<Parameters<typeof ditherFill>[1]> = {}) {
  return ditherFill(ctx(), { light: LIGHT, dark: DARK, cell: BIG_CELL, dpr: 1, ...overrides })
}

function tileOf(pattern: unknown) {
  return (pattern as PatternToken).source as HTMLCanvasElement
}

// The tile's own `fillRect` calls, in the order they were made.
function tileFills(pattern: unknown) {
  return recordsOf(tileOf(pattern)).fills
}

// A distinct readable colour per index, six digits so it stays parseable.
const shade = (index: number) => `#0000${index.toString(16).padStart(2, '0')}`

beforeEach(resetDitherCache)

describe('the checker tile', () => {
  it('is two squares on a side, not one', () => {
    // One square on a side repeats to a solid colour.
    const tile = tileOf(fill())

    expect(checkerSquarePx(BIG_CELL)).toBe(8)
    expect([tile.width, tile.height]).toEqual([16, 16])
  })

  it('is a light ground with two dark squares diagonally opposite', () => {
    expect(tileFills(fill())).toEqual([
      { style: LIGHT, rect: [0, 0, 16, 16] },
      { style: DARK, rect: [0, 0, 8, 8] },
      { style: DARK, rect: [8, 8, 8, 8] },
    ])
  })

  it('repeats in both directions', () => {
    expect((fill() as unknown as PatternToken).repetition).toBe('repeat')
  })

  // The square is a device-pixel size, so the tile follows the cell rather than
  // anything the renderer's own transform does.
  it('sizes its square from the cell, in whole device pixels', () => {
    for (const [cell, square] of [
      [64, 8],
      [32, 4],
      [20, 3],
      [8, 1],
    ] as const) {
      resetDitherCache()
      expect(tileOf(fill({ cell })).width, `cell ${cell}`).toBe(square * 2)
    }
  })

  // Reachable: at a ratio of 0.25 a two-device-pixel cell clears the floor and
  // still rounds to nothing. A zero-size tile is not a pattern.
  it('never builds a tile with no area', () => {
    const tile = tileOf(fill({ cell: 2, dpr: 0.25 }))

    expect([tile.width, tile.height]).toEqual([2, 2])
  })
})

// Sixty-four squares per cell per frame is not viable on a flooded map, so the
// region is filled once with a pattern and the pattern is built once per colour
// pair and square size.
describe('the pattern cache', () => {
  it('answers the same object for the same pair and square', () => {
    expect(fill()).toBe(fill())
  })

  it('draws the tile once rather than redrawing it on every ask', () => {
    fill()
    fill()
    fill()

    // Three rects, not nine: a cache that kept the canvas but rebuilt its
    // contents would look identical from the outside otherwise.
    expect(tileFills(fill())).toHaveLength(3)
  })

  it('answers a different object for a different colour or square', () => {
    const base = fill()

    expect(fill({ light: '#00BD00' })).not.toBe(base)
    expect(fill({ dark: 'rgba(0, 94, 0, 1)' })).not.toBe(base)
    expect(fill({ cell: 32 })).not.toBe(base)
  })

  // The ratio is not part of the key. It decides which square size is asked for
  // and whether the floor fires, and a tile is device pixels either way, so two
  // ratios landing on one square want the same tile byte for byte.
  it('shares one entry between two ratios that round to the same square', () => {
    // A 32 CSS-pixel cell at ratio 2 is the same device cell as 64 at ratio 1.
    expect(cellDevicePx(32, 1, 2)).toBe(cellDevicePx(64, 1, 1))

    const retina = fill({ cell: cellDevicePx(32, 1, 2), dpr: 2 })
    const ordinary = fill({ cell: cellDevicePx(64, 1, 1), dpr: 1 })

    expect(retina).toBe(ordinary)
  })

  it('is bounded, and drops the oldest entry first', () => {
    const made = Array.from({ length: 32 }, (_, index) => fill({ light: shade(index) }))

    fill({ light: '#00ff00' })

    // The oldest is gone and rebuilds into a new object; the newest of the
    // batch is untouched.
    expect(fill({ light: shade(0) })).not.toBe(made[0])
    expect(fill({ light: shade(31) })).toBe(made[31])
  })

  // A hit must not reinsert, or the map's order stops being age and eviction
  // starts dropping whichever entry was asked for least recently instead.
  it('does not move an entry to the back when it is hit', () => {
    const made = Array.from({ length: 32 }, (_, index) => fill({ light: shade(index) }))

    // Touch the oldest, then overflow by one. Under insertion order the touch
    // changes nothing and the oldest still goes.
    expect(fill({ light: shade(0) })).toBe(made[0])
    fill({ light: '#00ff00' })

    expect(fill({ light: shade(0) })).not.toBe(made[0])
  })
})

// Below one CSS pixel per square the checker stops reading as a pattern, so it
// is replaced by the pattern's own average. This file decides that; no caller
// asks, which is what keeps the square size and the floor read in one place.
describe('the legibility floor', () => {
  it('answers the blend of the two colours below the floor', () => {
    expect(fill({ cell: 4, dpr: 1 })).toBe(blend(LIGHT, DARK))
  })

  it('builds no pattern at all below the floor', () => {
    const answer = fill({ cell: 4, dpr: 1 })

    expect(typeof answer).toBe('string')
    expect(answer).not.toHaveProperty('source')
  })

  // The blend is the checker's own average, so a room holds its tone as the
  // camera zooms through the floor: it stops being a texture, not a colour.
  it('answers a tone between the two rather than one of them', () => {
    const flat = fill({ cell: 4, dpr: 1 })

    expect(flat).not.toBe(LIGHT)
    expect(flat).not.toBe(DARK)
    expect(flat).toBe(blend(LIGHT, DARK))
  })

  // The floor is an apparent size, so it crosses at the same zoom on every
  // display rather than at half the apparent size on a retina one.
  it('crosses at the same zoom on every display', () => {
    // `tileSize` 32 either side of 25% zoom, which is the stated crossover.
    for (const dpr of [1, 2, 3]) {
      resetDitherCache()

      expect(typeof fill({ cell: cellDevicePx(32, 0.24, dpr), dpr }), `dpr ${dpr}`).toBe('string')
      expect(typeof fill({ cell: cellDevicePx(32, 0.26, dpr), dpr }), `dpr ${dpr}`).toBe('object')
    }
  })
})
