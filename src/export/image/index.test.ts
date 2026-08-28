import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setStorageProvider } from '@/storage'
import { addMap, renameMap } from '@/core/ops/maps'
import { createLine } from '@/core/ops/markup'
import { renameProject } from '@/core/ops/project'
import { makeRoom, ok, rect, setup, tx } from '@/core/testUtils'
import { hasScopableTab } from '../scopeTree'
import { spyProvider, zipEntries } from '../testUtils'
import { IMAGE_FORMATS } from './formats'
import { DEFAULT_LAYERS } from './options'
import { renderToBlob } from './raster'
import { exportImages, imageScopeEmpty, planExport } from './index'
import type { ImageExportOptions } from './index'
import type { MapId } from '@/core/ids'
import type { ProjectModel } from '@/core/types'

// The producer is the one piece jsdom cannot run: there is no encoder behind
// `toBlob`. Everything this file is about happens either side of it, so it is
// a double that records what it was handed and how many bitmaps were live at
// once.
vi.mock('./raster', () => ({
  renderToBlob: vi.fn(),
}))

// A stated ceiling rather than whatever the machine allocates, so the refusal
// path is reachable and the same size means the same thing on every machine.
vi.mock('./ceiling', async (original) => ({
  ...(await original<typeof import('./ceiling')>()),
  imageCeiling: vi.fn(() => ({ maxSide: 4096, maxPixels: 4096 * 4096 })),
}))

const PNG = IMAGE_FORMATS[0]!

let live: number
let peak: number

beforeEach(() => {
  live = 0
  peak = 0
  vi.mocked(renderToBlob).mockImplementation(async () => {
    live++
    peak = Math.max(peak, live)
    // A macrotask, so a caller that started two at once would overlap here.
    await new Promise((resolve) => setTimeout(resolve, 0))
    live--
    return new Blob(['png bytes'], { type: PNG.mediaType })
  })
})

afterEach(() => {
  setStorageProvider(null)
  vi.mocked(renderToBlob).mockReset()
})

function options(overrides: Partial<ImageExportOptions> = {}): ImageExportOptions {
  return {
    pxPerCell: 32,
    margin: 2,
    layers: { ...DEFAULT_LAYERS },
    transparent: false,
    appearance: 'light',
    ...overrides,
  }
}

// Two tabs with rooms, a third with a line and no rooms, a fourth with nothing
// at all: one tab of each state the table below has a row for.
function project() {
  const { project: model, map: surface } = setup()
  makeRoom(model, surface, rect(0, 0, 2, 2))

  const adding = tx()
  const caves = addMap(adding, model, 'Caves')
  const sketch = addMap(adding, model, 'Sketch')
  const blank = addMap(adding, model, 'Blank')
  renameMap(adding, model, surface.id, 'Surface')
  renameProject(adding, model, 'Zebes')
  adding.commit()

  makeRoom(model, caves, rect(0, 0, 1, 1))

  const drawing = tx(sketch)
  ok(
    createLine(drawing, sketch, ['0,0', '1,0'], {
      color: '#fff',
      arrowStart: false,
      arrowEnd: false,
    }),
  )
  drawing.commit()

  return { model, surface: surface.id, caves: caves.id, sketch: sketch.id, blank: blank.id }
}

function ticked(...ids: MapId[]): Set<MapId> {
  return new Set(ids)
}

// A room wide enough that the stated ceiling refuses it at every margin: 200
// cells plus the tightest margin is 4,848 px at the smallest preset. Painted
// clear of whatever the tab already holds, so it is a second room rather than
// an extension of the first.
function paintWide(model: ProjectModel, mapId: MapId): void {
  makeRoom(model, model.mapsById.get(mapId)!, rect(0, 5, 200, 1))
}

