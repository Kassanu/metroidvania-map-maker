import { describe, expect, it } from 'vitest'
import { HEAT_LIGHTEN_K, lighten, parseColor, toRgbaString } from './color'

// Read a channel back out of what `lighten` answers, so a test asserts on
// numbers rather than on the shape of a string.
function channels(rgba: string): [number, number, number, number] {
  const match = /^rgba\((-?[\d.]+), (-?[\d.]+), (-?[\d.]+), ([\d.]+)\)$/.exec(rgba)
  if (!match) throw new Error(`not an rgba string: ${rgba}`)
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])]
}

describe('parseColor', () => {
  it('reads the four hex lengths a colour picker emits', () => {
    expect(parseColor('#123456')).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 1 })
    expect(parseColor('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    // Each digit doubled, which is the CSS rule: #123 is #112233, not #120000.
    expect(parseColor('#123')).toEqual({ r: 0x11, g: 0x22, b: 0x33, a: 1 })
    expect(parseColor('#1234')).toEqual({ r: 0x11, g: 0x22, b: 0x33, a: 0x44 / 255 })
    expect(parseColor('#12345678')).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 0x78 / 255 })
  })

  it('answers null for anything that is not one of them', () => {
    for (const text of ['', '#', '#12', '#12345', 'red', 'rgb(1, 2, 3)', 'var(--x)', '#12345g']) {
      expect(parseColor(text), text).toBeNull()
    }
  })
})

describe('lighten', () => {
  // The reference's own pair. #BD0000 and #FF6262 differ in lightness alone,
  // 37.1% to 69.2%, which is k = 0.51; 0.5 is that rounded, so this lands two
  // or three points short of the game's own fill and nothing else moves.
  //
  // The green and blue channels come out at exactly 94.5 and round up, which
  // `Math.round` does by breaking half away from zero. Stated because it is a
  // rounding edge: 189/255 halved is exact in binary, so the .5 is real rather
  // than an artefact one more operation could move either way.
  it('lightens the reference fill to within a few points of the reference', () => {
    expect(lighten('#BD0000')).toBe('rgba(255, 95, 95, 1)')

    const [r, g, b] = channels(lighten('#BD0000'))
    expect(r).toBe(0xff)
    expect(Math.abs(g - 0x62)).toBeLessThanOrEqual(4)
    expect(g).toBe(b)
  })

  it('holds hue and saturation, moving lightness alone', () => {
    // A mix toward white raises the low channels faster than the high one and
    // drains the saturation out; an HSL move keeps both ratios.
    const before = parseColor('#123456')!
    const [r, g, b] = channels(lighten('#123456'))

    // Within half a degree, which is as close as two colours quantised to
    // eight bits a channel can be asked to agree.
    const hue = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const span = Math.max(r, g, b) - Math.min(r, g, b)
      if (b >= r && b >= g) return 60 * ((r - g) / span + 4)
      return g >= r ? 60 * ((b - r) / span + 2) : 60 * (((g - b) / span + 6) % 6)
    }
    expect(hue({ r, g, b })).toBeCloseTo(hue(before), 0)

    const saturation = (c: { r: number; g: number; b: number }) => {
      const max = Math.max(c.r, c.g, c.b) / 255
      const min = Math.min(c.r, c.g, c.b) / 255
      return (max - min) / (1 - Math.abs(max + min - 1))
    }
    expect(saturation({ r, g, b })).toBeCloseTo(saturation(before), 2)
  })

  it('holds alpha rather than flattening it', () => {
    // A translucent area would otherwise go opaque only when heated, which is
    // the transform changing two things at once.
    expect(channels(lighten('#12345680'))[3]).toBeCloseTo(0x80 / 255, 10)
    expect(channels(lighten('#12345600'))[3]).toBe(0)
    expect(channels(lighten('#123456'))[3]).toBe(1)
  })

  it('moves the fraction of the distance remaining that it is given', () => {
    // k = 0 changes nothing and k = 1 reaches the endpoint exactly, which is
    // what makes everything between them a fraction of what is left.
    expect(lighten('#123456', 0)).toBe('rgba(18, 52, 86, 1)')
    expect(lighten('#123456', 1)).toBe('rgba(255, 255, 255, 1)')

    // Half of what a grey has left is the midpoint between it and white. An odd
    // channel value on purpose: `(g + 255) / 2` lands on a half for every even
    // one, and a rounding edge here would be testing `Math.round` rather than
    // the move.
    expect(lighten('#414141', 0.5)).toBe('rgba(160, 160, 160, 1)')
  })

  it('cannot clip, because there is always distance left to take a fraction of', () => {
    // A move in absolute lightness points would put all three of these at white
    // and lose the differences between them.
    const [near, nearer, nearest] = ['#f0f0f0', '#f8f8f8', '#fcfcfc'].map(
      (css) => channels(lighten(css))[0],
    )

    expect(nearest).toBeLessThan(255)
    expect(near).toBeLessThan(nearer!)
    expect(nearer).toBeLessThan(nearest!)
  })

  it('lightens white to white and black to grey', () => {
    expect(lighten('#ffffff')).toBe('rgba(255, 255, 255, 1)')
    expect(lighten('#000000')).toBe('rgba(128, 128, 128, 1)')
  })

  it('answers a colour it cannot read unchanged', () => {
    // Painting `rgba(NaN, ...)` would take the room's fill with it; painting the
    // colour it was handed loses only the effect.
    expect(lighten('color-mix(in srgb, red, blue)')).toBe('color-mix(in srgb, red, blue)')
    expect(lighten('rebeccapurple')).toBe('rebeccapurple')
  })

  it('defaults to the heat constant', () => {
    expect(lighten('#123456')).toBe(lighten('#123456', HEAT_LIGHTEN_K))
    expect(HEAT_LIGHTEN_K).toBe(0.5)
  })
})

describe('toRgbaString', () => {
  it('rounds the channels here rather than leaving them to the browser', () => {
    // What lets an e2e probe assert an exact triple: the painted pixel is a
    // value this module decided, not one two engines each round their own way.
    expect(toRgbaString({ r: 94.5, g: 0.4, b: 254.6, a: 1 })).toBe('rgba(95, 0, 255, 1)')
  })
})
