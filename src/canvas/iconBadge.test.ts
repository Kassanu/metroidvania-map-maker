import { describe, it, expect, vi } from 'vitest'
import { ICON_VIEWBOX, PLATE_ROUNDED_SQUARE, UNKNOWN_ICON_ART, drawIconBadge } from './iconBadge'

function fakeContext() {
  const calls: string[] = []
  const filled: { style: string; path: unknown }[] = []
  const ctx = {
    fillStyle: '',
    save: vi.fn(() => calls.push('save')),
    restore: vi.fn(() => calls.push('restore')),
    translate: vi.fn((x: number, y: number) => calls.push(`translate ${x} ${y}`)),
    scale: vi.fn((x: number, y: number) => calls.push(`scale ${x} ${y}`)),
    fill: vi.fn((path: unknown) => {
      calls.push('fill')
      filled.push({ style: ctx.fillStyle, path })
    }),
  }
  return { ctx, calls, filled }
}

const ART = { plate: 'M0 0 H1 V1 Z', glyph: 'M2 2 H3 V3 Z' }
const COLORS = { plateColor: '#plate', glyphColor: '#glyph' }

describe('drawIconBadge', () => {
  it('positions and scales by transform, leaving the context as it found it', () => {
    const { ctx, calls } = fakeContext()

    drawIconBadge(ctx as unknown as CanvasRenderingContext2D, ART, COLORS, {
      x: 40,
      y: 12,
      size: 48,
    })

    expect(calls).toEqual([
      'save',
      'translate 40 12',
      `scale ${48 / ICON_VIEWBOX} ${48 / ICON_VIEWBOX}`,
      'fill',
      'fill',
      'restore',
    ])
  })

  it('fills the plate before the glyph', () => {
    const { ctx, filled } = fakeContext()

    drawIconBadge(ctx as unknown as CanvasRenderingContext2D, ART, COLORS, {
      x: 0,
      y: 0,
      size: 24,
    })

    expect(filled.map((call) => call.style)).toEqual(['#plate', '#glyph'])
  })

  it('reuses one Path2D per distinct path string', () => {
    const { ctx, filled } = fakeContext()
    const rect = { x: 0, y: 0, size: 24 }

    drawIconBadge(ctx as unknown as CanvasRenderingContext2D, ART, COLORS, rect)
    drawIconBadge(ctx as unknown as CanvasRenderingContext2D, ART, COLORS, rect)

    // Same path data, same object: constructing one per frame would build a
    // Path2D for every icon on screen on every pointer move.
    expect(filled[0].path).toBe(filled[2].path)
    expect(filled[1].path).toBe(filled[3].path)
  })

  it('keys the cache on the path data, not on the art object', () => {
    const { ctx, filled } = fakeContext()
    const rect = { x: 0, y: 0, size: 24 }

    drawIconBadge(ctx as unknown as CanvasRenderingContext2D, ART, COLORS, rect)
    // A distinct object carrying the same data: art replaced under an id it
    // already had must not keep drawing as whatever it was first, and the same
    // shape twice must not build the path twice.
    drawIconBadge(
      ctx as unknown as CanvasRenderingContext2D,
      { plate: ART.plate, glyph: 'M9 9 H9 Z' },
      COLORS,
      rect,
    )

    expect(filled[2].path).toBe(filled[0].path)
    expect(filled[3].path).not.toBe(filled[1].path)
  })

  it('gives the unknown-type fallback the standard plate and a hollow glyph', () => {
    // It has to read as a placeholder rather than as one of the real icons.
    expect(UNKNOWN_ICON_ART.plate).toBe(PLATE_ROUNDED_SQUARE)
    // Two sub-paths, the inner wound against the outer, so the plate shows
    // through the middle.
    expect(UNKNOWN_ICON_ART.glyph.match(/M/g)).toHaveLength(2)
  })
})
