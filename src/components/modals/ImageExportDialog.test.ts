import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createTestPinia } from '@/test-setup'
import ImageExportDialog from './ImageExportDialog.vue'
import { useUiStore } from '@/stores/ui'
import { useTabsStore } from '@/stores/tabs'
import { useCanvasViewStore } from '@/stores/canvasView'
import { PROJECT_SCOPE, mapScope, useModelStore } from '@/stores/model'
import { addMap, renameMap } from '@/core/ops/maps'
import { createLine } from '@/core/ops/markup'
import { paintCells } from '@/core/ops/rooms'
import { WORLD_AREA_ID } from '@/core/ids'
import type { MapId } from '@/core/ids'
import { ok } from '@/core/testUtils'
import { rect } from '@/core/testUtils'
import * as imageExport from '@/export/image'
import { IMAGE_FORMATS } from '@/export/image/formats'
import type { ImageFormat } from '@/export/image/formats'
import { clearToasts } from '@/notify'
import { t } from '@/i18n'

// A stated ceiling, so the refusal is reachable from a fixture small enough to
// read and means the same thing on every machine.
vi.mock('@/export/image/ceiling', async (original) => ({
  ...(await original<typeof import('@/export/image/ceiling')>()),
  imageCeiling: vi.fn(() => ({ maxSide: 4096, maxPixels: 4096 * 4096 })),
}))

const PNG = IMAGE_FORMATS[0]!
const WEBP = IMAGE_FORMATS[1]!

// The third row of the format table, which no shipped format fills. Without it
// the disabled-transparency and quality-slider branches are code no test can
// reach, and the seam's whole claim is that a format like this costs one entry.
const LOSSY: ImageFormat = {
  id: 'jpeg' as ImageFormat['id'],
  label: 'JPEG',
  extension: '.jpg',
  mediaType: 'image/jpeg',
  alpha: false,
  quality: { value: 0.92, adjustable: true },
  bytesPerPixel: 0.05,
}

const mounted: VueWrapper[] = []

// What the export was asked for, which is the whole of what this dialog
// decides. The run itself is #317's and is tested there.
const exportImages = vi.spyOn(imageExport, 'exportImages')

interface Fixture {
  surface: MapId
  caves: MapId
  sketch: MapId
  blank: MapId
}

// One tab of each state: rooms, more rooms, a line and no rooms, and nothing.
function seed(): Fixture {
  const model = useModelStore()
  const surface = useTabsStore().activeTabId
  let caves!: MapId
  let sketch!: MapId
  let blank!: MapId

  model.run('Setup', PROJECT_SCOPE, (tx) => {
    caves = addMap(tx, model.project, 'Caves').id
    sketch = addMap(tx, model.project, 'Sketch').id
    blank = addMap(tx, model.project, 'Blank').id
    renameMap(tx, model.project, surface, 'Surface')
  })
  model.run('Surface', mapScope(surface), (tx) => {
    const map = model.project.mapsById.get(surface)!
    paintCells(tx, model.project, map, rect(0, 0, 2, 2), { areaId: WORLD_AREA_ID })
  })
  model.run('Caves', mapScope(caves), (tx) => {
    const map = model.project.mapsById.get(caves)!
    paintCells(tx, model.project, map, ['0,0'], { areaId: WORLD_AREA_ID })
  })
  model.run('Sketch', mapScope(sketch), (tx) => {
    const map = model.project.mapsById.get(sketch)!
    ok(createLine(tx, map, ['0,0', '1,0'], { color: '#fff', arrowStart: false, arrowEnd: false }))
  })

  return { surface, caves, sketch, blank }
}

async function open(format: ImageFormat = PNG) {
  const wrapper = mount(ImageExportDialog, { attachTo: document.body })
  mounted.push(wrapper)
  useUiStore().openImageExport(format)
  await nextTick()
  await nextTick()
  return wrapper
}

function control(id: string): HTMLInputElement | HTMLSelectElement {
  return document.body.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement
}

function rows() {
  return [...document.body.querySelectorAll('[role="treeitem"]')].map((row) => ({
    id: row.getAttribute('data-row-id'),
    label: row.querySelector('.scope-label')?.textContent?.trim() ?? '',
    state: row.querySelector('[role="checkbox"]')?.getAttribute('aria-checked') ?? '',
    disabled: row.querySelector('[role="checkbox"]')?.hasAttribute('data-disabled') ?? false,
  }))
}

