import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createTestPinia } from '@/test-setup'
import ExportDialog from './ExportDialog.vue'
import { useUiStore } from '@/stores/ui'
import { useTabsStore } from '@/stores/tabs'
import { PROJECT_SCOPE, mapScope, useModelStore } from '@/stores/model'
import { addMap } from '@/core/ops/maps'
import { createNewArea } from '@/core/ops/project'
import { paintCells, renameRoom } from '@/core/ops/rooms'
import { WORLD_AREA_ID } from '@/core/ids'
import type { MapId, RoomId } from '@/core/ids'
import * as exporter from '@/export'

// The dialog portals, so assertions read the document rather than the wrapper.
const mounted: VueWrapper[] = []

// What the export was asked to write, which is the whole of what this dialog
// decides. Resolves `written` unless a test says otherwise.
const exportProject = vi.spyOn(exporter, 'exportProject')

interface Fixture {
  surface: MapId
  caves: MapId
  landing: RoomId
  corridor: RoomId
  vault: RoomId
  depths: RoomId
}

// Crateria holds rooms on both tabs, which is the case the tree exists for.
function seed(): Fixture {
  const model = useModelStore()
  const surface = useTabsStore().activeTabId
  let caves!: MapId
  let crateria!: string
  let landing!: RoomId
  let corridor!: RoomId
  let vault!: RoomId
  let depths!: RoomId

  model.run('Setup', PROJECT_SCOPE, (tx) => {
    crateria = createNewArea(tx, model.project, 'Crateria', '#3a5f7d', '#7fb2d9').id
    caves = addMap(tx, model.project, 'Caves').id
  })
  model.run('Surface', mapScope(surface), (tx) => {
    const map = model.project.mapsById.get(surface)!
    const paint = (cells: string[], name: string, areaId: string) => {
      const room = paintCells(tx, model.project, map, cells, { areaId: areaId as never })
      renameRoom(tx, map, room.id, name)
      return room.id
    }
    landing = paint(['0,0', '1,0'], 'Landing Site', crateria)
    corridor = paint(['3,0', '4,0'], 'Corridor', crateria)
    vault = paint(['0,5'], 'Vault', WORLD_AREA_ID)
  })
  model.run('Caves', mapScope(caves), (tx) => {
    const map = model.project.mapsById.get(caves)!
    depths = paintCells(tx, model.project, map, ['0,0'], { areaId: crateria as never }).id
  })

  return { surface, caves, landing, corridor, vault, depths }
}

async function open() {
  const wrapper = mount(ExportDialog, { attachTo: document.body })
  mounted.push(wrapper)
  useUiStore().openExport()
  await nextTick()
  await nextTick()
  return wrapper
}

