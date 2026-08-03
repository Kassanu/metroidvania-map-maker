import { describe, it, expect, vi } from 'vitest'
import { RULER_THICKNESS, renderRuler, visibleCellRange, type RulerScene } from './renderRuler'
// Kept at the app default here, because this file's numbers are built around
// "320px of ruler is 10 cells". Lengths are written as multiples of it so the
// arithmetic stays true if it changes, and the last test below drives a
// different tile size explicitly.
const TILE = 32
import type { CanvasPalette } from './palette'

function fakeContext() {
  const labels: { text: string; x: number; y: number }[] = []
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    fillText: vi.fn((text: string, x: number, y: number) => labels.push({ text, x, y })),
  }
  return { ctx, labels }
}

const palette: CanvasPalette = {
  pasteboard: '#pasteboard',
  page: '#page',
  grid: '#grid',
  ruler: '#ruler',
  rulerTick: '#tick',
  rulerText: '#text',
  roomFill: '#roomfill',
  roomWall: '#roomwall',
  transition: '#transition',
  teleportLine: '#teleportline',
  markerText: '#markertext',
  labelPlate: '#labelplate',
  labelText: '#labeltext',
  absorb: '#absorb',
  refuse: '#refuse',
  brush: '#brush',
  handle: '#handle',
  handleHover: '#handlehover',
  selection: '#selection',
  marquee: '#marquee',
  marqueeFill: '#marqueefill',
}

function scene(overrides: Partial<RulerScene> = {}): RulerScene {
  return {
    axis: 'x',
    length: TILE * 10,
    camera: { pan: { x: 0, y: 0 }, zoom: 1 },
    tileSize: TILE,
    palette,
    units: 'cells',
    ...overrides,
  }
}

describe('visibleCellRange', () => {
  it('covers the cells on screen, including the partial ones at each end', () => {
    expect(visibleCellRange('x', TILE * 10, { pan: { x: 0, y: 0 }, zoom: 1 }, TILE)).toEqual([
      0, 10,
    ])
  })

  it('follows the camera into negative world space', () => {
    expect(visibleCellRange('x', TILE * 10, { pan: { x: -4, y: 0 }, zoom: 1 }, TILE)).toEqual([
      -4, 6,
    ])
  })

  it('covers more cells as the view zooms out', () => {
    const [first, last] = visibleCellRange('x', TILE * 10, { pan: { x: 0, y: 0 }, zoom: 0.5 }, TILE)
    expect(last - first).toBe(20)
  })

  // Bigger tiles mean fewer cells fit in the same strip of screen: the one
  // assertion that fails if the tile size stops reaching the conversion.
  it('fits fewer cells in the same length at a larger tile size', () => {
    const [first, last] = visibleCellRange(
      'x',
      TILE * 10,
      { pan: { x: 0, y: 0 }, zoom: 1 },
      TILE * 2,
    )
    expect(last - first).toBe(5)
  })

  it('reads the vertical extent on the y axis', () => {
    expect(visibleCellRange('y', TILE * 10, { pan: { x: 99, y: -2 }, zoom: 1 }, TILE)).toEqual([
      -2, 8,
    ])
  })
})

describe('renderRuler', () => {
  it('labels only the major ticks', () => {
    const { ctx, labels } = fakeContext()
    renderRuler(ctx as unknown as CanvasRenderingContext2D, scene())

    // Cells 0..10 visible, every 5th labelled.
    expect(labels.map((l) => l.text)).toEqual(['0', '5', '10'])
  })

  it('labels in pixels when the unit is px', () => {
    const { ctx, labels } = fakeContext()
    renderRuler(ctx as unknown as CanvasRenderingContext2D, scene({ units: 'px' }))

    expect(labels.map((l) => l.text)).toEqual(['0', String(5 * TILE), String(10 * TILE)])
  })

  it('ticks every visible cell', () => {
    const { ctx } = fakeContext()
    renderRuler(ctx as unknown as CanvasRenderingContext2D, scene())

    expect(ctx.moveTo).toHaveBeenCalledTimes(11) // cells 0..10
  })

  it('fills its background across the ruler thickness', () => {
    const { ctx } = fakeContext()
    renderRuler(ctx as unknown as CanvasRenderingContext2D, scene())

    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 320, RULER_THICKNESS)
  })

  it('runs the other way on the y axis', () => {
    const { ctx } = fakeContext()
    renderRuler(ctx as unknown as CanvasRenderingContext2D, scene({ axis: 'y' }))

    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, RULER_THICKNESS, 320)
    // Vertical labels are rotated into place.
    expect(ctx.rotate).toHaveBeenCalled()
    expect(ctx.save).toHaveBeenCalledTimes(ctx.restore.mock.calls.length)
  })

  it('labels negative cells once the camera pans past the origin', () => {
    const { ctx, labels } = fakeContext()
    renderRuler(
      ctx as unknown as CanvasRenderingContext2D,
      scene({ camera: { pan: { x: -6, y: 0 }, zoom: 1 } }),
    )

    expect(labels.map((l) => l.text)).toContain('-5')
  })
})