function boxFor(id: string): HTMLElement {
  const row = document.body.querySelector(`[data-row-id="${id}"]`)!
  return row.querySelector('[role="checkbox"]') as HTMLElement
}

function button(label: string): HTMLButtonElement {
  return [...document.body.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === label,
  ) as HTMLButtonElement
}

function readout(): string {
  return document.body.querySelector('[data-readout]')?.textContent?.trim() ?? ''
}

// The weight the readout should be showing, from the same figure the dialog
// reads: the number is the format's, not this file's.
function estimate(...sides: number[]): string {
  let bytes = 0
  for (let at = 0; at < sides.length; at += 2)
    bytes += sides[at]! * sides[at + 1]! * PNG.bytesPerPixel
  return bytes < 1_000_000
    ? t('modal.imageExport.sizeKb', { value: Math.max(1, Math.round(bytes / 1_000)) })
    : t('modal.imageExport.sizeMb', { value: (bytes / 1_000_000).toFixed(1) })
}

function refusal(): string {
  return document.body.querySelector('[data-refusal]')?.textContent?.trim() ?? ''
}

async function click(element: HTMLElement) {
  element.click()
  await nextTick()
}

async function set(element: HTMLInputElement | HTMLSelectElement, value: string, event = 'change') {
  element.value = value
  element.dispatchEvent(new Event(event, { bubbles: true }))
  await nextTick()
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createTestPinia())
  exportImages.mockResolvedValue({ kind: 'written', files: 1 })
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  exportImages.mockReset()
  clearToasts()
})

// One row of the published table per describe, one column per test. A control
// that would need a further column is a control the descriptor cannot describe.
describe('format x capability', () => {
  describe('PNG', () => {
    it('offers a transparent background', async () => {
      seed()
      await open(PNG)
      const box = control('image-export-transparent') as HTMLInputElement
      expect(box.disabled).toBe(false)
      // Off, so the picture lands on something: a transparent PNG on a light
      // page reads as broken and is discovered after it has been posted.
      expect(box.checked).toBe(false)
    })

    it('hides the quality slider', async () => {
      seed()
      await open(PNG)
      expect(control('image-export-quality')).toBeNull()
    })

    it('names itself in the title', async () => {
      seed()
      await open(PNG)
      expect(document.body.querySelector('.modal-title')?.textContent).toBe(
        t('modal.imageExport.title', { format: 'PNG' }),
      )
    })
  })

  describe('WebP', () => {
    it('offers a transparent background', async () => {
      seed()
      await open(WEBP)
      expect((control('image-export-transparent') as HTMLInputElement).disabled).toBe(false)
    })

    // Fixed at lossless rather than offered: the value is a property of the
    // format, so there is nothing for a control to do.
    it('hides the quality slider', async () => {
      seed()
      await open(WEBP)
      expect(control('image-export-quality')).toBeNull()
    })

    it('names itself in the title', async () => {
      seed()
      await open(WEBP)
      expect(document.body.querySelector('.modal-title')?.textContent).toBe(
        t('modal.imageExport.title', { format: 'WebP' }),
      )
    })
  })

  describe('a format that carries no alpha and sets its own quality', () => {
    it('disables the transparent background and says why', async () => {
      seed()
      await open(LOSSY)

      expect((control('image-export-transparent') as HTMLInputElement).disabled).toBe(true)
      expect(document.body.textContent).toContain('JPEG')
    })

    it('shows the quality slider, set to the encode quality the format carries', async () => {
      seed()
      await open(LOSSY)

      const slider = control('image-export-quality') as HTMLInputElement
      expect(slider).not.toBeNull()
      expect(slider.value).toBe('0.92')
    })

    it('hands the encoder the quality the slider is on', async () => {
      const fixture = seed()
      await open(LOSSY)

      await set(control('image-export-quality'), '0.5', 'input')
      await click(button('Export'))

      const format = exportImages.mock.calls[0]![3]
      expect(format.quality).toEqual({ value: 0.5, adjustable: true })
      expect(exportImages.mock.calls[0]![1]).toEqual(new Set([fixture.surface]))
    })
  })

  // The rule the table is written to enforce: what the dialog and the menu know
  // about a format is what its descriptor says, never which format it is.
  it('names no format id in the dialog or in the menu', async () => {
    const sources = import.meta.glob(
      ['/src/components/modals/ImageExportDialog.vue', '/src/components/layout/MenuBar.vue'],
      { eager: true, query: '?raw', import: 'default' },
    ) as Record<string, string>

    expect(Object.keys(sources)).toHaveLength(2)
    for (const [path, text] of Object.entries(sources)) {
      for (const format of IMAGE_FORMATS) {
        // The id as a string of its own, which is the only shape it can take
        // in code: a branch on a format compares against a literal. An asset
        // path that ends in the same three letters is not one.
        const named = new RegExp(`(['"\`])${format.id}\\1`, 'i').test(text)
        expect([path, format.id, named]).toEqual([path, format.id, false])
      }

      // And the id field itself, whatever it holds. The loop above can only
      // know the ids that have shipped, so a branch written against a format
      // still to come would pass it: `format.id === 'jpeg'`, the day before
      // JPEG joins the table.
      expect([path, /\bformat\.id\b/.test(text)]).toEqual([path, false])
    }
  })
})