describe('what was ticked, and the state of those tabs', () => {
  it('one tab with content lands as one image named for the map', async () => {
    const { written } = spyProvider()
    const { model, surface } = project()

    const result = await exportImages(model, ticked(surface), options(), PNG)

    expect(result).toEqual({ kind: 'written', files: 1 })
    expect(written).toHaveLength(1)
    expect(written[0]!.name).toEqual({ stem: 'Surface', extension: '.png' })
    expect(written[0]!.contents.type).toBe(PNG.mediaType)
  })

  it('a tab with no content is not tickable', () => {
    const { model, blank, sketch, surface } = project()

    expect(imageScopeEmpty(model.mapsById.get(blank)!)).toBe(true)
    // Lines are content here, which is where this predicate parts company with
    // the JSON exporter's "no rooms".
    expect(imageScopeEmpty(model.mapsById.get(sketch)!)).toBe(false)
    expect(imageScopeEmpty(model.mapsById.get(surface)!)).toBe(false)
  })

  it('several tabs land as one zip named for the project, one entry per map', async () => {
    const { written } = spyProvider()
    const { model, surface, caves } = project()

    const result = await exportImages(model, ticked(surface, caves), options(), PNG)

    expect(result).toEqual({ kind: 'written', files: 2 })
    expect(written).toHaveLength(1)
    expect(written[0]!.name).toEqual({ stem: 'Zebes', extension: '.zip' })
    expect([...(await zipEntries(written[0]!.contents)).keys()]).toEqual([
      'surface.png',
      'caves.png',
    ])
  })

  it('a tab with no content cannot reach a batch, since it cannot be ticked', () => {
    const { model, blank } = project()

    // The tree is what a dialog ticks from, and an empty tab is disabled in it.
    expect(imageScopeEmpty(model.mapsById.get(blank)!)).toBe(true)
  })

  it('nothing ticked writes nothing', async () => {
    const { saveBytes } = spyProvider()
    const { model } = project()

    const result = await exportImages(model, ticked(), options(), PNG)

    expect(result.kind).toBe('failed')
    expect(saveBytes).not.toHaveBeenCalled()
  })

  it('a tab over the ceiling is refused, and nothing is rendered', () => {
    const { model, surface, caves } = project()
    paintWide(model, caves)

    const plan = planExport(model, ticked(surface, caves), options({ pxPerCell: 24 }), PNG)

    expect(plan.refused).toMatchObject({ name: 'Caves', refusal: 'too-large' })
    expect(renderToBlob).not.toHaveBeenCalled()
  })

  it('says the whole project has nothing to draw when every tab is empty', () => {
    const { project: model } = setup()

    expect(hasScopableTab(model, imageScopeEmpty)).toBe(false)
  })

  // The row the tickability predicate and the rectangle disagree on: a tab
  // holding lines and no rooms is tickable, and with the Lines layer off there
  // is nothing left to frame.
  it('refuses a ticked tab that draws nothing at these layers', () => {
    const { model, sketch } = project()

    const plan = planExport(
      model,
      ticked(sketch),
      options({ layers: { ...DEFAULT_LAYERS, lines: false } }),
      PNG,
    )

    expect(plan.refused).toMatchObject({ name: 'Sketch', refusal: 'draws-nothing' })
    expect(plan.tabs[0]!.size).toBeNull()
    expect(plan.largest).toBeNull()
  })
})

describe('the plan, which costs no bitmap', () => {
  it('sizes every ticked tab from the rectangle alone', () => {
    const { model, surface, caves } = project()

    const plan = planExport(model, ticked(surface, caves), options(), PNG)

    // 2x2 room plus a 2-cell margin either side is 6 cells, at 32 px each.
    expect(plan.tabs.map((tab) => tab.size)).toEqual([
      { width: 192, height: 192 },
      { width: 160, height: 160 },
    ])
    expect(plan.largest).toEqual({ width: 192, height: 192 })
    expect(renderToBlob).not.toHaveBeenCalled()
  })

  it('reads the layers, so a layer that is off does not size the picture', () => {
    const { model, sketch } = project()
    makeRoom(model, model.mapsById.get(sketch)!, rect(0, 0, 1, 1))

    const withLines = planExport(model, ticked(sketch), options(), PNG)
    const without = planExport(
      model,
      ticked(sketch),
      options({ layers: { ...DEFAULT_LAYERS, lines: false } }),
      PNG,
    )

    expect(withLines.largest!.width).toBeGreaterThan(without.largest!.width)
  })

  it('estimates the weight from the format rather than from a number of its own', () => {
    const { model, surface } = project()
    const [png, webp] = IMAGE_FORMATS

    const pngPlan = planExport(model, ticked(surface), options(), png!)
    const webpPlan = planExport(model, ticked(surface), options(), webp!)

    expect(pngPlan.estimatedBytes).toBe(192 * 192 * png!.bytesPerPixel)
    expect(webpPlan.estimatedBytes).toBe(192 * 192 * webp!.bytesPerPixel)
  })

  it('says when the margin is a lever on a refusal, and when it is not', () => {
    const { model, surface, caves } = project()
    paintWide(model, caves)

    // 202 cells at 24 px is 4,848 at the tightest margin: over the ceiling
    // however the margin is set, so the margin is not one of its levers.
    const hopeless = planExport(model, ticked(caves), options({ pxPerCell: 24 }), PNG)
    expect(hopeless.refused!.marginIsALever).toBe(false)

    // 168 cells at 24 px is 4,080 at the tightest margin and 4,128 at the
    // default one: the two extra cells either side are the whole refusal.
    makeRoom(model, model.mapsById.get(surface)!, rect(0, 10, 168, 1))
    const marginal = planExport(model, ticked(surface), options({ pxPerCell: 24 }), PNG)
    expect(marginal.refused).toMatchObject({ refusal: 'too-large', marginIsALever: true })
  })
})

