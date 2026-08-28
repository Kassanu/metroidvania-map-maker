// The image formats an export can produce, one descriptor each.
//
// This table is the only thing in the app that names a format. Everything
// downstream branches on the capability fields below and never on an id: the
// dialog offers transparency when `alpha`, offers a quality slider when the
// quality is the user's to set, and the producer hands `quality.value` to the
// encoder. Adding a format is one entry here.
//
// `quality` is one field rather than a number beside a boolean because it
// answers two questions that are never independent: what the encoder is told,
// and whether anyone may change it. A format with no encode quality has no
// slider by construction.

export type ImageFormatId = 'png' | 'webp'

export interface EncodeQuality {
  // Handed to `toBlob`. 1 is lossless for every format that reads it.
  value: number
  // Whether the dialog offers this as a control. False means the value is a
  // property of the format rather than a choice.
  adjustable: boolean
}

export interface ImageFormat {
  id: ImageFormatId
  // Not translated: a format's name is the same in every language, and the
  // menu item is this plus its own punctuation.
  label: string
  extension: string
  mediaType: string
  // Whether the format carries transparency. The dialog disables the
  // transparent background option when this is false.
  alpha: boolean
  quality: EncodeQuality | null
  // What a pixel of this content costs once encoded, for the dialog's readout.
  // An order of magnitude rather than a promise: both encoders are driven by
  // how much of the picture is flat, and a dense map costs several times a
  // sparse one. The readout says "about" for that reason and the number is
  // never checked against a file.
  //
  // Measured on Zebes (251 rooms) at 32 px per cell, 2240x1952: PNG 125 KiB,
  // WebP 31 KiB.
  bytesPerPixel: number
}

// PNG first: it is the default, being lossless, alpha-carrying, and filtered
// for exactly this content (flat colour with hard edges).
//
// WebP ships lossless, which is not the encoder's default and has to be asked
// for: `toBlob(cb, 'image/webp')` with no quality argument encodes lossy, and
// only 1 is lossless. So its quality is an explicit 1 rather than null, and it
// is not the user's to change.
export const IMAGE_FORMATS: readonly ImageFormat[] = [
  {
    id: 'png',
    label: 'PNG',
    extension: '.png',
    mediaType: 'image/png',
    alpha: true,
    quality: null,
    bytesPerPixel: 0.03,
  },
  {
    id: 'webp',
    label: 'WebP',
    extension: '.webp',
    mediaType: 'image/webp',
    alpha: true,
    quality: { value: 1, adjustable: false },
    bytesPerPixel: 0.008,
  },
]