function rows() {
  return [...document.body.querySelectorAll('[role="treeitem"]')].map((row) => ({
    kind: row.getAttribute('data-row-kind'),
    id: row.getAttribute('data-row-id'),
    level: row.getAttribute('aria-level'),
    label: row.querySelector('.export-label')?.textContent?.trim() ?? '',
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

async function click(element: HTMLElement) {
  element.click()
  await nextTick()
}

function text(): string {
  return document.body.textContent ?? ''
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createTestPinia())
  exportProject.mockResolvedValue({ kind: 'written', files: 1 })
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  exportProject.mockReset()
})

describe('the tree it shows', () => {
  it('lists tab, area and room at three levels', async () => {
    const fixture = seed()
    await open()

    expect(rows().map((row) => [row.kind, row.level, row.label])).toEqual([
      ['tab', '1', 'Map 1'],
      ['area', '2', 'World'],
      ['room', '3', 'Vault'],
      ['area', '2', 'Crateria'],
      ['room', '3', 'Landing Site'],
      ['room', '3', 'Corridor'],
      ['tab', '1', 'Caves'],
      ['area', '2', 'Crateria'],
      // Unnamed, so it takes the Hierarchy's positional fallback rather than
      // rendering as a blank row.
      ['room', '3', 'Room at 0,0'],
    ])
    expect(rows()[8].id).toBe(fixture.depths)
  })

  it('shows a tab with no rooms, and will not let it be ticked', async () => {
    const model = useModelStore()
    seed()
    let empty!: MapId
    model.run('Empty tab', PROJECT_SCOPE, (tx) => {
      empty = addMap(tx, model.project, 'Empty').id
    })
    await open()

    const row = rows().find((each) => each.id === empty)!
    expect(row.disabled).toBe(true)
    expect(row.state).toBe('false')
  })
})

describe('ticking', () => {
  it('starts with everything ticked', async () => {
    seed()
    await open()
    expect(rows().every((row) => row.state === 'true')).toBe(true)
  })

  it('leaves an area indeterminate when one of its rooms is unticked', async () => {
    const fixture = seed()
    await open()

    await click(boxFor(fixture.landing))

    const byId = new Map(rows().map((row) => [row.id, row.state]))
    expect(byId.get(fixture.landing)).toBe('false')
    expect(byId.get(fixture.corridor)).toBe('true')
    expect(byId.get(fixture.surface)).toBe('mixed')
  })

  it('never reaches the same area on another tab', async () => {
    const fixture = seed()
    await open()

    // Crateria under Surface, not under Caves.
    const crateriaOnSurface = document.body.querySelectorAll('[data-row-kind="area"]')[1]
    await click(crateriaOnSurface.querySelector('[role="checkbox"]') as HTMLElement)

    const byId = new Map(rows().map((row) => [row.id, row.state]))
    expect(byId.get(fixture.landing)).toBe('false')
    expect(byId.get(fixture.corridor)).toBe('false')
    expect(byId.get(fixture.depths)).toBe('true')
    expect(byId.get(fixture.caves)).toBe('true')
  })

  it('counts what is about to be written', async () => {
    const fixture = seed()
    await open()
    expect(text()).toContain('Tabs: 2')
    expect(text()).toContain('Rooms: 4')

    await click(boxFor(fixture.caves))
    expect(text()).toContain('Tabs: 1')
    expect(text()).toContain('Rooms: 3')
  })

  it('says so and disables the export when nothing is left', async () => {
    const fixture = seed()
    await open()

    await click(boxFor(fixture.surface))
    await click(boxFor(fixture.caves))

    expect(text()).toContain('Nothing selected')
    expect(button('Export').disabled).toBe(true)
  })
})

describe('exporting', () => {
  it('hands over exactly what was ticked', async () => {
    const fixture = seed()
    await open()

    await click(boxFor(fixture.landing))
    await click(button('Export'))

    const request = exportProject.mock.calls[0][1]
    expect(request.packaging).toBe('combined')
    expect(request.scope).toEqual(
      new Map([
        [fixture.surface, new Set([fixture.corridor, fixture.vault])],
        [fixture.caves, new Set([fixture.depths])],
      ]),
    )
  })

  it('passes the packaging the radio group is on', async () => {
    seed()
    await open()

    await click(document.body.querySelectorAll('[role="radio"]')[1] as HTMLElement)
    await click(button('Export'))

    expect(exportProject.mock.calls[0][1].packaging).toBe('per-room')
  })

  it('closes once the bytes have landed', async () => {
    seed()
    await open()
    await click(button('Export'))
    await nextTick()

    expect(useUiStore().exportOpen).toBe(false)
  })

  it('stays open with its selection when the destination is dismissed', async () => {
    const fixture = seed()
    exportProject.mockResolvedValue({ kind: 'cancelled' })
    await open()

    await click(boxFor(fixture.landing))
    await click(button('Export'))
    await nextTick()

    expect(useUiStore().exportOpen).toBe(true)
    expect(new Map(rows().map((row) => [row.id, row.state])).get(fixture.landing)).toBe('false')
  })

  it('stays open and says why when the write fails', async () => {
    seed()
    exportProject.mockResolvedValue({ kind: 'failed', message: 'the disk went away' })
    await open()

    await click(button('Export'))
    await nextTick()

    expect(useUiStore().exportOpen).toBe(true)
    expect(text()).toContain('the disk went away')
  })
})

describe('reopening', () => {
  it('starts from everything again, remembering no earlier selection', async () => {
    const fixture = seed()
    const ui = useUiStore()
    await open()

    await click(boxFor(fixture.landing))
    ui.exportOpen = false
    await nextTick()

    ui.openExport()
    await nextTick()

    expect(rows().every((row) => row.state === 'true')).toBe(true)
  })

  it('drops a failure from the last attempt', async () => {
    seed()
    const ui = useUiStore()
    exportProject.mockResolvedValue({ kind: 'failed', message: 'the disk went away' })
    await open()
    await click(button('Export'))
    await nextTick()

    ui.exportOpen = false
    await nextTick()
    ui.openExport()
    await nextTick()

    expect(text()).not.toContain('the disk went away')
  })
})