describe('the run', () => {
  it('renders one map at a time and never holds two bitmaps', async () => {
    spyProvider()
    const { model, surface, caves } = project()

    await exportImages(model, ticked(surface, caves), options(), PNG)

    expect(renderToBlob).toHaveBeenCalledTimes(2)
    expect(peak).toBe(1)
  })

  it('is all or nothing: a map that fails partway writes no archive', async () => {
    const { saveBytes } = spyProvider()
    const { model, surface, caves } = project()
    vi.mocked(renderToBlob)
      .mockResolvedValueOnce(new Blob(['png bytes'], { type: PNG.mediaType }))
      .mockResolvedValueOnce({ refused: 'blob-null' })

    const result = await exportImages(model, ticked(surface, caves), options(), PNG)

    expect(result).toMatchObject({ kind: 'failed' })
    expect(saveBytes).not.toHaveBeenCalled()
  })

  it('names the map that failed', async () => {
    spyProvider()
    const { model, caves } = project()
    vi.mocked(renderToBlob).mockResolvedValueOnce({ refused: 'blob-null' })

    const result = await exportImages(model, ticked(caves), options(), PNG)

    expect(result).toMatchObject({ kind: 'failed' })
    expect((result as { message: string }).message).toContain('Caves')
  })

  it('says nothing happened when the destination is dismissed', async () => {
    spyProvider('cancelled')
    const { model, surface } = project()

    expect(await exportImages(model, ticked(surface), options(), PNG)).toEqual({
      kind: 'cancelled',
    })
  })

  it('hands the encoder the descriptor it was given, not a format it looked up', async () => {
    spyProvider()
    const { model, surface } = project()
    const webp = IMAGE_FORMATS[1]!

    await exportImages(model, ticked(surface), options(), webp)

    expect(vi.mocked(renderToBlob).mock.calls[0]![1]).toBe(webp)
  })

  it('passes the chosen size and layers through to the scene', async () => {
    spyProvider()
    const { model, surface } = project()

    await exportImages(
      model,
      ticked(surface),
      options({ pxPerCell: 64, layers: { ...DEFAULT_LAYERS, grid: false } }),
      PNG,
    )

    const scene = vi.mocked(renderToBlob).mock.calls[0]![0]
    expect(scene.camera.zoom).toBe(2)
    expect(scene.showGrid).toBe(false)
    expect(scene.showAllLabels).toBe(false)
  })
})

describe('naming inside an archive', () => {
  it('suffixes a repeated entry name in tab order', async () => {
    const { written } = spyProvider()
    const { model, surface, caves } = project()
    const naming = tx()
    renameMap(naming, model, surface, 'Brinstar')
    renameMap(naming, model, caves, 'brinstar!')
    naming.commit()

    await exportImages(model, ticked(surface, caves), options(), PNG)

    expect([...(await zipEntries(written[0]!.contents)).keys()]).toEqual([
      'brinstar.png',
      'brinstar-2.png',
    ])
  })

  it('falls back to the project name where a map name slugs to nothing', async () => {
    const { written } = spyProvider()
    const { model, surface, caves } = project()
    const naming = tx()
    renameMap(naming, model, surface, '!!!')
    naming.commit()

    await exportImages(model, ticked(surface, caves), options(), PNG)

    expect([...(await zipEntries(written[0]!.contents)).keys()]).toEqual(['zebes.png', 'caves.png'])
  })
})
