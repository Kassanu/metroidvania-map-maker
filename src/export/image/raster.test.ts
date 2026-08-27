import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapScene } from '@/canvas/renderMap'
import type { CanvasPalette } from '@/canvas/palette'
import { wasRefused } from '@/core/outcome'
import { WORLD_AREA_ID } from '@/core/ids'
import { paintCells } from '@/core/ops/rooms'
import { ok, rect, setup, tx } from '@/core/testUtils'
import { recordsOf } from '@/test-setup'
import { imageCeiling } from './ceiling'
import { IMAGE_FORMATS } from './formats'
import { buildExportScene, type ExportLayers, type ExportSceneOptions } from './scene'
import { renderToBlob } from './raster'

// The ceiling is a device measurement, so the producer's own guard is asserted
// against a stated one rather than against whatever the test machine allocates.
vi.mock('./ceiling', async (original) => ({
  ...(await original<typeof import('./ceiling')>()),
  imageCeiling: vi.fn(() => ({ maxSide: 4096, maxPixels: 4096 * 4096 })),
}))

// Unparseable on purpose, like the renderer's own test palette: nothing here
// asserts a derived colour, and a real hex would make one vacuous.
const palette = {
  pasteboard: '#pasteboard',
  page: '#page',
  grid: '#grid',
  roomFill: '#roomfill',
  roomWall: '#roomwall',
} as unknown as CanvasPalette

const ALL_LAYERS: ExportLayers = {
  grid: true,
  transitions: true,
  teleportLines: true,
  icons: true,
  lines: true,
  allLabels: true,
}

function options(overrides: Partial<ExportSceneOptions> = {}): ExportSceneOptions {
  return { pxPerCell: 32, margin: 2, layers: ALL_LAYERS, palette, ...overrides }
}

// A 2x2 room at the origin: at 32 px per cell with a 2-cell margin, a 192 px
// square. Small enough to sit far under every ceiling asserted below.
function sceneOfTwoByTwo(overrides: Partial<ExportSceneOptions> = {}): MapScene {
  const { project, map } = setup()
  const painting = tx(map)
  ok(paintCells(painting, project, map, rect(0, 0, 2, 2), { areaId: WORLD_AREA_ID }))
  painting.commit()

  const scene = buildExportScene(project, map.id, options(overrides))
  if (!scene) throw new Error('the fixture draws nothing')
  return scene
}

const PNG = IMAGE_FORMATS.find((entry) => entry.id === 'png')!
const WEBP = IMAGE_FORMATS.find((entry) => entry.id === 'webp')!

// What `toBlob` answered, and what it was asked. jsdom implements neither the
// method nor an encoder, so the double is the whole of it.
interface Encoder {
  calls: { type: string | undefined; quality: unknown }[]
  answer: Blob | null
}

let encoder: Encoder
let allocated: HTMLCanvasElement[]

beforeEach(() => {
  encoder = { calls: [], answer: new Blob(['bytes'], { type: 'image/png' }) }
  allocated = []
  // Reasserted per test rather than left to the factory: the mock is a module
  // singleton, so a test that lowers the ceiling lowers it for every test after
  // it, and each of those then refuses before reaching what it was written for.
  vi.mocked(imageCeiling).mockReturnValue({ maxSide: 4096, maxPixels: 4096 * 4096 })

  HTMLCanvasElement.prototype.toBlob = function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
    quality?: unknown,
  ) {
    encoder.calls.push({ type, quality })
    callback(encoder.answer)
  }

  const createElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, ...rest: unknown[]) => {
    const element = createElement(tag, ...(rest as []))
    if (tag === 'canvas') allocated.push(element as HTMLCanvasElement)
    return element
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'toBlob')
})

describe('producing a blob', () => {
  it('answers the blob the engine encoded', async () => {
    const result = await renderToBlob(sceneOfTwoByTwo(), PNG)
    expect(result).toBe(encoder.answer)
  })

  it('draws the scene before encoding it', async () => {
    await renderToBlob(sceneOfTwoByTwo(), PNG)

    // The page colour under a hidden page, laid across the whole bitmap: the
    // first thing `renderMap` puts down, and evidence it ran at all.
    const [canvas] = allocated
    expect(recordsOf(canvas!).fills[0]).toEqual({ style: '#page', rect: [0, 0, 192, 192] })
  })

  it('sizes the bitmap from the scene', async () => {
    await renderToBlob(sceneOfTwoByTwo(), PNG)
    // Zeroed by the time this reads it, so the size is asserted through what
    // was drawn rather than through the element.
    expect(recordsOf(allocated[0]!).fills[0]!.rect).toEqual([0, 0, 192, 192])
  })

  it('sizes the bitmap from the scene at a larger preset', async () => {
    await renderToBlob(sceneOfTwoByTwo({ pxPerCell: 64 }), PNG)
    expect(recordsOf(allocated[0]!).fills[0]!.rect).toEqual([0, 0, 384, 384])
  })

  // A file has no display: one CSS pixel is one image pixel, and every
  // device-pixel rule in the renderer reads directly onto the output.
  it('draws through the identity transform', async () => {
    await renderToBlob(sceneOfTwoByTwo(), PNG)
    const canvas = allocated[0]!
    const ctx = canvas.getContext('2d') as unknown as {
      setTransform: { mock: { calls: number[][] } }
    }
    expect(ctx.setTransform.mock.calls[0]).toEqual([1, 0, 0, 1, 0, 0])
  })
})

