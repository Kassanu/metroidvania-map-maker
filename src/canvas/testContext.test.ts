import { describe, it, expect } from 'vitest'
import { createRecordingContext } from './testContext'
import { recordsOf } from '@/test-setup'

// The double's own tests. Everything the rendering work will assert about a
// clip, a pattern or a derived colour reads through here, so a gap here is a
// rule that looks enforced and is not.

describe('the recording context', () => {
  describe('a path is recorded when it is consumed', () => {
    it('records the rectangle a clip was taken against', () => {
      const { ctx, clips } = createRecordingContext()

      ctx.beginPath()
      ctx.rect(10, 20, 30, 40)
      ctx.clip()

      expect(clips).toHaveLength(1)
      expect(clips[0].rects).toEqual([[10, 20, 30, 40]])
    })

    it('records the segments a clip was taken against', () => {
      const { ctx, clips } = createRecordingContext()

      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(5, 0)
      ctx.lineTo(5, 5)
      ctx.clip()

      expect(clips[0].segments).toEqual([
        [0, 0, 5, 0],
        [5, 0, 5, 5],
      ])
    })

    it('carries the fill rule, given either as the only argument or after a path', () => {
      const { ctx, clips } = createRecordingContext()

      ctx.clip('evenodd')
      ctx.clip({}, 'nonzero')

      expect(clips.map((clip) => clip.rule)).toEqual(['evenodd', 'nonzero'])
    })

    // Consuming empties the accumulator, so one path cannot be attributed to
    // two consumers. Without this a second clip re-reports the first's rect
    // and a test about the liquid region passes against the wrong shape.
    it('does not attribute one path to two consumers', () => {
      const { ctx, clips } = createRecordingContext()

      ctx.beginPath()
      ctx.rect(1, 2, 3, 4)
      ctx.clip()
      ctx.clip()

      expect(clips[0].rects).toEqual([[1, 2, 3, 4]])
      expect(clips[1].rects).toEqual([])
    })

    // The shape stroke assertions across the corpus already read.
    it('leaves a stroke reporting only its segments', () => {
      const { ctx, strokes, clips, pathFills } = createRecordingContext()

      ctx.strokeStyle = '#wall'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(1, 1)
      ctx.stroke()

      expect(strokes).toEqual([
        { style: '#wall', width: 2, dash: [], join: '', segments: [[0, 0, 1, 1]] },
      ])
      expect(clips).toHaveLength(0)
      expect(pathFills).toHaveLength(0)
    })
  })

  describe('a bare fill', () => {
    it('records its path and its style, and stays out of fills', () => {
      const { ctx, pathFills, fills } = createRecordingContext()

      ctx.fillStyle = '#water'
      ctx.beginPath()
      ctx.rect(0, 0, 8, 8)
      ctx.fill()

      expect(pathFills).toEqual([{ style: '#water', rects: [[0, 0, 8, 8]], segments: [] }])
      // `fills` is fillRect and nothing else: its entries are asserted with
      // toEqual across the corpus, which an extra shape would break.
      expect(fills).toHaveLength(0)
    })

    it('is told apart from a badge filling a Path2D', () => {
      const { ctx, pathFills, badges } = createRecordingContext()

      ctx.fill({ data: 'M0 0 H1 V1 Z' })

      expect(badges).toHaveLength(1)
      expect(pathFills).toHaveLength(0)
    })

    // A lone fill rule is a string, not a path.
    it('is told apart from a fill rule', () => {
      const { ctx, pathFills, badges } = createRecordingContext()

      ctx.fill('evenodd')

      expect(pathFills).toHaveLength(1)
      expect(badges).toHaveLength(0)
    })
  })

  describe('a pattern', () => {
    it('reaches a recorded fill, which says it was not a colour', () => {
      const { ctx, pathFills } = createRecordingContext()
      const tile = document.createElement('canvas')

      const pattern = ctx.createPattern(tile, 'repeat')
      ctx.fillStyle = pattern
      ctx.beginPath()
      ctx.rect(0, 0, 4, 4)
      ctx.fill()

      expect(typeof pathFills[0].style).not.toBe('string')
      expect(pathFills[0].style).toBe(pattern)
    })

    it('carries the canvas its tile was drawn into', () => {
      const { ctx, patterns } = createRecordingContext()
      const tile = document.createElement('canvas')

      ctx.createPattern(tile, 'repeat-x')

      expect(patterns).toEqual([{ source: tile, repetition: 'repeat-x' }])
    })

    // The whole reason the two doubles converged: a tile is drawn inside the
    // code under test, on a canvas the test never held, and its colours have
    // to be readable from the test that asserts on the map it was filled into.
    it('reads its two colours back through the canvas it names', () => {
      const { ctx } = createRecordingContext()
      const tile = document.createElement('canvas')

      const tileCtx = tile.getContext('2d')!
      tileCtx.fillStyle = '#light'
      tileCtx.fillRect(0, 0, 4, 4)
      tileCtx.fillStyle = '#dark'
      tileCtx.fillRect(4, 0, 4, 4)

      const pattern = ctx.createPattern(tile, 'repeat')

      expect(recordsOf(pattern.source as HTMLCanvasElement).fills).toEqual([
        { style: '#light', rect: [0, 0, 4, 4] },
        { style: '#dark', rect: [4, 0, 4, 4] },
      ])
    })
  })

  describe('one double on the getContext path', () => {
    it('answers the same context every time for one canvas', () => {
      const canvas = document.createElement('canvas')

      expect(canvas.getContext('2d')).toBe(canvas.getContext('2d'))
    })

    // What a component test relies on: it draws through the component and then
    // reaches the records by asking the element for its context.
    it('records what was drawn through a context fetched twice', () => {
      const canvas = document.createElement('canvas')

      canvas.getContext('2d')!.fillRect(0, 0, 2, 2)

      expect(recordsOf(canvas).fills).toEqual([{ style: '', rect: [0, 0, 2, 2] }])
    })

    it('keeps two canvases apart', () => {
      const one = document.createElement('canvas')
      const two = document.createElement('canvas')

      one.getContext('2d')!.fillRect(0, 0, 1, 1)

      expect(recordsOf(one).fills).toHaveLength(1)
      expect(recordsOf(two).fills).toHaveLength(0)
    })

    it('answers nothing for a context type jsdom has no business faking', () => {
      expect(document.createElement('canvas').getContext('webgl')).toBeNull()
    })
  })
})
