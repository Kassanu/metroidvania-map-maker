import { describe, expect, it } from 'vitest'
import type { CanvasPalette } from '@/canvas/palette'
import { exportPalette } from './palette'

const base = {
  pasteboard: '#111111',
  page: '#222222',
  grid: '#333333',
  roomFill: '#444444',
} as unknown as CanvasPalette

const OPAQUE_THEME = { kind: 'opaque', color: null } as const

describe('the background', () => {
  it('substitutes the chosen colour', () => {
    const palette = exportPalette(base, {
      background: { kind: 'opaque', color: '#abcdef' },
      gridColor: null,
    })
    expect(palette.page).toBe('rgba(171, 205, 239, 1)')
  })

  // The renderer fills the whole canvas with one of these and paints the page
  // over it, so replacing only one leaves an image in the other's colour.
  it('substitutes the pasteboard as well as the page', () => {
    const palette = exportPalette(base, {
      background: { kind: 'opaque', color: '#abcdef' },
      gridColor: null,
    })
    expect(palette.pasteboard).toBe(palette.page)
  })

  it('leaves the theme alone when no colour is pinned', () => {
    const palette = exportPalette(base, { background: OPAQUE_THEME, gridColor: null })
    expect(palette.page).toBe('#222222')
    expect(palette.pasteboard).toBe('#111111')
  })

  // `backgroundColor` is validated as hex and the loader accepts the 4- and
  // 8-digit forms, so the stored value may itself carry alpha. The opaque
  // option is opaque.
  it('composites an 8-digit colour at full opacity', () => {
    const palette = exportPalette(base, {
      background: { kind: 'opaque', color: '#abcdef80' },
      gridColor: null,
    })
    expect(palette.page).toBe('rgba(171, 205, 239, 1)')
  })

  it('composites a 4-digit colour at full opacity', () => {
    const palette = exportPalette(base, {
      background: { kind: 'opaque', color: '#1234' },
      gridColor: null,
    })
    expect(palette.page).toBe('rgba(17, 34, 51, 1)')
  })

  it('passes a colour it cannot read through unchanged', () => {
    const palette = exportPalette(base, {
      background: { kind: 'opaque', color: 'rebeccapurple' },
      gridColor: null,
    })
    expect(palette.page).toBe('rebeccapurple')
  })
})

describe('transparency', () => {
  // A colour rather than the `transparent` keyword, so `color.ts` can still
  // read it: a fill of nothing is what leaves the canvas clear.
  it('substitutes a fully transparent colour', () => {
    const palette = exportPalette(base, { background: { kind: 'transparent' }, gridColor: null })
    expect(palette.page).toBe('rgba(0, 0, 0, 0)')
  })

  it('substitutes the pasteboard as well as the page', () => {
    const palette = exportPalette(base, { background: { kind: 'transparent' }, gridColor: null })
    expect(palette.pasteboard).toBe('rgba(0, 0, 0, 0)')
  })
})

describe('the grid colour', () => {
  it('substitutes the pinned colour', () => {
    const palette = exportPalette(base, { background: OPAQUE_THEME, gridColor: '#00ff00' })
    expect(palette.grid).toBe('#00ff00')
  })

  // Substituted as given: a faint grid is a legitimate alpha, where a
  // see-through background is a different option with its own control.
  it('keeps a translucent grid translucent', () => {
    const palette = exportPalette(base, { background: OPAQUE_THEME, gridColor: '#00ff0033' })
    expect(palette.grid).toBe('#00ff0033')
  })

  it('leaves the theme alone when no colour is pinned', () => {
    const palette = exportPalette(base, { background: OPAQUE_THEME, gridColor: null })
    expect(palette.grid).toBe('#333333')
  })
})

describe('everything else', () => {
  it('comes from the theme, untouched', () => {
    const palette = exportPalette(base, {
      background: { kind: 'transparent' },
      gridColor: '#00ff00',
    })
    expect(palette.roomFill).toBe('#444444')
  })
})