describe('the encode quality', () => {
  it('hands the encoder nothing where the format has no quality', async () => {
    await renderToBlob(sceneOfTwoByTwo(), PNG)
    expect(encoder.calls).toEqual([{ type: 'image/png', quality: undefined }])
  })

  // With no quality argument WebP encodes lossy at the encoder's own default.
  // Only 1 is lossless, so it is always passed.
  it('hands the encoder the fixed quality where the format has one', async () => {
    encoder.answer = new Blob(['bytes'], { type: 'image/webp' })
    await renderToBlob(sceneOfTwoByTwo(), WEBP)
    expect(encoder.calls).toEqual([{ type: 'image/webp', quality: 1 }])
  })
})

describe('failing', () => {
  // Per HTML, an unsupported type is replaced by `image/png` and nothing is
  // raised, which would write PNG bytes into a `.webp` file.
  it('refuses a blob whose type is not the one asked for', async () => {
    encoder.answer = new Blob(['bytes'], { type: 'image/png' })
    const result = await renderToBlob(sceneOfTwoByTwo(), WEBP)

    expect(wasRefused(result)).toBe(true)
    expect(result).toEqual({ refused: 'type-substituted' })
  })

  it('produces no bytes when the type was substituted', async () => {
    encoder.answer = new Blob(['bytes'], { type: 'image/png' })
    const result = await renderToBlob(sceneOfTwoByTwo(), WEBP)
    expect(result).not.toBeInstanceOf(Blob)
  })

  it('refuses a null blob', async () => {
    encoder.answer = null
    const result = await renderToBlob(sceneOfTwoByTwo(), PNG)
    expect(result).toEqual({ refused: 'blob-null' })
  })

  it('refuses a request past the ceiling', async () => {
    vi.mocked(imageCeiling).mockReturnValue({ maxSide: 128, maxPixels: 128 * 128 })
    const result = await renderToBlob(sceneOfTwoByTwo(), PNG)
    expect(result).toEqual({ refused: 'too-large' })
  })

  // Before any canvas is allocated, not after: a batch that fails on the eighth
  // map after drawing seven is the worst outcome available, and the size is
  // arithmetic that is known without allocating anything.
  it('allocates nothing at all when the request is past the ceiling', async () => {
    vi.mocked(imageCeiling).mockReturnValue({ maxSide: 128, maxPixels: 128 * 128 })
    await renderToBlob(sceneOfTwoByTwo(), PNG)

    expect(allocated).toEqual([])
    expect(encoder.calls).toEqual([])
  })

  // The dimension cap and the area cap are separate limits, and the producer
  // holds both: this request is well inside the area and over the side.
  it('refuses a request over the side cap that is inside the pixel cap', async () => {
    vi.mocked(imageCeiling).mockReturnValue({ maxSide: 100, maxPixels: 4096 * 4096 })
    const result = await renderToBlob(sceneOfTwoByTwo(), PNG)
    expect(result).toEqual({ refused: 'too-large' })
  })

  it('refuses when there is no 2D context', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const result = await renderToBlob(sceneOfTwoByTwo(), PNG)
    expect(result).toEqual({ refused: 'no-context' })
  })
})

describe('releasing the canvas', () => {
  // Twenty ticked tabs render one at a time and must not hold twenty bitmaps.
  it('zeroes the bitmap once the blob is in hand', async () => {
    await renderToBlob(sceneOfTwoByTwo(), PNG)
    expect([allocated[0]!.width, allocated[0]!.height]).toEqual([0, 0])
  })

  it('zeroes the bitmap on a failure too', async () => {
    encoder.answer = null
    await renderToBlob(sceneOfTwoByTwo(), PNG)
    expect([allocated[0]!.width, allocated[0]!.height]).toEqual([0, 0])
  })
})
