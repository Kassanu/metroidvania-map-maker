import { describe, expect, it } from 'vitest'
import { IMAGE_FORMATS, type ImageFormat } from './formats'

// The encode half of § Format × capability: one describe per row, one it per
// column. The two dialog columns of that table belong to the dialog, and the
// fields they read are asserted here so a row cannot become untestable there.
function format(id: string): ImageFormat {
  const found = IMAGE_FORMATS.find((entry) => entry.id === id)
  if (!found) throw new Error(`no format ${id}`)
  return found
}

describe('PNG', () => {
  it('carries alpha, so the transparent background is offered', () => {
    expect(format('png').alpha).toBe(true)
  })

  it('has no encode quality, so no number reaches the encoder', () => {
    expect(format('png').quality).toBeNull()
  })

  it('has no adjustable quality, so the slider is hidden', () => {
    expect(format('png').quality?.adjustable).toBeUndefined()
  })
})

describe('WebP', () => {
  it('carries alpha, so the transparent background is offered', () => {
    expect(format('webp').alpha).toBe(true)
  })

  // Lossless is not the encoder's default and has to be asked for: with no
  // quality argument `toBlob` encodes lossy, and only 1 is lossless.
  it('encodes at a fixed 1.0', () => {
    expect(format('webp').quality?.value).toBe(1)
  })

  it('does not offer the quality as a control', () => {
    expect(format('webp').quality?.adjustable).toBe(false)
  })
})

describe('the table', () => {
  it('ships PNG and WebP, and PNG first', () => {
    expect(IMAGE_FORMATS.map((entry) => entry.id)).toEqual(['png', 'webp'])
  })

  it('has unique ids', () => {
    const ids = IMAGE_FORMATS.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // Not that the two agree literally: a JPEG row would pair `.jpg` with
  // `image/jpeg` and be right. What is asserted is the shape each is consumed
  // as, since the extension names the file and the media type names the encoder.
  it('gives every entry a label, a leading-dot extension and an image type', () => {
    for (const entry of IMAGE_FORMATS) {
      expect(entry.label).not.toBe('')
      expect(entry.extension).toMatch(/^\.[a-z0-9]+$/)
      expect(entry.mediaType).toMatch(/^image\/[a-z0-9+-]+$/)
    }
  })
})
