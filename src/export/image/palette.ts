// The export's background and grid colours, substituted into a theme's palette.
//
// Both substitute rather than being drawn separately, because neither is a
// renderer concern: `fillStyle = 'transparent'` composites nothing, so
// transparency is a colour like any other, and the project's background colour
// lands in exactly the same place.
//
// Both `page` and `pasteboard` are substituted. The renderer fills the whole
// canvas with one of them and paints the page over it, so replacing only one
// yields an image in the other's colour. An export sets `showPage` false and so
// reads only `page` today; substituting both is what keeps that a presentation
// flag rather than a thing this file has to know.

import { parseColor, toRgbaString } from '@/canvas/color'
import type { CanvasPalette } from '@/canvas/palette'

// Null means the theme's own colour, which is how a fresh project's unset
// `settings.backgroundColor` reaches here.
export type ExportBackground = { kind: 'opaque'; color: string | null } | { kind: 'transparent' }

export interface ExportPaletteOptions {
  background: ExportBackground
  // `settings.gridColor`, or null for the theme's. Substituted as given: a
  // faint grid is a legitimate alpha, where a see-through background is a
  // different option with its own control.
  gridColor: string | null
}

const TRANSPARENT = toRgbaString({ r: 0, g: 0, b: 0, a: 0 })

export function exportPalette(base: CanvasPalette, options: ExportPaletteOptions): CanvasPalette {
  const background = backgroundColor(options.background)
  return {
    ...base,
    ...(background === null ? {} : { page: background, pasteboard: background }),
    ...(options.gridColor === null ? {} : { grid: options.gridColor }),
  }
}

// Null where the theme's own colour stands.
function backgroundColor(background: ExportBackground): string | null {
  if (background.kind === 'transparent') return TRANSPARENT
  if (background.color === null) return null
  return opaque(background.color)
}

// The opaque option is opaque. `backgroundColor` is validated as hex and the
// loader accepts the 4- and 8-digit forms, so the stored value may itself carry
// alpha, and a translucent background composites the pasteboard through itself
// in a format whose descriptor may say it carries no transparency at all.
//
// A colour this cannot parse passes through unchanged, as everywhere else that
// reads one: it paints as itself rather than as `NaN`.
function opaque(color: string): string {
  const parsed = parseColor(color)
  return parsed === null ? color : toRgbaString({ ...parsed, a: 1 })
}
