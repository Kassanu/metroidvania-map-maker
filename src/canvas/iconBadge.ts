// How an icon is drawn, in one place: a solid plate with a glyph on top, both
// filled, the glyph second so it reads over the plate.
//
// Every surface that shows an icon goes through here rather than reaching for
// the two paths itself, so widening what a badge is stays a change to one
// function.
//
// Art is SVG path data in a square viewBox of `ICON_VIEWBOX` units, which the
// caller's rect scales to. Paths are filled with the default non-zero winding
// rule, so a sub-path wound against its enclosing shape cuts a hole in it and
// the plate shows through.

import type { IconColors } from '@/core/ops/markup'

// The two fills of a badge, already resolved: an entry that leaves its plate
// to the registry default arrives here with that default filled in.
export interface IconArt {
  plate: string
  glyph: string
}

// Path data is authored against this square. Changing it silently rescales
// every icon in the registry.
export const ICON_VIEWBOX = 24

// The plate every icon uses unless its entry names another: a rounded square
// filling the viewBox with a unit of bleed left around it.
export const PLATE_ROUNDED_SQUARE =
  'M5 1 H19 A4 4 0 0 1 23 5 V19 A4 4 0 0 1 19 23 H5 A4 4 0 0 1 1 19 V5 A4 4 0 0 1 5 1 Z'

// What an `iconType` no registry entry claims draws as: a hollow frame, in the
// icon's own colours. It has to be unmistakably not one of the real icons,
// because its whole job is to say "something is here that this build does not
// recognise" for a project saved with an icon since renamed or removed.
//
// The inner square is wound against the outer one, so the plate shows through
// the middle.
export const UNKNOWN_ICON_ART: IconArt = {
  plate: PLATE_ROUNDED_SQUARE,
  glyph: 'M5 5 H19 V19 H5 Z M8 8 V16 H16 V8 Z',
}

// Constructed once per distinct path string and kept.
//
// Keyed by the path data rather than by icon id: art replaced under an id it
// already had would otherwise keep drawing as whatever it was first.
const paths = new Map<string, Path2D>()

function pathFor(data: string): Path2D {
  const existing = paths.get(data)
  if (existing) return existing
  const path = new Path2D(data)
  paths.set(data, path)
  return path
}

// `rect` is the square the badge fills, in CSS pixels.
// The plate alone, in one flat colour: the selection halo, which is the badge's
// own shape drawn wider and underneath it. Glyphless on purpose, because the
// badge paints back over the middle and only the rim is ever seen.
export function drawIconPlate(
  ctx: CanvasRenderingContext2D,
  art: IconArt,
  color: string,
  rect: { x: number; y: number; size: number },
): void {
  const scale = rect.size / ICON_VIEWBOX
  ctx.save()
  ctx.translate(rect.x, rect.y)
  ctx.scale(scale, scale)
  ctx.fillStyle = color
  ctx.fill(pathFor(art.plate))
  ctx.restore()
}

export function drawIconBadge(
  ctx: CanvasRenderingContext2D,
  art: IconArt,
  colors: IconColors,
  rect: { x: number; y: number; size: number },
): void {
  const scale = rect.size / ICON_VIEWBOX
  ctx.save()
  ctx.translate(rect.x, rect.y)
  ctx.scale(scale, scale)
  ctx.fillStyle = colors.plateColor
  ctx.fill(pathFor(art.plate))
  ctx.fillStyle = colors.glyphColor
  ctx.fill(pathFor(art.glyph))
  ctx.restore()
}
