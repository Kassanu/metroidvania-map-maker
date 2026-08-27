// A scene to bytes, through a detached canvas.
//
// Every failure mode this feature can produce lives here, and all of them look
// like success from the outside: a blank bitmap saves like a picture, and PNG
// bytes in a `.webp` file open like a picture. So both are checked and neither
// is recovered from.
//
// Nothing here names a format. The descriptor carries the media type and the
// encode quality, and this file branches on those alone, which is what makes
// adding a format one table entry.
//
// The canvas is released before returning, on every path. Twenty ticked tabs
// render one at a time and must not hold twenty bitmaps at once.

import { renderMap, type MapScene } from '@/canvas/renderMap'
import type { Refused } from '@/core/outcome'
import { imageCeiling, withinCeiling } from './ceiling'
import { imageSize } from './scene'
import type { ImageFormat } from './formats'

// Not entries in the app-wide `RefusalReason`, whose contract is one translated
// message per reason for something the user did. These are four ways the
// platform did not produce a picture, and the dialog reports them through the
// toast channel.
//
// `too-large` is the only one the user has levers for, and the only one reached
// before a canvas is allocated.
export type RasterFailure = 'too-large' | 'blob-null' | 'type-substituted' | 'no-context'

export type RasterOutcome = Blob | Refused<RasterFailure>

// The layer's own constructor, for the same reason the gesture layer has one:
// `refuse` in `core/outcome.ts` is constrained to `RefusalReason`, and keeping
// it that way is what stops the app-wide union drifting open.
export function refuseRaster(reason: RasterFailure): Refused<RasterFailure> {
  return { refused: reason }
}

export async function renderToBlob(scene: MapScene, format: ImageFormat): Promise<RasterOutcome> {
  // Derived from the scene rather than taken as an argument, so a caller cannot
  // pass a size that disagrees with the picture it is asking for. The dialog
  // computes the same numbers from the same arithmetic to check every ticked
  // tab before any of this runs.
  const size = imageSize(scene.bounds, scene.tileSize * scene.camera.zoom)
  if (!withinCeiling(size, imageCeiling())) return refuseRaster('too-large')

  const canvas = document.createElement('canvas')
  try {
    canvas.width = size.width
    canvas.height = size.height

    const ctx = canvas.getContext('2d')
    if (!ctx) return refuseRaster('no-context')

    // A file has no display, so the identity transform: `scene.dpr` is 1 and
    // every CSS pixel the renderer measures in is an image pixel.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    renderMap(ctx, size.width, size.height, scene)

    const blob = await encode(canvas, format)
    if (blob === null) return refuseRaster('blob-null')
    // Per HTML, `toBlob` substitutes `image/png` for a type the engine cannot
    // encode and raises nothing, which would write PNG bytes into a `.webp`
    // file. The returned type is the only evidence that happened.
    if (blob.type !== format.mediaType) return refuseRaster('type-substituted')
    return blob
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

// `undefined` where the format has no encode quality, so nothing is handed a
// number it does not read. Where there is one it is always passed: WebP with no
// quality argument encodes lossy at the encoder's own default.
function encode(canvas: HTMLCanvasElement, format: ImageFormat): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, format.mediaType, format.quality?.value)
  })
}
