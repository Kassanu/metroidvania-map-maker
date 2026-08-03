import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import CanvasRegion from './CanvasRegion.vue'
import { useModeStore } from '@/stores/mode'
import { useToolsStore } from '@/stores/tools'
import { useTabsStore } from '@/stores/tabs'
import { useSelectionStore } from '@/stores/selection'
import { mapScope, useModelStore } from '@/stores/model'
import { resolveEscape } from '@/hotkeys/escStack'
import { paintCells } from '@/core/ops/rooms'
import { placeIcon } from '@/core/ops/markup'
import { createFromBox } from '@/core/ops/doors'
import { ok, TEST_ICON_COLORS } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { MapId } from '@/core/ids'
import type { CellKey } from '@/core/cell'
import type { MapModel, ObjectRef } from '@/core/types'

// The marquee in Select mode's Cells sub-mode: a rubber band dragged over the
// canvas, and which cells it ends up holding.
//
// A cell band takes owned cells only, crosses room boundaries freely, and takes
// the part of a room it covered rather than the whole room, which is where it
// parts company with the Rooms band. The click column and the whole-room band
// are covered by their own suites.

describe('the cell marquee', () => {
  let mounted: ReturnType<typeof mount> | null = null

  beforeEach(() => {
    setActivePinia(createTestPinia())
    useModeStore().setMode('select')
  })

  afterEach(() => {
    mounted?.unmount()
    mounted = null
  })

  async function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    mounted = wrapper
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    viewport.setPointerCapture = () => {}
    await nextTick()
    return { wrapper, viewport }
  }

  function press(type: string, init: PointerEventInit = {}) {
    return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  }

  // A world point in screen coordinates: integers land on cell boundaries, so
  // `at(1.5, 0.5)` is the centre of the cell at (1, 0).
  function at(x: number, y: number) {
    const tabs = useTabsStore()
    const tile = useModelStore().tileSize
    const camera = tabs.cameraOf(tabs.activeTabId)
    return {
      clientX: (x - camera.pan.x) * tile * camera.zoom,
      clientY: (y - camera.pan.y) * tile * camera.zoom,
    }
  }

  // One move, so the press crosses the drag dead zone and leaves its origin cell
  // in a single step: a drag, by both halves of the rule at once.
  async function drag(
    viewport: HTMLElement,
    from: PointerEventInit,
    to: PointerEventInit,
    shiftKey = false,
  ) {
    viewport.dispatchEvent(press('pointerdown', { ...from, shiftKey }))
    viewport.dispatchEvent(press('pointermove', to))
    viewport.dispatchEvent(press('pointerup', to))
    await nextTick()
    await nextTick()
  }

  const selection = () => useSelectionStore()
  const mapId = () => useTabsStore().activeTabId

  function map(id: MapId = mapId()): MapModel {
    return useModelStore().project.mapsById.get(id)!
  }

  // Sorted: which order a band collects its cells in is not part of the
  // contract, only which cells it ends up with.
  function held(on: MapId = mapId()): CellKey[] {
    return [...selection().cellsOn(on)].sort()
  }

  const cellRef = (id: CellKey): ObjectRef => ({ kind: 'cell', id })

  function preselect(keys: CellKey[], on: MapId = mapId()) {
    selection().set(keys.map(cellRef), on)
  }

  function paintOn(id: MapId, cells: CellKey[]) {
    const model = useModelStore()
    return model.run('Setup', mapScope(id), (tx) =>
      paintCells(tx, model.project, map(id), cells, { areaId: WORLD_AREA_ID }),
    )
  }

  // One map, laid out so every point a test presses on can only mean one thing.
  //
  //   rooms A (0,0)-(1,1) and B (2,0)-(3,1), adjacent across the seam at x=2
  //   an edge door on that seam, between (1,0) and (2,0)
  //   an icon on (1,1)
  //   room C (0,3)-(2,3), with row y=2 bare between it and A/B
  //   bare grid everywhere else, notably around (6,6)-(8,8)
  function fixture() {
    const model = useModelStore()
    const id = mapId()
    model.run('Setup', mapScope(id), (tx) => {
      const project = model.project
      const m = map(id)
      const paint = (cells: CellKey[]) =>
        paintCells(tx, project, m, cells, { areaId: WORLD_AREA_ID })

      paint(['0,0', '1,0', '0,1', '1,1'])
      paint(['2,0', '3,0', '2,1', '3,1'])
      ok(createFromBox(tx, project, m, '1,0', '2,0'))
      ok(placeIcon(tx, m, '1,1', 'save', TEST_ICON_COLORS))
      paint(['0,3', '1,3', '2,3'])
    })
    return id
  }

  // Cells is not the default granularity, so every test here has to ask for it,
  // and it has to be asked for before anything is selected: switching clears.
  async function setup() {
    const { viewport } = await mountCanvas()
    useToolsStore().setSelectSubMode('cells')
    const id = fixture()
    return { viewport, id }
  }

  describe('what a band collects', () => {
    it('takes the owned cells it covered and nothing from bare grid', async () => {
      const { viewport } = await setup()

      await drag(viewport, at(0.5, 0.5), at(2.5, 3.5))

      expect(held()).toEqual(['0,0', '0,1', '0,3', '1,0', '1,1', '1,3', '2,0', '2,1', '2,3'])
    })

    // The grid is unbounded, so an unowned cell is not something a selection
    // can hold: there is nothing to move, cut or erase.
    it('over bare grid alone takes nothing, and clears what was selected', async () => {
      const { viewport } = await setup()
      preselect(['0,3', '1,3', '2,3'])

      await drag(viewport, at(6.5, 6.5), at(8.5, 8.5))

      expect(held()).toEqual([])
      expect(selection().isEmpty).toBe(true)
    })

    // Which room owns a cell is not the selection's business.
    it('crosses a room boundary, holding cells of both rooms', async () => {
      const { viewport } = await setup()
      expect(map().cellOwner.get('1,0')).not.toBe(map().cellOwner.get('2,0'))

      await drag(viewport, at(1.5, 0.5), at(2.5, 1.5))

      expect(held()).toEqual(['1,0', '1,1', '2,0', '2,1'])
      expect(selection().roomsOn(mapId())).toEqual([])
    })

    // The sharpest difference from the Rooms band, which takes a whole room
    // from touching one cell of it.
    it('takes the part of a room it covered, not the whole room', async () => {
      const { viewport } = await setup()

      await drag(viewport, at(0.5, 0.5), at(0.5, 1.5))

      expect(held()).toEqual(['0,0', '0,1'])
      expect(selection().roomsOn(mapId())).toEqual([])
      expect(map().rooms.get(map().cellOwner.get('0,0')!)!.cells.size).toBe(4)
    })

    it('takes the cell under an icon, not the icon', async () => {
      const { viewport } = await setup()

      await drag(viewport, at(1.5, 1.5), at(1.5, 0.5))

      expect(held()).toEqual(['1,0', '1,1'])
      expect(selection().iconsOn(mapId())).toEqual([])
    })

    it('takes the cells a door sits between, not the door', async () => {
      const { viewport } = await setup()

      await drag(viewport, at(1.5, 0.5), at(2.5, 0.5))

      expect(held()).toEqual(['1,0', '2,0'])
      expect(selection().transitionsOn(mapId())).toEqual([])
    })
  })

  // Touching, not containment: a cell inside the rectangle is taken, and the
  // rectangle's edges snap to whole cells, so the drawn edge is exactly where
  // the answer changes.
  describe('the band edge', () => {
    it('leaves out a cell the band stopped short of', async () => {
      const { viewport } = await setup()

      await drag(viewport, at(1.5, 0.5), at(2.9, 1.9))

      expect(held()).toEqual(['1,0', '1,1', '2,0', '2,1'])
    })

    it('takes a cell the band reached into by a fraction', async () => {
      const { viewport } = await setup()

      await drag(viewport, at(1.5, 0.5), at(3.1, 1.9))

      expect(held()).toEqual(['1,0', '1,1', '2,0', '2,1', '3,0', '3,1'])
    })
  })

  describe('replace and union', () => {
    it('a plain band replaces the selection', async () => {
      const { viewport } = await setup()
      preselect(['0,3', '1,3', '2,3'])

      await drag(viewport, at(0.5, 0.5), at(0.5, 1.5))

      expect(held()).toEqual(['0,0', '0,1'])
    })

    it('a shift band adds to the selection', async () => {
      const { viewport } = await setup()
      preselect(['0,3'])

      await drag(viewport, at(2.5, 0.5), at(3.5, 1.5), true)

      expect(held()).toEqual(['0,3', '2,0', '2,1', '3,0', '3,1'])
    })

    // Union, not toggle. A shift-click on an already-selected cell removes it;
    // sweeping over one leaves it selected, because a sweep covers whatever it
    // passes over and a click names one thing.
    it('a shift band leaves a cell it sweeps over already selected', async () => {
      const { viewport } = await setup()
      preselect(['1,0', '1,1'])

      await drag(viewport, at(0.5, 0.5), at(1.5, 1.5), true)

      expect(held()).toEqual(['0,0', '0,1', '1,0', '1,1'])
      expect(selection().isSelected(cellRef('1,0'))).toBe(true)
    })
  })

  // Every modifier and mode the band reads is read on `pointerdown`. What
  // happens to either afterwards cannot change the band in flight.
  describe('press-time state', () => {
    it('shift pressed after the band started does not make it additive', async () => {
      const { viewport } = await setup()
      preselect(['0,3', '1,3', '2,3'])

      viewport.dispatchEvent(press('pointerdown', at(0.5, 0.5)))
      viewport.dispatchEvent(press('pointermove', { ...at(0.5, 1.5), shiftKey: true }))
      viewport.dispatchEvent(press('pointerup', { ...at(0.5, 1.5), shiftKey: true }))
      await nextTick()
      await nextTick()

      expect(held()).toEqual(['0,0', '0,1'])
    })

    it('switching granularity mid-drag does not turn the band into a room band', async () => {
      const { viewport } = await setup()

      viewport.dispatchEvent(press('pointerdown', at(0.5, 0.5)))
      viewport.dispatchEvent(press('pointermove', at(0.5, 1.5)))
      useToolsStore().setSelectSubMode('rooms')
      await nextTick()
      viewport.dispatchEvent(press('pointerup', at(0.5, 1.5)))
      await nextTick()
      await nextTick()

      expect(held()).toEqual(['0,0', '0,1'])
      expect(selection().roomsOn(mapId())).toEqual([])
    })
  })

  describe('a band that ends where it began', () => {
    // A band one cell across covers that cell, so it selects what that cell
    // holds. Wandering out and back therefore lands on the same answer as not
    // having wandered at all, which is the click column's answer for the same
    // pointer position. Abandoning a band is `Esc`, and that keeps the
    // selection the press started with instead.
    it('takes the cell it started on, as a click there would', async () => {
      const { viewport } = await setup()
      preselect(['0,3', '1,3', '2,3'])

      viewport.dispatchEvent(press('pointerdown', at(0.5, 0.5)))
      viewport.dispatchEvent(press('pointermove', at(2.5, 1.5)))
      viewport.dispatchEvent(press('pointermove', at(0.5, 0.5)))
      viewport.dispatchEvent(press('pointerup', at(0.5, 0.5)))
      await nextTick()
      await nextTick()

      expect(held()).toEqual(['0,0'])
    })

    // The same drag from bare grid, where the cell it came back to holds
    // nothing: the band selects nothing and the selection is replaced by it.
    it('takes nothing when the cell it started on is bare grid', async () => {
      const { viewport } = await setup()
      preselect(['0,3', '1,3', '2,3'])

      viewport.dispatchEvent(press('pointerdown', at(7.5, 7.5)))
      viewport.dispatchEvent(press('pointermove', at(2.5, 1.5)))
      viewport.dispatchEvent(press('pointermove', at(7.5, 7.5)))
      viewport.dispatchEvent(press('pointerup', at(7.5, 7.5)))
      await nextTick()
      await nextTick()

      expect(selection().isEmpty).toBe(true)
    })

    // Travel inside one cell is past the dead zone but has not left the origin
    // cell, which is the other half of the rule: this is a click.
    it('a press that never leaves its origin cell selects that cell', async () => {
      const { viewport } = await setup()

      viewport.dispatchEvent(press('pointerdown', at(1.2, 0.2)))
      viewport.dispatchEvent(press('pointermove', at(1.9, 0.9)))
      viewport.dispatchEvent(press('pointerup', at(1.9, 0.9)))
      await nextTick()
      await nextTick()

      expect(held()).toEqual(['1,0'])
    })
  })

  describe('abandoning a band', () => {
    // The gesture tier outranks the selection tier, so a band in flight is what
    // Escape takes: the selection underneath it is left alone.
    it('Esc mid-drag restores the selection the press started with', async () => {
      const { viewport } = await setup()
      preselect(['0,3'])

      viewport.dispatchEvent(press('pointerdown', at(0.5, 0.5)))
      viewport.dispatchEvent(press('pointermove', at(3.5, 1.5)))
      await nextTick()
      const handled = resolveEscape()
      viewport.dispatchEvent(press('pointerup', at(3.5, 1.5)))
      await nextTick()
      await nextTick()

      expect(handled).toBe(true)
      // Neither the band's cells nor the cell the release landed on.
      expect(held()).toEqual(['0,3'])
    })
  })

  describe('a press that starts on a selected cell', () => {
    // The fragment move is not built. The claim under test is only that the
    // press does not fall through to the band.
    it('does not marquee', async () => {
      const { viewport } = await setup()
      preselect(['0,0', '0,1'])

      await drag(viewport, at(0.5, 0.5), at(3.5, 1.5))

      expect(held()).not.toContain('2,0')
      expect(held()).not.toContain('3,1')
    })
  })

  it('changes no model and leaves no undo step', async () => {
    const { viewport } = await setup()
    const model = useModelStore()
    const before = model.status.undoLabel
    const owners = [...map().cellOwner.entries()].sort()

    await drag(viewport, at(0.5, 0.5), at(3.5, 1.5))

    expect(model.status.undoLabel).toBe(before)
    expect([...map().cellOwner.entries()].sort()).toEqual(owners)
    expect(map().rooms.size).toBe(3)
    expect(map().icons.size).toBe(1)
    expect(map().transitions.size).toBe(1)
  })

  // A cell key names a cell on every map, so an unscoped cell selection would
  // light up the wrong tab.
  it('holds its cells on the tab the band was drawn on, and no other', async () => {
    const { viewport, id: first } = await setup()
    useTabsStore().addTab()
    await nextTick()
    const second = mapId()
    paintOn(second, ['0,0', '1,0', '0,1', '1,1'])
    await nextTick()

    await drag(viewport, at(0.5, 0.5), at(1.5, 1.5))

    expect(held(second)).toEqual(['0,0', '0,1', '1,0', '1,1'])
    expect(held(first)).toEqual([])
    expect(selection().mapId).toBe(second)
  })
})