describe('the scope it opens with', () => {
  it('ticks the current tab and nothing else', async () => {
    const fixture = seed()
    await open()

    expect(rows().map((row) => [row.label, row.state])).toEqual([
      ['Surface', 'true'],
      ['Caves', 'false'],
      ['Sketch', 'false'],
      ['Blank', 'false'],
    ])
    expect(rows()[0]!.id).toBe(fixture.surface)
  })

  // Lines are content here, unlike the JSON exporter's "no rooms": a tab
  // holding a line has a picture to draw.
  it('disables only the tab with nothing to draw', async () => {
    seed()
    await open()

    expect(rows().map((row) => [row.label, row.disabled])).toEqual([
      ['Surface', false],
      ['Caves', false],
      ['Sketch', false],
      ['Blank', true],
    ])
  })

  it('forgets the selection between openings, and keeps the options', async () => {
    const fixture = seed()
    const ui = useUiStore()
    await open()

    await click(boxFor(fixture.caves))
    await set(control('image-export-size'), '64')
    ui.closeImageExport()
    await nextTick()

    ui.openImageExport(PNG)
    await nextTick()

    expect(rows().map((row) => row.state)).toEqual(['true', 'false', 'false', 'false'])
    expect((control('image-export-size') as HTMLSelectElement).value).toBe('64')
  })

  // A disabled control does not discard its value: the choice made under a
  // format that offers it is still there under the next one that does.
  it('keeps a transparency choice a format without alpha could not offer', async () => {
    seed()
    const ui = useUiStore()
    await open(PNG)

    await click(control('image-export-transparent') as HTMLElement)
    ui.closeImageExport()
    await nextTick()

    ui.openImageExport(LOSSY)
    await nextTick()
    expect(ui.imageExport.transparent).toBe(true)

    ui.closeImageExport()
    await nextTick()
    ui.openImageExport(PNG)
    await nextTick()
    expect((control('image-export-transparent') as HTMLInputElement).checked).toBe(true)
  })
})

describe('the readout', () => {
  it('gives the dimensions and an estimate for one ticked tab', async () => {
    seed()
    await open()

    // A 2x2 room with a 2-cell margin is 6 cells, at 32 px each. Asserted
    // through the catalogue, so rewording the readout does not fail a test
    // about arithmetic.
    expect(readout()).toBe(
      t('modal.imageExport.readout', { width: 192, height: 192, size: estimate(192, 192) }),
    )
  })

  it('follows the size preset', async () => {
    seed()
    await open()

    await set(control('image-export-size'), '64')

    expect(readout()).toContain(String(384))
    expect(readout()).toBe(
      t('modal.imageExport.readout', { width: 384, height: 384, size: estimate(384, 384) }),
    )
  })

  it('follows the margin', async () => {
    seed()
    await open()

    await set(control('image-export-margin'), '4', 'input')

    expect(readout()).toBe(
      t('modal.imageExport.readout', { width: 320, height: 320, size: estimate(320, 320) }),
    )
  })

  it('reports the largest tab and the total once several are ticked', async () => {
    const fixture = seed()
    await open()

    await click(boxFor(fixture.caves))

    // The largest of the two, and both their weights.
    expect(readout()).toBe(
      t('modal.imageExport.readoutMany', {
        width: 192,
        height: 192,
        size: estimate(192, 192, 160, 160),
      }),
    )
  })

  it('says nothing is ticked when nothing is', async () => {
    const fixture = seed()
    await open()

    await click(boxFor(fixture.surface))

    expect(readout()).toBe(t('modal.imageExport.nothing'))
    expect(button('Export').disabled).toBe(true)
  })
})

