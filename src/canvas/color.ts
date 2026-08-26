// The lightness transform heat and liquid derive their colours from, and the
// only place in the app that parses a colour.
//
// Four things here are load-bearing:
//
//   * The move is HSL lightness alone, holding hue, saturation and alpha. A mix
//     toward white desaturates, and dropping alpha would make a translucent
//     area opaque only when heated: either is the transform changing two things
//     at once.
//   * It is a fraction of the distance remaining to the endpoint, so it cannot
//     clip. A pale colour still lightens where a move in absolute lightness
//     points would hit the ceiling and go white.
//   * Input is hex, in the four lengths a colour picker emits. That is the only
//     form that reaches it: an area's colour is validated hex on the way in from
//     a file, and the theme's fallbacks are hex declarations. `color.test.ts`
//     reads `style.css` and holds them to it, because jsdom never loads the
//     stylesheet and no other unit test can see a declaration change form.
//   * Output is `rgba()` with the channels rounded here rather than `hsl()` left
//     for the browser. A painted pixel is then a value this file decided, which
//     is what lets an e2e probe assert an exact triple across two engines.
//
// Unparseable input comes back unchanged, so a colour this cannot read paints
// as itself rather than as `NaN`.

// Channels are 0-255 and alpha is 0-1, matching what `rgba()` takes.
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

// Hue in degrees, saturation and lightness as 0-1 rather than percentages: the
// transform's constant is a fraction, so keeping lightness a fraction too means
// the formula reads as the spec writes it.
interface Hsla {
  h: number
  s: number
  l: number
  a: number
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

export function parseColor(css: string): Rgba | null {
  const text = css.trim()
  if (!HEX.test(text)) return null

  const digits = text.slice(1)
  // The 3- and 4-digit forms are the 6- and 8-digit ones with each digit
  // doubled, which is the CSS rule and not an approximation of it.
  const wide = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits
  const channel = (index: number) => parseInt(wide.slice(index * 2, index * 2 + 2), 16)

  return {
    r: channel(0),
    g: channel(1),
    b: channel(2),
    a: wide.length === 8 ? channel(3) / 255 : 1,
  }
}

export function toRgbaString(color: Rgba): string {
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${color.a})`
}

// The heat constant, and the reference's own value rounded: Norfair's `#BD0000`
// and `#FF6262` share hue and saturation exactly and differ in lightness alone,
// 37.1% to 69.2%, which is k = 0.51.
//
// App-level rather than per project or per area. It is one person's preference
// about how strong the effect reads on their screen, in the same class as a
// theme, and it stays a constant until there is a settings surface to hold it.
export const HEAT_LIGHTEN_K = 0.5

export function lighten(css: string, k: number = HEAT_LIGHTEN_K): string {
  const rgba = parseColor(css)
  if (rgba === null) return css

  const hsla = rgbToHsl(rgba)
  return toRgbaString(hslToRgb({ ...hsla, l: hsla.l + (1 - hsla.l) * k }))
}

function rgbToHsl({ r, g, b, a }: Rgba): Hsla {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const span = max - min
  const l = (max + min) / 2

  // A grey has no hue to hold, and the saturation divisor is zero there.
  if (span === 0) return { h: 0, s: 0, l, a }

  const s = span / (1 - Math.abs(2 * l - 1))
  const h =
    max === red
      ? 60 * (((green - blue) / span + 6) % 6)
      : max === green
        ? 60 * ((blue - red) / span + 2)
        : 60 * ((red - green) / span + 4)

  return { h, s, l, a }
}

function hslToRgb({ h, s, l, a }: Hsla): Rgba {
  const chroma = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    return (l - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255
  }
  return { r: channel(0), g: channel(8), b: channel(4), a }
}