describe('refusing before anything is drawn', () => {
  it('names the tab that draws nothing at these layers, and the layer to turn back on', async () => {
    const fixture = seed()
    await open()

    await click(boxFor(fixture.sketch))
    await click(control('image-export-layer-lines') as HTMLElement)

    expect(refusal()).toBe(t('modal.imageExport.drawsNothing', { tab: 'Sketch' }))
    expect(button('Export').disabled).toBe(true)
  })

  it('names the tab that is too large, and does not export it', async () => {
    const model = useModelStore()
    const fixture = seed()
    model.run('Wide', mapScope(fixture.caves), (tx) => {
      const map = model.project.mapsById.get(fixture.caves)!
      paintCells(tx, model.project, map, rect(0, 5, 200, 1), { areaId: WORLD_AREA_ID })
    })
    await open()

    await click(boxFor(fixture.caves))

    expect(refusal()).toBe(
      t('modal.imageExport.tooLarge', { tab: 'Caves', width: 6528, height: 320 }),
    )
    expect(button('Export').disabled).toBe(true)
    expect(exportImages).not.toHaveBeenCalled()
  })

  // A refusal names the levers that would actually help, and the margin is one
  // only when the same tab would fit at the tightest setting.
  it('names the margin only when it is one of the levers', async () => {
    const model = useModelStore()
    const fixture = seed()
    model.run('Wide', mapScope(fixture.caves), (tx) => {
      const map = model.project.mapsById.get(fixture.caves)!
      paintCells(tx, model.project, map, rect(0, 5, 168, 1), { areaId: WORLD_AREA_ID })
    })
    await open()

    await set(control('image-export-size'), '24')
    await click(boxFor(fixture.caves))

    // The variant that names the margin, which is a lever here and is not one
    // on the map above.
    expect(refusal()).toBe(
      t('modal.imageExport.tooLargeMargin', { tab: 'Caves', width: 4128, height: 240 }),
    )
  })
})

describe('what reaches the exporter', () => {
  it('is what was ticked, at the options the dialog is set to', async () => {
    const fixture = seed()
    await open()

    await click(boxFor(fixture.caves))
    await set(control('image-export-size'), '48')
    await click(control('image-export-layer-grid') as HTMLElement)
    await click(button('Export'))

    const [, selected, options, format] = exportImages.mock.calls[0]!
    expect(selected).toEqual(new Set([fixture.surface, fixture.caves]))
    expect(options.pxPerCell).toBe(48)
    expect(options.layers.grid).toBe(false)
    expect(format).toBe(PNG)
  })

  // The View menu is how somebody likes to work; the dialog is what this
  // picture contains. Its state is not read, not as a value and not as a seed.
  it('is untouched by the View menu', async () => {
    const view = useCanvasViewStore()
    seed()
    view.showGrid = false
    view.showIcons = false

    await open()
    await click(button('Export'))

    const options = exportImages.mock.calls[0]![2]
    expect(options.layers.grid).toBe(true)
    expect(options.layers.icons).toBe(true)
  })

  it('closes once the bytes have landed', async () => {
    seed()
    await open()

    await click(button('Export'))
    await nextTick()

    expect(useUiStore().imageExportFormat).toBeNull()
  })

  it('stays open with its selection when the destination is dismissed', async () => {
    const fixture = seed()
    exportImages.mockResolvedValue({ kind: 'cancelled' })
    await open()

    await click(boxFor(fixture.caves))
    await click(button('Export'))
    await nextTick()

    expect(useUiStore().imageExportFormat).not.toBeNull()
    expect(rows().map((row) => row.state)).toEqual(['true', 'true', 'false', 'false'])
  })
})

describe('while an export is in flight', () => {
  // Closing is refused rather than silent: the bytes are already on their way
  // and there is nothing to cancel.
  it('refuses to close, and disables its controls', async () => {
    seed()
    let finish!: () => void
    exportImages.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ kind: 'written', files: 1 })
        }),
    )
    await open()

    await click(button('Export'))
    await nextTick()

    expect(button('Cancel').disabled).toBe(true)
    expect((control('image-export-size') as HTMLSelectElement).disabled).toBe(true)
    expect((document.body.querySelector('.modal-close') as HTMLButtonElement).disabled).toBe(true)

    // Esc is the route that does not go through a button of ours.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(useUiStore().imageExportFormat).not.toBeNull()

    finish()
    await nextTick()
    await nextTick()
    expect(useUiStore().imageExportFormat).toBeNull()
  })
})
