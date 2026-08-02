import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import CanvasRegion from './CanvasRegion.vue'
import { useTabsStore } from '@/stores/tabs'
import { useCanvasViewStore } from '@/stores/canvasView'
import { useModeStore } from '@/stores/mode'
import { useToolsStore } from '@/stores/tools'
import { useActiveRoomStore } from '@/stores/activeRoom'
import { usePendingTeleportStore } from '@/stores/pendingTeleport'
import { useSelectionStore } from '@/stores/selection'
import { pushEscHandler, resolveEscape } from '@/hotkeys/escStack'
import { PROJECT_SCOPE, mapScope, useModelStore } from '@/stores/model'
import { updateSetting } from '@/core/ops/project'
import { paintCells, eraseCells } from '@/core/ops/rooms'
import { createFromBox, createTeleport } from '@/core/ops/doors'
import { edgeOfCell } from '@/core/cell'
import { WORLD_AREA_ID } from '@/core/ids'
import { runAction } from '@/hotkeys/actions'
import { checkInvariants } from '@/core/testUtils'
import { DEFAULT_PAN, screenToWorld } from '@/canvas/viewport'
import { DRAG_DEAD_ZONE } from '@/config/constants'
import type { MapId } from '@/core/ids'
import type { FakeContext2D } from '@/test-setup'

function wheel(init: Partial<WheelEventInit>) {
  return new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
}

describe('CanvasRegion wheel zoom', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  it('zooms in on ctrl+wheel with negative deltaY', () => {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const tabsStore = useTabsStore()
    const tabId = tabsStore.activeTabId

    wrapper.get('.canvas-viewport').element.dispatchEvent(wheel({ ctrlKey: true, deltaY: -100 }))

    expect(tabsStore.cameraOf(tabId).zoom).toBeGreaterThan(1)
    wrapper.unmount()
  })

  it('zooms out on ctrl+wheel with positive deltaY', () => {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const tabsStore = useTabsStore()
    const tabId = tabsStore.activeTabId

    wrapper.get('.canvas-viewport').element.dispatchEvent(wheel({ ctrlKey: true, deltaY: 100 }))

    expect(tabsStore.cameraOf(tabId).zoom).toBeLessThan(1)
    wrapper.unmount()
  })

  // jsdom reports a zeroed rect for everything, so the pointer offset has to be
  // stubbed in: without it the anchor is always (0,0).
  it('anchors the zoom on the pointer, keeping that world point under it', () => {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const tabsStore = useTabsStore()
    const tabId = tabsStore.activeTabId

    const viewport = wrapper.get('.canvas-viewport').element
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect

    const tile = useModelStore().tileSize
    const before = tabsStore.cameraOf(tabId)
    const anchor = { x: 400, y: 300 }
    const worldUnderCursor = screenToWorld(anchor.x, anchor.y, before, tile)

    viewport.dispatchEvent(
      wheel({ ctrlKey: true, deltaY: -120, clientX: anchor.x, clientY: anchor.y }),
    )

    const after = tabsStore.cameraOf(tabId)
    expect(after.zoom).toBeGreaterThan(1)
    const stillThere = screenToWorld(anchor.x, anchor.y, after, tile)
    expect(stillThere.x).toBeCloseTo(worldUnderCursor.x)
    expect(stillThere.y).toBeCloseTo(worldUnderCursor.y)
    wrapper.unmount()
  })

  it('leaves zoom untouched on plain wheel (no ctrl/meta): that pans instead', () => {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const tabsStore = useTabsStore()
    const tabId = tabsStore.activeTabId

    wrapper.get('.canvas-viewport').element.dispatchEvent(wheel({ deltaY: -100 }))

    expect(tabsStore.cameraOf(tabId).zoom).toBe(1)
    wrapper.unmount()
  })
})

describe('CanvasRegion wheel pan', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  it('plain wheel pans both axes, converting px delta to world-cell units at the current zoom', () => {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const tabsStore = useTabsStore()
    const tabId = tabsStore.activeTabId

    wrapper.get('.canvas-viewport').element.dispatchEvent(wheel({ deltaX: 64, deltaY: 32 }))

    const tab = tabsStore.cameraOf(tabId)
    // Converted at the project's own tile size, not a renderer constant.
    const tile = useModelStore().tileSize
    expect(tab.pan.x).toBeCloseTo(DEFAULT_PAN.x + 64 / (tile * 1))
    expect(tab.pan.y).toBeCloseTo(DEFAULT_PAN.y + 32 / (tile * 1))
    wrapper.unmount()
  })

  it('does not pan on ctrl+wheel (that zooms instead)', () => {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const tabsStore = useTabsStore()
    const tabId = tabsStore.activeTabId

    wrapper
      .get('.canvas-viewport')
      .element.dispatchEvent(wheel({ ctrlKey: true, deltaX: 64, deltaY: -100 }))

    expect(tabsStore.cameraOf(tabId).pan).toEqual(DEFAULT_PAN)
    wrapper.unmount()
  })
})

describe('CanvasRegion drawing', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  it('fills the pasteboard and page, and strokes the grid, on mount', () => {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    // .canvas, not the bare 'canvas' tag: the top/left ruler are also
    // <canvas> elements and come first in DOM order.
    const canvasEl = wrapper.get('.canvas').element as HTMLCanvasElement
    const ctx = canvasEl.getContext('2d') as unknown as FakeContext2D

    expect(ctx.fillRect).toHaveBeenCalled()
    expect(ctx.stroke).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('redraws when zoom changes', async () => {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const tabsStore = useTabsStore()
    const canvasEl = wrapper.get('.canvas').element as HTMLCanvasElement
    const ctx = canvasEl.getContext('2d') as unknown as FakeContext2D
    const callsBefore = ctx.fillRect.mock.calls.length

    tabsStore.setZoom(tabsStore.activeTabId, 2)
    await nextTick()

    expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(callsBefore)
    wrapper.unmount()
  })

  // End to end: the tile size is a project setting, so changing it has to
  // reach the page geometry.
  it('draws at the project tile size, and follows a change to it', async () => {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const model = useModelStore()
    const canvasEl = wrapper.get('.canvas').element as HTMLCanvasElement
    const ctx = canvasEl.getContext('2d') as unknown as FakeContext2D

    // The page fill is the second fillRect: pasteboard first, then page.
    const pageWidth = () => {
      const call = ctx.fillRect.mock.calls.at(-1)!
      return call[2] as number
    }
    const before = pageWidth()

    model.run('Tile size', PROJECT_SCOPE, (tx) =>
      updateSetting(tx, model.project, 'tileSize', model.tileSize * 2),
    )
    await nextTick()

    expect(pageWidth()).toBeCloseTo(before * 2)
    wrapper.unmount()
  })

  // The canvas cannot watch the model directly (it is outside Vue reactivity),
  // so it watches the map's revision rather than only the derived values:
  // painting inside the existing page bounds moves no bound, camera value or
  // id, so a canvas keyed on those alone would never repaint.
  it('redraws when the map changes without moving its bounds', async () => {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const tabsStore = useTabsStore()
    const model = useModelStore()
    const canvasEl = wrapper.get('.canvas').element as HTMLCanvasElement
    const ctx = canvasEl.getContext('2d') as unknown as FakeContext2D

    const mapId = tabsStore.activeTabId
    // Well inside the minimum sheet, so `pageBounds` is unchanged by it.
    model.run('Paint', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, model.project.mapsById.get(mapId)!, ['5,5'], {
        areaId: WORLD_AREA_ID,
      }),
    )
    const boundsBefore = tabsStore.activeTab!.bounds
    await nextTick()
    const callsBefore = ctx.fillRect.mock.calls.length

    model.run('Paint', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, model.project.mapsById.get(mapId)!, ['6,5'], {
        areaId: WORLD_AREA_ID,
      }),
    )
    await nextTick()

    expect(tabsStore.activeTab!.bounds).toEqual(boundsBefore)
    expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(callsBefore)
    wrapper.unmount()
  })
})

describe('CanvasRegion view toggles', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
    // jsdom has no real layout: getBoundingClientRect always returns zeros,
    // which collapses the ruler's visible-cell range to a single cell.
    // Stub a realistic viewport size so there's actually a range to tick.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON() {},
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('skips the grid stroke on the main canvas when showGrid is off', () => {
    const canvasView = useCanvasViewStore()
    canvasView.toggleGrid()
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const canvasEl = wrapper.get('.canvas').element as HTMLCanvasElement
    const ctx = canvasEl.getContext('2d') as unknown as FakeContext2D

    expect(ctx.fillRect).toHaveBeenCalled() // pasteboard/page fills still happen
    expect(ctx.stroke).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('tracks the real cursor cell on pointer move, and clears it on leave', async () => {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    expect(wrapper.get('.coords-overlay').text()).toBe('-, -')

    const viewport = wrapper.get('.canvas-viewport').element
    viewport.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 64, clientY: 32, bubbles: true }),
    )
    await nextTick()
    expect(wrapper.get('.coords-overlay').text()).not.toBe('-, -')

    viewport.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
    await nextTick()
    expect(wrapper.get('.coords-overlay').text()).toBe('-, -')
    wrapper.unmount()
  })

  it('hides the coords overlay entirely when showCoords is off', () => {
    const canvasView = useCanvasViewStore()
    canvasView.toggleCoords()
    const wrapper = mount(CanvasRegion, { attachTo: document.body })

    expect(wrapper.find('.coords-overlay').exists()).toBe(false)
    wrapper.unmount()
  })

  it('draws ruler tick marks and major-tick labels when rulers are shown', () => {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const topRulerEl = wrapper.get('.ruler-top').element as HTMLCanvasElement
    const ctx = topRulerEl.getContext('2d') as unknown as FakeContext2D

    expect(ctx.stroke).toHaveBeenCalled()
    expect(ctx.fillText).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not draw the rulers when hidden', () => {
    const canvasView = useCanvasViewStore()
    canvasView.toggleRulers()
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const topRulerEl = wrapper.get('.ruler-top').element as HTMLCanvasElement
    const ctx = topRulerEl.getContext('2d') as unknown as FakeContext2D

    expect(ctx.fillText).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

// The transitions layer, and the one policy this component owns: Door mode
// overrides the master toggle, since entering it is a statement that you are
// working on transitions, so the toggle applies to every other mode.
//
// The gating itself is `canvas/renderMap.test.ts`; proved here is that the
// flags reach the scene, changing one repaints, and Door mode overrides the
// master while leaving the sub-toggle alone.
describe('CanvasRegion transition layers', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    const canvasEl = wrapper.get('.canvas').element as HTMLCanvasElement
    const ctx = canvasEl.getContext('2d') as unknown as FakeContext2D
    return { wrapper, ctx, paints: () => ctx.fillRect.mock.calls.length }
  }

  // Two rooms, a door between them and a teleport across them, so the count
  // below has a shaftless door marker and two teleport markers to lose.
  function twoRoomsADoorAndATeleport() {
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    model.run('Setup', mapScope(mapId), (tx) => {
      const map = model.project.mapsById.get(mapId)!
      paintCells(tx, model.project, map, ['0,0', '0,1'], { areaId: WORLD_AREA_ID })
      paintCells(tx, model.project, map, ['1,0', '1,1'], { areaId: WORLD_AREA_ID })
      createFromBox(tx, model.project, map, '0,0', '1,0')
      createTeleport(tx, model.project, { mapId, cell: '0,1' }, { mapId, cell: '1,1' })
    })
    return mapId
  }

  it('paints fewer rects with the layer hidden, outside Door mode', () => {
    twoRoomsADoorAndATeleport()
    const shown = mountCanvas()
    const withLayer = shown.paints()
    shown.wrapper.unmount()

    useCanvasViewStore().toggleTransitions()
    const hidden = mountCanvas()

    expect(hidden.paints()).toBeLessThan(withLayer)
    hidden.wrapper.unmount()
  })

  // The override, and the reason for it: the objects do not stop existing with
  // the pixels, so a Door-mode press on an invisible door would miss it, start
  // a teleport instead, and be refused with nothing on screen to explain why.
  it('keeps drawing them in Door mode with the layer hidden', () => {
    twoRoomsADoorAndATeleport()
    useCanvasViewStore().toggleTransitions()
    useModeStore().setMode('door')

    const hidden = mountCanvas()
    const doorMode = hidden.paints()
    hidden.wrapper.unmount()

    // Identical to the same map with the layer on, in the same mode.
    useCanvasViewStore().toggleTransitions()
    const shown = mountCanvas()

    expect(doorMode).toBe(shown.paints())
    shown.wrapper.unmount()
  })

  // Leaving Door mode gives the toggle back its say, and that is a repaint the
  // mode watcher already owns: worth pinning, because the override lives in
  // the scene builder rather than in anything that watches.
  it('drops them again on leaving Door mode', async () => {
    twoRoomsADoorAndATeleport()
    useCanvasViewStore().toggleTransitions()
    useModeStore().setMode('door')
    const { wrapper, paints } = mountCanvas()
    const inDoorMode = paints()

    useModeStore().setMode('draw')
    await nextTick()

    expect(paints()).toBeGreaterThan(inDoorMode)
    // ...and the second paint is smaller than the first, which is the whole
    // claim: the repaint drew less, not merely again.
    expect(paints() - inDoorMode).toBeLessThan(inDoorMode)
    wrapper.unmount()
  })

  it('repaints when either toggle changes', async () => {
    twoRoomsADoorAndATeleport()
    const { wrapper, ctx } = mountCanvas()
    const canvasView = useCanvasViewStore()

    const before = ctx.clearRect.mock.calls.length
    canvasView.toggleTransitions()
    await nextTick()
    const afterMaster = ctx.clearRect.mock.calls.length
    expect(afterMaster).toBeGreaterThan(before)

    // The sub-toggle refuses while the master is off, so put it back first:
    // otherwise this asserts a repaint for a change that never happened.
    canvasView.toggleTransitions()
    await nextTick()
    const beforeSub = ctx.clearRect.mock.calls.length
    canvasView.toggleTeleportLines()
    await nextTick()

    expect(ctx.clearRect.mock.calls.length).toBeGreaterThan(beforeSub)
    wrapper.unmount()
  })

  // Only the master is overridden. A teleport line is not a target in any
  // mode (Door mode's table has no row for one), so hiding it hides nothing
  // you could act on, and the mode has no reason to override it.
  it('leaves the teleport-lines sub-toggle honoured in Door mode', () => {
    twoRoomsADoorAndATeleport()
    useModeStore().setMode('door')
    const shown = mountCanvas()
    const withLines = shown.ctx.stroke.mock.calls.length
    shown.wrapper.unmount()

    useCanvasViewStore().toggleTeleportLines()
    const hidden = mountCanvas()

    expect(hidden.ctx.stroke.mock.calls.length).toBeLessThan(withLines)
    hidden.wrapper.unmount()
  })
})

// The wiring only: the gesture's own rules are `gestures/paintStroke.test.ts`.
// What is proved here is that a real pointer stream reaches it, that the world
// point it is handed accounts for the camera, and that the modes which have no
// gesture yet stay inert.
describe('CanvasRegion painting', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  // jsdom reports a zeroed rect for everything, so the viewport's origin has to
  // be stubbed in or every pointer point collapses to (0,0).
  function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    viewport.setPointerCapture = () => {}
    return { wrapper, viewport }
  }

  function pointer(type: string, init: PointerEventInit = {}) {
    return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  }

  // The camera starts at DEFAULT_PAN, so screen (0,0) is not world (0,0): a
  // gesture that forgot the conversion would paint in the wrong place and this
  // is what would catch it.
  function screenOf(col: number, row: number) {
    const tabsStore = useTabsStore()
    const tile = useModelStore().tileSize
    const camera = tabsStore.cameraOf(tabsStore.activeTabId)
    return {
      clientX: (col + 0.5 - camera.pan.x) * tile * camera.zoom,
      clientY: (row + 0.5 - camera.pan.y) * tile * camera.zoom,
    }
  }

  it('paints the cell under a click, committed on release', () => {
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId

    viewport.dispatchEvent(pointer('pointerdown', screenOf(3, 2)))
    viewport.dispatchEvent(pointer('pointerup', screenOf(3, 2)))

    expect(model.project.mapsById.get(mapId)!.cellOwner.get('3,2')).toBeDefined()
    expect(model.status.undoLabel).toBe('Paint')
    wrapper.unmount()
  })

  it('paints the swath a drag crosses, as one undo step', () => {
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId

    viewport.dispatchEvent(pointer('pointerdown', screenOf(0, 0)))
    viewport.dispatchEvent(pointer('pointermove', screenOf(2, 0)))
    viewport.dispatchEvent(pointer('pointermove', screenOf(2, 2)))
    viewport.dispatchEvent(pointer('pointerup', screenOf(2, 2)))

    const map = model.project.mapsById.get(mapId)!
    expect(map.rooms.size).toBe(1)
    expect([...map.rooms.values()][0].cells.size).toBe(5)

    model.undo()
    expect(map.rooms.size).toBe(0)
    wrapper.unmount()
  })

  it('shows the pending stroke before release', () => {
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId

    viewport.dispatchEvent(pointer('pointerdown', screenOf(0, 0)))
    viewport.dispatchEvent(pointer('pointermove', screenOf(3, 0)))

    // On the canvas but not on the undo stack: the ghost is the model.
    expect(model.project.mapsById.get(mapId)!.rooms.size).toBe(1)
    expect(model.status.canUndo).toBe(false)

    // Released after the assertion rather than left hanging: escStack tiers are
    // module-global, so a stroke left open keeps a live handler in the gesture
    // tier for every test that runs after this one.
    viewport.dispatchEvent(pointer('pointerup', screenOf(3, 0)))
    wrapper.unmount()
  })

  it('leaves the other modes alone', () => {
    const modeStore = useModeStore()
    modeStore.setMode('select')
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()

    viewport.dispatchEvent(pointer('pointerdown', screenOf(3, 2)))
    viewport.dispatchEvent(pointer('pointerup', screenOf(3, 2)))

    expect(model.project.mapsById.get(useTabsStore().activeTabId)!.rooms.size).toBe(0)
    wrapper.unmount()
  })

  // Middle-drag pan does not exist yet. Until it does, the middle button must
  // stay inert rather than falling through to painting.
  it('ignores the middle button', () => {
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()

    viewport.dispatchEvent(pointer('pointerdown', { ...screenOf(3, 2), button: 1 }))
    viewport.dispatchEvent(pointer('pointerup', { ...screenOf(3, 2), button: 1 }))

    expect(model.project.mapsById.get(useTabsStore().activeTabId)!.rooms.size).toBe(0)
    wrapper.unmount()
  })
})

// Again the wiring only: the gesture's rules are `gestures/eraseStroke.test.ts`
// and the input table is `gestures/strokeAction.test.ts`. What is proved here is
// that all three erase routes reach the gesture through a real pointer stream,
// and that the browser menu stays out of the way of the first one.
describe('CanvasRegion erasing', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    viewport.setPointerCapture = () => {}
    return { wrapper, viewport }
  }

  function pointer(type: string, init: PointerEventInit = {}) {
    return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  }

  function screenOf(col: number, row: number) {
    const tabsStore = useTabsStore()
    const tile = useModelStore().tileSize
    const camera = tabsStore.cameraOf(tabsStore.activeTabId)
    return {
      clientX: (col + 0.5 - camera.pan.x) * tile * camera.zoom,
      clientY: (row + 0.5 - camera.pan.y) * tile * camera.zoom,
    }
  }

  // A strip to erase, painted outside any gesture.
  function strip(mapId: MapId, cells: string[]) {
    const model = useModelStore()
    model.run('Setup', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, model.project.mapsById.get(mapId)!, cells, {
        areaId: WORLD_AREA_ID,
      }),
    )
  }

  it('erases on right-click', () => {
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    strip(mapId, ['3,2'])

    viewport.dispatchEvent(pointer('pointerdown', { ...screenOf(3, 2), button: 2 }))
    viewport.dispatchEvent(pointer('pointerup', { ...screenOf(3, 2), button: 2 }))

    expect(model.project.mapsById.get(mapId)!.cellOwner.has('3,2')).toBe(false)
    expect(model.status.undoLabel).toBe('Erase')
    wrapper.unmount()
  })

  it('erases a swath on right-drag, as one undo step', () => {
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    strip(mapId, ['0,0', '1,0', '2,0', '3,0'])

    viewport.dispatchEvent(pointer('pointerdown', { ...screenOf(0, 0), button: 2 }))
    viewport.dispatchEvent(pointer('pointermove', { ...screenOf(2, 0), button: 2 }))
    viewport.dispatchEvent(pointer('pointerup', { ...screenOf(2, 0), button: 2 }))

    const map = model.project.mapsById.get(mapId)!
    expect([...map.cellOwner.keys()]).toEqual(['3,0'])

    model.undo()
    expect(map.cellOwner.size).toBe(4)
    wrapper.unmount()
  })

  // Right-drag would otherwise be interrupted by the browser's own menu.
  // Suppressed on the viewport only: the rest of the app keeps it.
  it('suppresses the browser context menu on the viewport', () => {
    const { wrapper, viewport } = mountCanvas()

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    viewport.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    wrapper.unmount()
  })

  it('erases with the primary button while the erase toggle is on', () => {
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    strip(mapId, ['3,2'])
    useToolsStore().toggleErase()

    viewport.dispatchEvent(pointer('pointerdown', screenOf(3, 2)))
    viewport.dispatchEvent(pointer('pointerup', screenOf(3, 2)))

    expect(model.project.mapsById.get(mapId)!.cellOwner.has('3,2')).toBe(false)
    expect(model.status.undoLabel).toBe('Erase')
    wrapper.unmount()
  })

  it("erases on a stylus's eraser end without the toggle", () => {
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    strip(mapId, ['3,2'])

    const init = { ...screenOf(3, 2), button: 5, pointerType: 'pen' }
    viewport.dispatchEvent(pointer('pointerdown', init))
    viewport.dispatchEvent(pointer('pointerup', init))

    expect(model.project.mapsById.get(mapId)!.cellOwner.has('3,2')).toBe(false)
    wrapper.unmount()
  })

  // The gesture is speculative, so the cells are already gone from the model
  // while the button is still down: that is the preview.
  it('shows the pending erase before release', () => {
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    strip(mapId, ['0,0', '1,0', '2,0'])

    viewport.dispatchEvent(pointer('pointerdown', { ...screenOf(0, 0), button: 2 }))
    viewport.dispatchEvent(pointer('pointermove', { ...screenOf(2, 0), button: 2 }))

    expect(model.project.mapsById.get(mapId)!.rooms.size).toBe(0)
    expect(model.status.undoLabel).toBe('Setup')

    // Released for the same reason as the paint case above: the gesture tier
    // is module-global.
    viewport.dispatchEvent(pointer('pointerup', { ...screenOf(2, 0), button: 2 }))
    wrapper.unmount()
  })

  it('erases through the middle of a room, splitting it', () => {
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    strip(mapId, ['0,0', '1,0', '2,0'])

    viewport.dispatchEvent(pointer('pointerdown', { ...screenOf(1, 0), button: 2 }))
    viewport.dispatchEvent(pointer('pointerup', { ...screenOf(1, 0), button: 2 }))

    expect(model.project.mapsById.get(mapId)!.rooms.size).toBe(2)
    wrapper.unmount()
  })

  it('still paints on the primary button with the toggle off', () => {
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId

    viewport.dispatchEvent(pointer('pointerdown', screenOf(3, 2)))
    viewport.dispatchEvent(pointer('pointerup', screenOf(3, 2)))

    expect(model.project.mapsById.get(mapId)!.cellOwner.has('3,2')).toBe(true)
    wrapper.unmount()
  })

  it('leaves the other modes alone', () => {
    useModeStore().setMode('markup')
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    strip(mapId, ['3,2'])

    viewport.dispatchEvent(pointer('pointerdown', { ...screenOf(3, 2), button: 2 }))
    viewport.dispatchEvent(pointer('pointerup', { ...screenOf(3, 2), button: 2 }))

    expect(model.project.mapsById.get(mapId)!.cellOwner.has('3,2')).toBe(true)
    wrapper.unmount()
  })
})

// The brush footprint's aiming aid, and the one thing in this component that
// repaints on a bare pointer move. Hover stays free of work by default, and a
// preview gives that up only where it buys something: see
// `gestures/brushStroke.test.ts` for the footprint itself.
describe('CanvasRegion brush preview', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    const canvasEl = wrapper.get('.canvas').element as HTMLCanvasElement
    const ctx = canvasEl.getContext('2d') as unknown as FakeContext2D
    return { wrapper, viewport, ctx, paints: () => ctx.fillRect.mock.calls.length }
  }

  function movePointer(viewport: HTMLElement, clientX: number, clientY: number) {
    viewport.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY, bubbles: true }))
  }

  // The common case keeps the cost it had: a 1×1 brush needs no preview to aim
  // with, so hovering must stay free.
  it('does not repaint on hover at 1×1', () => {
    const { wrapper, viewport, paints } = mountCanvas()
    const before = paints()

    movePointer(viewport, 100, 100)
    movePointer(viewport, 240, 180)

    expect(paints()).toBe(before)
    wrapper.unmount()
  })

  it('repaints as the footprint moves with a sized brush', () => {
    useToolsStore().setBrushSize(3)
    const { wrapper, viewport, paints } = mountCanvas()
    const before = paints()

    movePointer(viewport, 100, 100)

    expect(paints()).toBeGreaterThan(before)
    wrapper.unmount()
  })

  // Gated on the footprint actually moving a whole cell, so travelling within
  // one cell is still free even at N > 1.
  it('does not repaint while the footprint has not moved', () => {
    useToolsStore().setBrushSize(3)
    const { wrapper, viewport, paints } = mountCanvas()

    movePointer(viewport, 100, 100)
    const afterFirst = paints()
    movePointer(viewport, 101, 101)

    expect(paints()).toBe(afterFirst)
    wrapper.unmount()
  })

  it('drops the preview when the pointer leaves the canvas', () => {
    useToolsStore().setBrushSize(3)
    const { wrapper, viewport, paints } = mountCanvas()
    movePointer(viewport, 100, 100)
    const before = paints()

    viewport.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))

    expect(paints()).toBeGreaterThan(before)
    wrapper.unmount()
  })

  // `[`/`]` should read as changing the thing under your cursor, not as
  // something that takes effect the next time you move.
  it('redraws in place when the brush is resized', async () => {
    const tools = useToolsStore()
    tools.setBrushSize(3)
    const { wrapper, viewport, paints } = mountCanvas()
    movePointer(viewport, 100, 100)
    const before = paints()

    tools.growBrush()
    await nextTick()

    expect(paints()).toBeGreaterThan(before)
    wrapper.unmount()
  })
})

// Draw/Edit's active room. The store's own rules are `stores/activeRoom.test.ts`;
// what is proved here is the arming that only the component can do: the press
// rule and the Esc tier.
describe('CanvasRegion active room', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    viewport.setPointerCapture = () => {}
    return { wrapper, viewport }
  }

  function mountCanvasWithCtx() {
    const mounted = mountCanvas()
    const ctx = (mounted.wrapper.get('.canvas').element as HTMLCanvasElement).getContext(
      '2d',
    ) as unknown as FakeContext2D
    return { ...mounted, ctx }
  }

  function pointer(type: string, init: PointerEventInit = {}) {
    return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  }

  function screenOf(col: number, row: number) {
    const tabsStore = useTabsStore()
    const tile = useModelStore().tileSize
    const camera = tabsStore.cameraOf(tabsStore.activeTabId)
    return {
      clientX: (col + 0.5 - camera.pan.x) * tile * camera.zoom,
      clientY: (row + 0.5 - camera.pan.y) * tile * camera.zoom,
    }
  }

  function strip(mapId: MapId, cells: string[]) {
    const model = useModelStore()
    return model.run('Setup', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, model.project.mapsById.get(mapId)!, cells, {
        areaId: WORLD_AREA_ID,
      }),
    ).id
  }

  // Pressing any room cell makes it active on the press, not the release, so a
  // press that goes on to become a paint stroke has still armed it.
  it('arms the room under a press, before the pointer moves', () => {
    const { wrapper, viewport } = mountCanvas()
    const active = useActiveRoomStore()
    const mapId = useTabsStore().activeTabId
    const roomId = strip(mapId, ['3,2', '4,2'])

    viewport.dispatchEvent(pointer('pointerdown', screenOf(3, 2)))

    expect(active.roomIdOn(mapId)).toBe(roomId)

    // Released before unmounting: the gesture tier is module-global, so a
    // stroke left open outlives this test.
    viewport.dispatchEvent(pointer('pointerup', screenOf(3, 2)))
    wrapper.unmount()
  })

  it('arms on a right-press too: the rule is about the press, not the tool', () => {
    const { wrapper, viewport } = mountCanvas()
    const active = useActiveRoomStore()
    const mapId = useTabsStore().activeTabId
    const roomId = strip(mapId, ['3,2', '4,2'])

    viewport.dispatchEvent(pointer('pointerdown', { ...screenOf(4, 2), button: 2 }))

    expect(active.roomIdOn(mapId)).toBe(roomId)

    viewport.dispatchEvent(pointer('pointerup', { ...screenOf(4, 2), button: 2 }))
    wrapper.unmount()
  })

  // There is no canvas deselect: the active room is simply whatever you last
  // touched or edited. Pressing empty grid paints, and the new room becomes
  // active; it never clears to nothing.
  it('arms the room a paint stroke created, on release', () => {
    const { wrapper, viewport } = mountCanvas()
    const active = useActiveRoomStore()
    const mapId = useTabsStore().activeTabId

    viewport.dispatchEvent(pointer('pointerdown', screenOf(6, 6)))
    expect(active.isArmed).toBe(false)

    viewport.dispatchEvent(pointer('pointerup', screenOf(6, 6)))

    const roomId = useModelStore().project.mapsById.get(mapId)!.cellOwner.get('6,6')
    expect(active.roomIdOn(mapId)).toBe(roomId)
    wrapper.unmount()
  })

  // Arming happens on commit, so a stroke that Esc un-made leaves no handles
  // pointing at a room that never existed.
  it('does not arm a room an aborted stroke un-made', () => {
    const { wrapper, viewport } = mountCanvas()
    const active = useActiveRoomStore()

    viewport.dispatchEvent(pointer('pointerdown', screenOf(6, 6)))
    viewport.dispatchEvent(pointer('pointermove', screenOf(8, 6)))
    expect(resolveEscape()).toBe(true)
    viewport.dispatchEvent(pointer('pointerup', screenOf(8, 6)))

    expect(active.isArmed).toBe(false)
    wrapper.unmount()
  })

  describe('Esc', () => {
    // One tier below the gesture tier: a live drag aborts first, and only a
    // second press deselects.
    it('aborts a live stroke first, and clears the room only on a second press', () => {
      const { wrapper, viewport } = mountCanvas()
      const active = useActiveRoomStore()
      const mapId = useTabsStore().activeTabId
      strip(mapId, ['3,2', '4,2'])

      viewport.dispatchEvent(pointer('pointerdown', screenOf(3, 2)))
      viewport.dispatchEvent(pointer('pointermove', screenOf(6, 2)))
      expect(active.isArmed).toBe(true)

      // First press: the gesture tier takes it.
      resolveEscape()
      expect(active.isArmed).toBe(true)
      viewport.dispatchEvent(pointer('pointerup', screenOf(6, 2)))

      // Second press: now it reaches the active room.
      resolveEscape()
      expect(active.isArmed).toBe(false)
      wrapper.unmount()
    })

    // Registered only while something is armed. A permanently registered
    // handler would sit at the top of the selection tier, swallowing every Esc
    // that should have fallen through to the no-op tier now, and to
    // Select/Move's real deselect later.
    //
    // The sentinel goes in before mounting on purpose: pushed afterwards it
    // would sit on top of anything the component registered and fire first, so
    // the test would pass either way.
    it('registers nothing while no room is armed', () => {
      const sentinel = vi.fn<() => void>()
      const pop = pushEscHandler('selection', sentinel)
      const { wrapper } = mountCanvas()

      expect(resolveEscape()).toBe(true)
      expect(sentinel).toHaveBeenCalledTimes(1)

      pop()
      wrapper.unmount()
    })

    it('sits above a lower handler while armed, and steps aside once cleared', () => {
      const sentinel = vi.fn<() => void>()
      const pop = pushEscHandler('selection', sentinel)
      const { wrapper, viewport } = mountCanvas()
      const active = useActiveRoomStore()
      const mapId = useTabsStore().activeTabId
      strip(mapId, ['3,2'])

      viewport.dispatchEvent(pointer('pointerdown', screenOf(3, 2)))
      viewport.dispatchEvent(pointer('pointerup', screenOf(3, 2)))
      expect(active.isArmed).toBe(true)

      // Armed, so the component's handler is above the sentinel and takes this.
      resolveEscape()
      expect(active.isArmed).toBe(false)
      expect(sentinel).not.toHaveBeenCalled()

      // Having cleared, it has unregistered: the next press falls through.
      resolveEscape()
      expect(sentinel).toHaveBeenCalledTimes(1)

      pop()
      wrapper.unmount()
    })
  })

  // Idle handles are faint hints and the hovered one inflates, so the component
  // has to track which handle the pointer is over, and repaint only when that
  // answer changes: the same gating the brush preview uses.
  describe('handle hover', () => {
    it('does not repaint on hover while no room is armed', () => {
      const { wrapper, viewport, ctx } = mountCanvasWithCtx()
      const mapId = useTabsStore().activeTabId
      strip(mapId, ['3,2', '4,2', '3,3', '4,3'])
      const before = ctx.fillRect.mock.calls.length

      viewport.dispatchEvent(new PointerEvent('pointermove', { ...screenOf(3, 2), bubbles: true }))

      expect(ctx.fillRect.mock.calls.length).toBe(before)
      wrapper.unmount()
    })

    it('repaints when the pointer moves onto a handle, and off it again', async () => {
      const { wrapper, viewport, ctx } = mountCanvasWithCtx()
      const mapId = useTabsStore().activeTabId
      strip(mapId, ['3,2', '4,2', '3,3', '4,3'])

      // Arm the room, then settle.
      viewport.dispatchEvent(pointer('pointerdown', screenOf(3, 2)))
      viewport.dispatchEvent(pointer('pointerup', screenOf(3, 2)))
      await nextTick()

      // The interior vertex where the four cells meet.
      const tile = useModelStore().tileSize
      const camera = useTabsStore().cameraOf(mapId)
      const onVertex = {
        clientX: (4 - camera.pan.x) * tile * camera.zoom,
        clientY: (3 - camera.pan.y) * tile * camera.zoom,
        bubbles: true,
      }
      const before = ctx.fillRect.mock.calls.length
      viewport.dispatchEvent(new PointerEvent('pointermove', onVertex))
      const onHandle = ctx.fillRect.mock.calls.length
      expect(onHandle).toBeGreaterThan(before)

      // Away from every handle: back to all-faint, which is another change.
      viewport.dispatchEvent(new PointerEvent('pointermove', { ...screenOf(9, 9), bubbles: true }))
      expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(onHandle)
      wrapper.unmount()
    })

    // The reveal window follows the pointer's cell, so crossing a cell
    // boundary changes which vertex targets are drawn even when no handle is
    // hovered before or after.
    it('repaints when the pointer crosses into another cell', async () => {
      const { wrapper, viewport, ctx } = mountCanvasWithCtx()
      const mapId = useTabsStore().activeTabId
      strip(mapId, ['3,2', '4,2', '3,3', '4,3'])
      viewport.dispatchEvent(pointer('pointerdown', screenOf(3, 2)))
      viewport.dispatchEvent(pointer('pointerup', screenOf(3, 2)))
      await nextTick()

      // Two cells well clear of every handle, so only the window moved.
      viewport.dispatchEvent(new PointerEvent('pointermove', { ...screenOf(8, 8), bubbles: true }))
      const before = ctx.fillRect.mock.calls.length
      viewport.dispatchEvent(new PointerEvent('pointermove', { ...screenOf(9, 9), bubbles: true }))

      expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(before)
      wrapper.unmount()
    })

    it('does not repaint while the pointer stays on the same handle', async () => {
      const { wrapper, viewport, ctx } = mountCanvasWithCtx()
      const mapId = useTabsStore().activeTabId
      strip(mapId, ['3,2', '4,2', '3,3', '4,3'])
      viewport.dispatchEvent(pointer('pointerdown', screenOf(3, 2)))
      viewport.dispatchEvent(pointer('pointerup', screenOf(3, 2)))
      await nextTick()

      const tile = useModelStore().tileSize
      const camera = useTabsStore().cameraOf(mapId)
      const at = (dx: number, dy: number) => ({
        clientX: (4 - camera.pan.x) * tile * camera.zoom + dx,
        clientY: (3 - camera.pan.y) * tile * camera.zoom + dy,
        bubbles: true,
      })

      viewport.dispatchEvent(new PointerEvent('pointermove', at(0, 0)))
      const settled = ctx.fillRect.mock.calls.length
      viewport.dispatchEvent(new PointerEvent('pointermove', at(1, 1)))

      expect(ctx.fillRect.mock.calls.length).toBe(settled)
      wrapper.unmount()
    })
  })

  it('repaints when a room is armed', async () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = useTabsStore().activeTabId
    strip(mapId, ['3,2', '4,2'])
    const ctx = (wrapper.get('.canvas').element as HTMLCanvasElement).getContext(
      '2d',
    ) as unknown as FakeContext2D
    await nextTick()
    const before = ctx.fillRect.mock.calls.length

    viewport.dispatchEvent(pointer('pointerdown', screenOf(3, 2)))
    await nextTick()

    expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(before)

    viewport.dispatchEvent(pointer('pointerup', screenOf(3, 2)))
    wrapper.unmount()
  })
})

// The "Outer edge-run >= 2" row of the precedence table, at the level where
// the press is actually classified: which gesture a pointerdown opens. What
// the gesture then does is `gestures/runResize.test.ts`.
describe('CanvasRegion edge-run resize', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    viewport.setPointerCapture = () => {}
    return { wrapper, viewport }
  }

  function pointer(type: string, init: PointerEventInit = {}) {
    return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  }

  // An arbitrary world point, so a press can land a pixel inside a wall rather
  // than at a cell centre. `screenOf` above cannot reach the zones that matter
  // here.
  function at(x: number, y: number) {
    const tabsStore = useTabsStore()
    const tile = useModelStore().tileSize
    const camera = tabsStore.cameraOf(tabsStore.activeTabId)
    return {
      clientX: (x - camera.pan.x) * tile * camera.zoom,
      clientY: (y - camera.pan.y) * tile * camera.zoom,
    }
  }

  function strip(mapId: MapId, cells: string[]) {
    const model = useModelStore()
    return model.run('Setup', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, model.project.mapsById.get(mapId)!, cells, {
        areaId: WORLD_AREA_ID,
      }),
    ).id
  }

  function cellsOf(mapId: MapId, roomId: string): string[] {
    const room = useModelStore()
      .project.mapsById.get(mapId)!
      .rooms.get(roomId as never)
    return [...(room?.cells ?? [])].sort()
  }

  // A 2x2 room, so its east face is a run of 2 and has a handle. The press
  // lands just inside that wall: the pointer's own cell is still the room's,
  // which is what makes the zone resolve as `edgeRun` rather than `empty`.
  const ROOM = ['3,2', '3,3', '2,2', '2,3']

  it('drags the grabbed run outward instead of painting', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = useTabsStore().activeTabId
    const roomId = strip(mapId, ROOM)

    viewport.dispatchEvent(pointer('pointerdown', at(3.97, 2.5)))
    viewport.dispatchEvent(pointer('pointermove', at(4.5, 2.5)))
    viewport.dispatchEvent(pointer('pointerup', at(4.5, 2.5)))

    // Both rows of the run extruded: a paint stroke would have grown the one
    // cell the pointer crossed.
    expect(cellsOf(mapId, roomId)).toEqual(['2,2', '2,3', '3,2', '3,3', '4,2', '4,3'])
    expect(useModelStore().status.undoLabel).toBe('Resize Room')
    wrapper.unmount()
  })

  it('shrinks on an inward drag', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = useTabsStore().activeTabId
    const roomId = strip(mapId, ROOM)

    viewport.dispatchEvent(pointer('pointerdown', at(3.97, 2.5)))
    viewport.dispatchEvent(pointer('pointermove', at(2.5, 2.5)))
    viewport.dispatchEvent(pointer('pointerup', at(2.5, 2.5)))

    expect(cellsOf(mapId, roomId)).toEqual(['2,2', '2,3'])
    wrapper.unmount()
  })

  // A bare click on an existing room cell only sets the active room, with no
  // cell change. A handle needs no dead zone for that: a press starts at
  // distance 0, and the seam drops the empty transaction.
  it('leaves a click on a handle as an arm and nothing else', () => {
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    const roomId = strip(mapId, ROOM)

    viewport.dispatchEvent(pointer('pointerdown', at(3.97, 2.5)))
    viewport.dispatchEvent(pointer('pointerup', at(3.97, 2.5)))

    expect(cellsOf(mapId, roomId)).toEqual(ROOM.slice().sort())
    expect(model.status.undoLabel).toBe('Setup')
    expect(useActiveRoomStore().roomIdOn(mapId)).toBe(roomId)
    wrapper.unmount()
  })

  // The erase column of the table erases cells on an edge run like anywhere
  // else. Erase outranks the zone, so a right-drag along a wall must not
  // resize.
  it('erases rather than resizes on a right-press', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = useTabsStore().activeTabId
    const roomId = strip(mapId, ROOM)

    viewport.dispatchEvent(pointer('pointerdown', { ...at(3.97, 2.5), button: 2 }))
    viewport.dispatchEvent(pointer('pointerup', { ...at(3.97, 2.5), button: 2 }))

    expect(cellsOf(mapId, roomId)).toEqual(['2,2', '2,3', '3,3'])
    wrapper.unmount()
  })

  // A length-1 face has no handle and resolves as interior, so the press falls
  // through to a paint stroke and grows the cell under the pointer.
  it('grows instead of resizing on a face too short to have a handle', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = useTabsStore().activeTabId
    const roomId = strip(mapId, ['3,2'])

    viewport.dispatchEvent(pointer('pointerdown', at(3.97, 2.5)))
    viewport.dispatchEvent(pointer('pointermove', at(4.5, 2.5)))
    viewport.dispatchEvent(pointer('pointerup', at(4.5, 2.5)))

    expect(cellsOf(mapId, roomId)).toEqual(['3,2', '4,2'])
    wrapper.unmount()
  })

  it('does nothing outside Draw mode', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = useTabsStore().activeTabId
    const roomId = strip(mapId, ROOM)
    useModeStore().setMode('select')

    viewport.dispatchEvent(pointer('pointerdown', at(3.97, 2.5)))
    viewport.dispatchEvent(pointer('pointermove', at(5.5, 2.5)))
    viewport.dispatchEvent(pointer('pointerup', at(5.5, 2.5)))

    expect(cellsOf(mapId, roomId)).toEqual(ROOM.slice().sort())
    wrapper.unmount()
  })

  // "Touch resize / inner-wall is a two-step gesture: the first pointer-down
  // selects the room … a subsequent press on a now-visible handle performs the
  // resize. Desktop keeps its one-gesture hover-resize in addition."
  describe('the touch two-step', () => {
    it('grows rather than resizing on the first touch of a room', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = strip(mapId, ROOM)

      viewport.dispatchEvent(pointer('pointerdown', { ...at(3.97, 2.5), pointerType: 'touch' }))
      viewport.dispatchEvent(pointer('pointermove', { ...at(4.5, 2.5), pointerType: 'touch' }))
      viewport.dispatchEvent(pointer('pointerup', { ...at(4.5, 2.5), pointerType: 'touch' }))

      // Grown by the one cell the stroke crossed, not extruded by a whole run.
      expect(cellsOf(mapId, roomId)).toEqual(['2,2', '2,3', '3,2', '3,3', '4,2'])
      expect(useActiveRoomStore().roomIdOn(mapId)).toBe(roomId)
      wrapper.unmount()
    })

    it('resizes on a second touch, once the handles are showing', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = strip(mapId, ROOM)

      // Step one: tap to arm, without moving, so the room keeps its shape.
      viewport.dispatchEvent(pointer('pointerdown', { ...at(2.5, 2.5), pointerType: 'touch' }))
      viewport.dispatchEvent(pointer('pointerup', { ...at(2.5, 2.5), pointerType: 'touch' }))
      expect(useActiveRoomStore().roomIdOn(mapId)).toBe(roomId)

      // Step two: drag the now-visible handle.
      viewport.dispatchEvent(pointer('pointerdown', { ...at(3.97, 2.5), pointerType: 'touch' }))
      viewport.dispatchEvent(pointer('pointermove', { ...at(4.5, 2.5), pointerType: 'touch' }))
      viewport.dispatchEvent(pointer('pointerup', { ...at(4.5, 2.5), pointerType: 'touch' }))

      expect(cellsOf(mapId, roomId)).toEqual(['2,2', '2,3', '3,2', '3,3', '4,2', '4,3'])
      wrapper.unmount()
    })

    it('still needs the same room armed, not merely something', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = strip(mapId, ROOM)
      const other = strip(mapId, ['8,8', '8,9'])

      viewport.dispatchEvent(pointer('pointerdown', { ...at(8.5, 8.5), pointerType: 'touch' }))
      viewport.dispatchEvent(pointer('pointerup', { ...at(8.5, 8.5), pointerType: 'touch' }))
      expect(useActiveRoomStore().roomIdOn(mapId)).toBe(other)

      viewport.dispatchEvent(pointer('pointerdown', { ...at(3.97, 2.5), pointerType: 'touch' }))
      viewport.dispatchEvent(pointer('pointermove', { ...at(4.5, 2.5), pointerType: 'touch' }))
      viewport.dispatchEvent(pointer('pointerup', { ...at(4.5, 2.5), pointerType: 'touch' }))

      expect(cellsOf(mapId, roomId)).toEqual(['2,2', '2,3', '3,2', '3,3', '4,2'])
      wrapper.unmount()
    })
  })

  // "Straight outer edge run of length >= 2, hover -> resize cursor -> drag to
  // expand outward or shrink inward." The only affordance a desktop user has
  // for a room that is not armed, since handles draw on the active room only.
  describe('the resize cursor', () => {
    function cursorOf(wrapper: ReturnType<typeof mountCanvas>['wrapper']): string {
      return (wrapper.get('.canvas-viewport').element as HTMLElement).style.cursor
    }

    it('appears over an edge run, along the run’s own axis', async () => {
      const { wrapper, viewport } = mountCanvas()
      strip(useTabsStore().activeTabId, ROOM)

      viewport.dispatchEvent(new PointerEvent('pointermove', { ...at(3.97, 2.5), bubbles: true }))
      await nextTick()
      expect(cursorOf(wrapper)).toBe('ew-resize')

      viewport.dispatchEvent(new PointerEvent('pointermove', { ...at(2.5, 2.03), bubbles: true }))
      await nextTick()
      expect(cursorOf(wrapper)).toBe('ns-resize')
      wrapper.unmount()
    })

    // Without arming anything first: the cursor is what tells a mouse user the
    // press will resize, and the mouse never needed the two-step.
    it('needs no armed room', async () => {
      const { wrapper, viewport } = mountCanvas()
      strip(useTabsStore().activeTabId, ROOM)
      expect(useActiveRoomStore().isArmed).toBe(false)

      viewport.dispatchEvent(new PointerEvent('pointermove', { ...at(3.97, 2.5), bubbles: true }))
      await nextTick()

      expect(cursorOf(wrapper)).toBe('ew-resize')
      wrapper.unmount()
    })

    it('clears in the room’s interior and off the room entirely', async () => {
      const { wrapper, viewport } = mountCanvas()
      strip(useTabsStore().activeTabId, ROOM)

      viewport.dispatchEvent(new PointerEvent('pointermove', { ...at(3.97, 2.5), bubbles: true }))
      await nextTick()
      expect(cursorOf(wrapper)).toBe('ew-resize')

      viewport.dispatchEvent(new PointerEvent('pointermove', { ...at(2.5, 2.5), bubbles: true }))
      await nextTick()
      expect(cursorOf(wrapper)).toBe('')

      viewport.dispatchEvent(new PointerEvent('pointermove', { ...at(9.5, 9.5), bubbles: true }))
      await nextTick()
      expect(cursorOf(wrapper)).toBe('')
      wrapper.unmount()
    })

    it('stays away outside Draw mode, where the press would not resize', async () => {
      const { wrapper, viewport } = mountCanvas()
      strip(useTabsStore().activeTabId, ROOM)
      useModeStore().setMode('select')

      viewport.dispatchEvent(new PointerEvent('pointermove', { ...at(3.97, 2.5), bubbles: true }))
      await nextTick()

      expect(cursorOf(wrapper)).toBe('')
      wrapper.unmount()
    })
  })
})

// The last two rows of the precedence table, "Interior vertex" and "On an
// inner-wall segment", at the level where the press is classified. What the
// strokes then do is `gestures/innerWallStroke.test.ts`.
describe('CanvasRegion inner walls', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    viewport.setPointerCapture = () => {}
    return { wrapper, viewport }
  }

  function pointer(type: string, init: PointerEventInit = {}) {
    return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  }

  function at(x: number, y: number) {
    const tabsStore = useTabsStore()
    const tile = useModelStore().tileSize
    const camera = tabsStore.cameraOf(tabsStore.activeTabId)
    return {
      clientX: (x - camera.pan.x) * tile * camera.zoom,
      clientY: (y - camera.pan.y) * tile * camera.zoom,
    }
  }

  // A 3x3 at (2,2)-(4,4): the smallest room with more than one interior vertex,
  // so the smallest one an inner wall fits in. Its interior vertices are (3,3),
  // (4,3), (3,4) and (4,4).
  function square3(mapId: MapId) {
    const model = useModelStore()
    const cells: string[] = []
    for (let x = 2; x <= 4; x++) for (let y = 2; y <= 4; y++) cells.push(`${x},${y}`)
    return model.run('Setup', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, model.project.mapsById.get(mapId)!, cells, {
        areaId: WORLD_AREA_ID,
      }),
    ).id
  }

  function walls(mapId: MapId, roomId: string) {
    return useModelStore()
      .project.mapsById.get(mapId)!
      .rooms.get(roomId as never)!.innerWalls
  }

  // The wall between vertices (3,3) and (4,3): the edge dividing cells (3,2)
  // and (3,3).
  const MIDDLE = edgeOfCell('3,2', 'S')

  function drawMiddleWall(viewport: HTMLElement) {
    viewport.dispatchEvent(pointer('pointerdown', at(3, 3)))
    viewport.dispatchEvent(pointer('pointermove', at(4, 3)))
    viewport.dispatchEvent(pointer('pointerup', at(4, 3)))
  }

  it('draws a wall from a vertex instead of painting', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = useTabsStore().activeTabId
    const roomId = square3(mapId)

    drawMiddleWall(viewport)

    expect([...walls(mapId, roomId)]).toEqual([[MIDDLE, 'solid']])
    expect(useModelStore().status.undoLabel).toBe('Draw Inner Wall')
    wrapper.unmount()
  })

  it('uses the style selected in the toolbar', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = useTabsStore().activeTabId
    const roomId = square3(mapId)
    useToolsStore().setWallStyle('dotted')

    drawMiddleWall(viewport)

    expect(walls(mapId, roomId).get(MIDDLE)).toBe('dotted')
    wrapper.unmount()
  })

  // A press on an inner-wall segment re-styles it, by drawing over it with a
  // different style selected.
  it('re-styles a segment pressed with another style selected', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = useTabsStore().activeTabId
    const roomId = square3(mapId)
    drawMiddleWall(viewport)

    useToolsStore().setWallStyle('doorway')
    // A press on the wall, a whisker inside cell (3,3) so the pointer's own
    // cell is the room's and neither end vertex is nearer.
    viewport.dispatchEvent(pointer('pointerdown', at(3.5, 3.02)))
    viewport.dispatchEvent(pointer('pointerup', at(3.5, 3.02)))

    expect(walls(mapId, roomId).size).toBe(1)
    expect(walls(mapId, roomId).get(MIDDLE)).toBe('doorway')
    wrapper.unmount()
  })

  // Erase priority: a right-press on an inner-wall segment deletes the
  // segment; otherwise it erases the cell.
  it('erases the segment, not the cell, on a right-press over a wall', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = useTabsStore().activeTabId
    const roomId = square3(mapId)
    drawMiddleWall(viewport)

    viewport.dispatchEvent(pointer('pointerdown', { ...at(3.5, 3.02), button: 2 }))
    viewport.dispatchEvent(pointer('pointerup', { ...at(3.5, 3.02), button: 2 }))

    expect(walls(mapId, roomId).size).toBe(0)
    expect(useModelStore().project.mapsById.get(mapId)!.rooms.get(roomId)!.cells.size).toBe(9)
    wrapper.unmount()
  })

  // The other half of the same rule: with no wall there, the same press erases
  // the cell. Erase outranks every zone but the inner-wall one.
  it('erases the cell on a right-press over a bare vertex', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = useTabsStore().activeTabId
    const roomId = square3(mapId)

    viewport.dispatchEvent(pointer('pointerdown', { ...at(3, 3), button: 2 }))
    viewport.dispatchEvent(pointer('pointerup', { ...at(3, 3), button: 2 }))

    expect(useModelStore().project.mapsById.get(mapId)!.rooms.get(roomId)!.cells.size).toBe(8)
    wrapper.unmount()
  })

  // The same touch two-step as resize: a subsequent press on a now-visible
  // handle draws the wall instead of the first touch's paint. A finger has no
  // hover, and the vertex targets are only drawn once the room is armed.
  it('grows rather than drawing on the first touch of a room', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = useTabsStore().activeTabId
    const roomId = square3(mapId)

    viewport.dispatchEvent(pointer('pointerdown', { ...at(3, 3), pointerType: 'touch' }))
    viewport.dispatchEvent(pointer('pointermove', { ...at(4, 3), pointerType: 'touch' }))
    viewport.dispatchEvent(pointer('pointerup', { ...at(4, 3), pointerType: 'touch' }))

    expect(walls(mapId, roomId).size).toBe(0)
    expect(useActiveRoomStore().roomIdOn(mapId)).toBe(roomId)
    wrapper.unmount()
  })

  it('draws on a second touch, once the vertex targets are showing', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = useTabsStore().activeTabId
    const roomId = square3(mapId)

    // Step one: tap the middle of the room to arm it.
    viewport.dispatchEvent(pointer('pointerdown', { ...at(3.5, 3.5), pointerType: 'touch' }))
    viewport.dispatchEvent(pointer('pointerup', { ...at(3.5, 3.5), pointerType: 'touch' }))
    expect(useActiveRoomStore().roomIdOn(mapId)).toBe(roomId)

    // Step two: drag between two now-visible vertex targets.
    viewport.dispatchEvent(pointer('pointerdown', { ...at(3, 3), pointerType: 'touch' }))
    viewport.dispatchEvent(pointer('pointermove', { ...at(4, 3), pointerType: 'touch' }))
    viewport.dispatchEvent(pointer('pointerup', { ...at(4, 3), pointerType: 'touch' }))

    expect(walls(mapId, roomId).size).toBe(1)
    wrapper.unmount()
  })

  it('does nothing outside Draw mode', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = useTabsStore().activeTabId
    const roomId = square3(mapId)
    useModeStore().setMode('door')

    drawMiddleWall(viewport)

    expect(walls(mapId, roomId).size).toBe(0)
    wrapper.unmount()
  })

  // Hovering an interior vertex switches the cursor to the inner-wall
  // crosshair. A segment gets the same one, because pressing it draws too.
  it('shows a draw cursor over a vertex and over a segment', async () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = useTabsStore().activeTabId
    square3(mapId)
    const cursor = () => (wrapper.get('.canvas-viewport').element as HTMLElement).style.cursor

    viewport.dispatchEvent(new PointerEvent('pointermove', { ...at(3, 3), bubbles: true }))
    await nextTick()
    expect(cursor()).toBe('crosshair')

    drawMiddleWall(viewport)
    viewport.dispatchEvent(new PointerEvent('pointermove', { ...at(3.5, 3.02), bubbles: true }))
    await nextTick()
    expect(cursor()).toBe('crosshair')

    // Plain interior, well away from both.
    viewport.dispatchEvent(new PointerEvent('pointermove', { ...at(2.5, 3.5), bubbles: true }))
    await nextTick()
    expect(cursor()).toBe('')
    wrapper.unmount()
  })
})

// The sub-mode lock filtering the precedence table. The filter itself is
// `gestures/subMode.test.ts`; this is that filter reaching the four things it
// has to reach: cell gestures, resize, inner walls, and the handles drawn on
// the active room.
describe('CanvasRegion sub-mode lock', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    viewport.setPointerCapture = () => {}
    return { wrapper, viewport }
  }

  function pointer(type: string, init: PointerEventInit = {}) {
    return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  }

  function at(x: number, y: number) {
    const tabsStore = useTabsStore()
    const tile = useModelStore().tileSize
    const camera = tabsStore.cameraOf(tabsStore.activeTabId)
    return {
      clientX: (x - camera.pan.x) * tile * camera.zoom,
      clientY: (y - camera.pan.y) * tile * camera.zoom,
    }
  }

  // The 3x3 at (2,2)-(4,4) again: big enough for an edge run of 3, an interior
  // vertex lattice, and an interior cell that is none of those.
  function square3(mapId: MapId) {
    const model = useModelStore()
    const cells: string[] = []
    for (let x = 2; x <= 4; x++) for (let y = 2; y <= 4; y++) cells.push(`${x},${y}`)
    return model.run('Setup', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, model.project.mapsById.get(mapId)!, cells, {
        areaId: WORLD_AREA_ID,
      }),
    ).id
  }

  function room(mapId: MapId, roomId: string) {
    return useModelStore()
      .project.mapsById.get(mapId)!
      .rooms.get(roomId as never)!
  }

  // Drag the east run outward by one.
  function dragEastRun(viewport: HTMLElement) {
    viewport.dispatchEvent(pointer('pointerdown', at(4.97, 3.5)))
    viewport.dispatchEvent(pointer('pointermove', at(5.5, 3.5)))
    viewport.dispatchEvent(pointer('pointerup', at(5.5, 3.5)))
  }

  // Drag between two interior vertices.
  function dragVertex(viewport: HTMLElement) {
    viewport.dispatchEvent(pointer('pointerdown', at(3, 3)))
    viewport.dispatchEvent(pointer('pointermove', at(4, 3)))
    viewport.dispatchEvent(pointer('pointerup', at(4, 3)))
  }

  // Paint a fresh cell on empty grid.
  function paintEmpty(viewport: HTMLElement) {
    viewport.dispatchEvent(pointer('pointerdown', at(9.5, 9.5)))
    viewport.dispatchEvent(pointer('pointerup', at(9.5, 9.5)))
  }

  describe('Cells only', () => {
    // Edge-runs grow instead of resizing: the press falls through to a paint
    // stroke and grows the one cell the pointer crossed, rather than extruding
    // the whole run or doing nothing.
    it('grows the cell under the pointer instead of resizing', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)
      useToolsStore().setSubMode('cells')

      dragEastRun(viewport)

      expect(room(mapId, roomId).cells.has('5,3')).toBe(true)
      expect(room(mapId, roomId).cells.has('5,2')).toBe(false)
      expect(useModelStore().status.undoLabel).toBe('Paint')
      wrapper.unmount()
    })

    // Vertices are inert as a target, not as a dead zone: the press paints the
    // cell it landed in like any other press would.
    it('leaves a vertex press as an ordinary cell press', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)
      useToolsStore().setSubMode('cells')

      dragVertex(viewport)

      expect(room(mapId, roomId).innerWalls.size).toBe(0)
      // Nine cells still, and no wall: painting inside a room it already owns
      // changes nothing, so this is a true no-op rather than a swallowed press.
      expect(room(mapId, roomId).cells.size).toBe(9)
      wrapper.unmount()
    })

    it('still paints, erases and merges', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      square3(mapId)
      useToolsStore().setSubMode('cells')

      paintEmpty(viewport)
      expect(useModelStore().project.mapsById.get(mapId)!.cellOwner.has('9,9')).toBe(true)

      viewport.dispatchEvent(pointer('pointerdown', { ...at(9.5, 9.5), button: 2 }))
      viewport.dispatchEvent(pointer('pointerup', { ...at(9.5, 9.5), button: 2 }))
      expect(useModelStore().project.mapsById.get(mapId)!.cellOwner.has('9,9')).toBe(false)
      wrapper.unmount()
    })
  })

  describe('Resize only', () => {
    it('resizes the grabbed run', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)
      useToolsStore().setSubMode('resize')

      dragEastRun(viewport)

      // The whole run extruded, not one cell grown.
      expect(room(mapId, roomId).cells.size).toBe(12)
      expect(useModelStore().status.undoLabel).toBe('Resize Room')
      wrapper.unmount()
    })

    // Other presses still set the active room: that is a cross-cutting rule
    // rather than a row of the table.
    it('arms a room without painting it', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)
      useToolsStore().setSubMode('resize')

      viewport.dispatchEvent(pointer('pointerdown', at(3.5, 3.5)))
      viewport.dispatchEvent(pointer('pointermove', at(8.5, 8.5)))
      viewport.dispatchEvent(pointer('pointerup', at(8.5, 8.5)))

      expect(useActiveRoomStore().roomIdOn(mapId)).toBe(roomId)
      expect(room(mapId, roomId).cells.size).toBe(9)
      expect(useModelStore().status.undoLabel).toBe('Setup')
      wrapper.unmount()
    })

    it('creates nothing on empty grid', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      square3(mapId)
      useToolsStore().setSubMode('resize')

      paintEmpty(viewport)

      expect(useModelStore().project.mapsById.get(mapId)!.cellOwner.has('9,9')).toBe(false)
      wrapper.unmount()
    })

    it('draws no inner walls', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)
      useToolsStore().setSubMode('resize')

      dragVertex(viewport)

      expect(room(mapId, roomId).innerWalls.size).toBe(0)
      wrapper.unmount()
    })
  })

  describe('Vertex only', () => {
    it('draws inner walls', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)
      useToolsStore().setSubMode('vertex')

      dragVertex(viewport)

      expect(room(mapId, roomId).innerWalls.size).toBe(1)
      wrapper.unmount()
    })

    // The erase column's inner-wall row is part of the same row, so it stays
    // live, while erasing a cell does not.
    it('erases a segment but not a cell', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)
      useToolsStore().setSubMode('vertex')
      dragVertex(viewport)

      viewport.dispatchEvent(pointer('pointerdown', { ...at(3.5, 3.02), button: 2 }))
      viewport.dispatchEvent(pointer('pointerup', { ...at(3.5, 3.02), button: 2 }))
      expect(room(mapId, roomId).innerWalls.size).toBe(0)

      // A right-press well clear of any wall now erases nothing.
      viewport.dispatchEvent(pointer('pointerdown', { ...at(2.5, 4.5), button: 2 }))
      viewport.dispatchEvent(pointer('pointerup', { ...at(2.5, 4.5), button: 2 }))
      expect(room(mapId, roomId).cells.size).toBe(9)
      wrapper.unmount()
    })

    it('does not resize', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)
      useToolsStore().setSubMode('vertex')

      dragEastRun(viewport)

      expect(room(mapId, roomId).cells.size).toBe(9)
      wrapper.unmount()
    })
  })

  // When a lock is active, only that behaviour's handles show on the active
  // room. Counted off the fake context: runs are strokes in the handle colour,
  // vertex targets are fills in it.
  describe('the handles follow the lock', () => {
    function armedHandleCounts(subMode: 'auto' | 'cells' | 'resize' | 'vertex') {
      const wrapper = mount(CanvasRegion, { attachTo: document.body })
      const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
      viewport.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
      viewport.setPointerCapture = () => {}
      const mapId = useTabsStore().activeTabId
      square3(mapId)
      useToolsStore().setSubMode(subMode)

      const ctx = (wrapper.get('.canvas').element as HTMLCanvasElement).getContext(
        '2d',
      ) as unknown as FakeContext2D

      // Arm the room and put the pointer in it, so the vertex reveal window has
      // something to reveal around.
      viewport.dispatchEvent(pointer('pointerdown', at(3.5, 3.5)))
      viewport.dispatchEvent(pointer('pointerup', at(3.5, 3.5)))
      ctx.stroke.mockClear()
      ctx.fillRect.mockClear()
      viewport.dispatchEvent(new PointerEvent('pointermove', { ...at(3.4, 3.4), bubbles: true }))

      const strokes = ctx.stroke.mock.calls.length
      const fills = ctx.fillRect.mock.calls.length
      wrapper.unmount()
      return { strokes, fills }
    }

    it('draws more under Auto than under any lock that hides a family', () => {
      const auto = armedHandleCounts('auto')
      const cells = armedHandleCounts('cells')
      const resize = armedHandleCounts('resize')
      const vertex = armedHandleCounts('vertex')

      // Runs are strokes: Auto and Resize-only draw them, the other two do not.
      expect(resize.strokes).toBe(auto.strokes)
      expect(cells.strokes).toBeLessThan(auto.strokes)
      expect(vertex.strokes).toBeLessThan(auto.strokes)

      // Vertex targets are fills: Auto and Vertex-only draw them.
      expect(vertex.fills).toBe(auto.fills)
      expect(cells.fills).toBeLessThan(auto.fills)
      expect(resize.fills).toBeLessThan(auto.fills)
    })
  })

  // A cursor promising a gesture the lock has switched off is worse than no
  // cursor, so it reads the same filter the dispatch does.
  describe('the cursor follows the lock', () => {
    // Async because the cursor is a reactive binding: reading `.style.cursor`
    // in the same tick as the move reads the previous value.
    async function cursorAfterMove(
      subMode: 'auto' | 'cells' | 'resize' | 'vertex',
      point: { clientX: number; clientY: number },
    ) {
      const { wrapper, viewport } = mountCanvas()
      square3(useTabsStore().activeTabId)
      useToolsStore().setSubMode(subMode)
      viewport.dispatchEvent(new PointerEvent('pointermove', { ...point, bubbles: true }))
      await nextTick()
      const cursor = (wrapper.get('.canvas-viewport').element as HTMLElement).style.cursor
      wrapper.unmount()
      return cursor
    }

    it('drops the resize cursor everywhere the edge-run row is dead', async () => {
      const onRun = () => at(4.97, 3.5)
      expect(await cursorAfterMove('auto', onRun())).toBe('ew-resize')
      expect(await cursorAfterMove('resize', onRun())).toBe('ew-resize')
      expect(await cursorAfterMove('cells', onRun())).toBe('')
      expect(await cursorAfterMove('vertex', onRun())).toBe('')
    })

    it('drops the draw cursor everywhere the inner-wall rows are dead', async () => {
      const onVertex = () => at(3, 3)
      expect(await cursorAfterMove('auto', onVertex())).toBe('crosshair')
      expect(await cursorAfterMove('vertex', onVertex())).toBe('crosshair')
      expect(await cursorAfterMove('cells', onVertex())).toBe('')
      expect(await cursorAfterMove('resize', onVertex())).toBe('')
    })
  })

  // Locking changes what the pointer is over without the pointer moving, so
  // both the handles and the cursor have to catch up where it already is.
  it('updates the cursor when the lock changes under a still pointer', async () => {
    const { wrapper, viewport } = mountCanvas()
    square3(useTabsStore().activeTabId)
    const tools = useToolsStore()
    const cursor = () => (wrapper.get('.canvas-viewport').element as HTMLElement).style.cursor

    viewport.dispatchEvent(new PointerEvent('pointermove', { ...at(4.97, 3.5), bubbles: true }))
    await nextTick()
    expect(cursor()).toBe('ew-resize')

    tools.setSubMode('vertex')
    await nextTick()
    expect(cursor()).toBe('')
    wrapper.unmount()
  })
})

// The far end shows a marker cell with the destination tab's first letter, and
// double-clicking it opens that tab centred on the other end. The only place in
// the app where the canvas changes tabs.
describe('CanvasRegion cross-tab teleport navigation', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    viewport.setPointerCapture = () => {}
    return { wrapper, viewport }
  }

  // A cell's centre in screen coordinates, on the active tab.
  function at(col: number, row: number) {
    const tabsStore = useTabsStore()
    const tile = useModelStore().tileSize
    const camera = tabsStore.cameraOf(tabsStore.activeTabId)
    return {
      clientX: (col + 0.5 - camera.pan.x) * tile * camera.zoom,
      clientY: (row + 0.5 - camera.pan.y) * tile * camera.zoom,
    }
  }

  // Two tabs, a room on each, and a teleport between them, stored under the
  // first, so the second tab's marker is the derived far end.
  function crossTabTeleport() {
    const model = useModelStore()
    const tabsStore = useTabsStore()
    const surfaceId = tabsStore.activeTabId

    tabsStore.addTab()
    const cavesId = tabsStore.activeTabId
    tabsStore.activate(surfaceId)

    model.run('Setup', PROJECT_SCOPE, (tx) => {
      paintCells(tx, model.project, model.project.mapsById.get(surfaceId)!, ['1,1'], {
        areaId: WORLD_AREA_ID,
      })
      paintCells(tx, model.project, model.project.mapsById.get(cavesId)!, ['4,3'], {
        areaId: WORLD_AREA_ID,
      })
      createTeleport(
        tx,
        model.project,
        { mapId: surfaceId, cell: '1,1' },
        { mapId: cavesId, cell: '4,3' },
      )
    })

    return { surfaceId, cavesId }
  }

  // A press and a release in the same place, which is what the click-vs-drag
  // rule calls a click: the pointer neither left its cell nor travelled past
  // the pixel dead-zone.
  //
  // Deliberately not a DOM `click` event: the browser fires `click` for a drag
  // that ends where it began, which on this canvas is a box gesture, not a
  // click.
  function click(viewport: HTMLElement, point: { clientX: number; clientY: number }) {
    const init = { bubbles: true, cancelable: true, ...point }
    viewport.dispatchEvent(new PointerEvent('pointerdown', init))
    viewport.dispatchEvent(new PointerEvent('pointerup', init))
  }

  // Two of those, then the `dblclick` the browser synthesizes after them.
  // Navigation lives here because a single click is reserved for selection, and
  // one click cannot both select and navigate.
  function doubleClick(viewport: HTMLElement, point: { clientX: number; clientY: number }) {
    click(viewport, point)
    click(viewport, point)
    viewport.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true, ...point }),
    )
  }

  it('opens the destination tab, centred on the other end', () => {
    const { wrapper, viewport } = mountCanvas()
    const { cavesId } = crossTabTeleport()
    const tabsStore = useTabsStore()
    const tile = useModelStore().tileSize
    useModeStore().setMode('door')

    doubleClick(viewport, at(1, 1))

    expect(tabsStore.activeTabId).toBe(cavesId)
    // The other end's cell centre lands in the middle of the 800x600 viewport.
    const camera = tabsStore.cameraOf(cavesId)
    expect((4.5 - camera.pan.x) * tile * camera.zoom).toBeCloseTo(400)
    expect((3.5 - camera.pan.y) * tile * camera.zoom).toBeCloseTo(300)
    wrapper.unmount()
  })

  it('navigates from the far end too, which stores no transition of its own', () => {
    const { wrapper, viewport } = mountCanvas()
    const { surfaceId, cavesId } = crossTabTeleport()
    const tabsStore = useTabsStore()
    useModeStore().setMode('door')
    tabsStore.activate(cavesId)

    doubleClick(viewport, at(4, 3))

    expect(tabsStore.activeTabId).toBe(surfaceId)
    wrapper.unmount()
  })

  // Undoable like every other tab switch: arriving somewhere unexpected is
  // exactly when a user reaches for Ctrl+Z.
  it('puts the jump on the undo stack', () => {
    const { wrapper, viewport } = mountCanvas()
    const { surfaceId, cavesId } = crossTabTeleport()
    const tabsStore = useTabsStore()
    const model = useModelStore()
    useModeStore().setMode('door')

    doubleClick(viewport, at(1, 1))
    expect(tabsStore.activeTabId).toBe(cavesId)

    model.undo()
    expect(tabsStore.activeTabId).toBe(surfaceId)
    wrapper.unmount()
  })

  it('does nothing outside Door mode', () => {
    const { wrapper, viewport } = mountCanvas()
    const { surfaceId } = crossTabTeleport()
    const tabsStore = useTabsStore()

    // Draw mode is the default, and a press there paints rather than navigates.
    doubleClick(viewport, at(1, 1))

    expect(tabsStore.activeTabId).toBe(surfaceId)
    wrapper.unmount()
  })

  it('does nothing on a cell with no teleport, or on empty grid', () => {
    const { wrapper, viewport } = mountCanvas()
    const { surfaceId } = crossTabTeleport()
    const tabsStore = useTabsStore()
    useModeStore().setMode('door')

    doubleClick(viewport, at(9, 9))
    expect(tabsStore.activeTabId).toBe(surfaceId)
    wrapper.unmount()
  })

  // A same-map teleport's ends lead nowhere else, so they must not navigate,
  // not even on a double-click: both ends are already on screen.
  it('does not navigate on a same-map teleport', () => {
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()
    const tabsStore = useTabsStore()
    const surfaceId = tabsStore.activeTabId
    useModeStore().setMode('door')

    model.run('Setup', mapScope(surfaceId), (tx) => {
      const map = model.project.mapsById.get(surfaceId)!
      paintCells(tx, model.project, map, ['1,1'], { areaId: WORLD_AREA_ID })
      paintCells(tx, model.project, map, ['5,5'], { areaId: WORLD_AREA_ID })
      createTeleport(
        tx,
        model.project,
        { mapId: surfaceId, cell: '1,1' },
        { mapId: surfaceId, cell: '5,5' },
      )
    })

    doubleClick(viewport, at(1, 1))

    expect(tabsStore.activeTabId).toBe(surfaceId)
    wrapper.unmount()
  })

  // The other half of the rule: a single click on the same marker selects it
  // rather than navigating, which is what makes every transition behave the
  // same way on one click.
  it('selects rather than navigating on a single click', () => {
    const { wrapper, viewport } = mountCanvas()
    const { surfaceId } = crossTabTeleport()
    const tabsStore = useTabsStore()
    const selection = useSelectionStore()
    useModeStore().setMode('door')

    click(viewport, at(1, 1))

    expect(tabsStore.activeTabId).toBe(surfaceId)
    expect(selection.selected).toHaveLength(1)
    expect(selection.selected[0].kind).toBe('transition')
    wrapper.unmount()
  })
})

// The Door-mode shell. A press in Door mode resolves to a row of the
// precedence table, the cursor says which row, and nothing else on the canvas
// pretends to be Draw mode's.
describe('CanvasRegion Door mode shell', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    viewport.setPointerCapture = () => {}
    return { wrapper, viewport }
  }

  function pointer(type: string, init: PointerEventInit = {}) {
    return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  }

  // A world point in screen pixels: integers land on grid lines, so `at(2, 0.5)`
  // is on the seam at x=2 and `at(2.5, 0.5)` is the middle of the cell east of it.
  function at(x: number, y: number) {
    const tabsStore = useTabsStore()
    const tile = useModelStore().tileSize
    const camera = tabsStore.cameraOf(tabsStore.activeTabId)
    return {
      clientX: (x - camera.pan.x) * tile * camera.zoom,
      clientY: (y - camera.pan.y) * tile * camera.zoom,
    }
  }

  // Two rooms sharing the seam at x = 2, a door on its northern edge, and a
  // same-map teleport in the far cell of the eastern room.
  function twoRoomsAndADoor() {
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId

    model.run('Setup', mapScope(mapId), (tx) => {
      const map = model.project.mapsById.get(mapId)!
      paintCells(tx, model.project, map, ['0,0', '1,0', '0,1', '1,1'], { areaId: WORLD_AREA_ID })
      paintCells(tx, model.project, map, ['2,0', '3,0', '2,1', '3,1'], { areaId: WORLD_AREA_ID })
      createFromBox(tx, model.project, map, '1,0', '2,0')
      createTeleport(tx, model.project, { mapId, cell: '0,1' }, { mapId, cell: '3,1' })
    })
    return mapId
  }

  // Async because the cursor is a reactive binding: reading it in the same tick
  // as the move reads the previous value.
  async function cursorAt(
    wrapper: ReturnType<typeof mountCanvas>['wrapper'],
    viewport: HTMLElement,
    point: { clientX: number; clientY: number },
  ) {
    viewport.dispatchEvent(new PointerEvent('pointermove', { ...point, bubbles: true }))
    await nextTick()
    return (wrapper.get('.canvas-viewport').element as HTMLElement).style.cursor
  }

  it('offers a cursor per row of the table', async () => {
    const { wrapper, viewport } = mountCanvas()
    twoRoomsAndADoor()
    useModeStore().setMode('door')

    // A room cell with nothing on it: both creation gestures start here.
    expect(await cursorAt(wrapper, viewport, at(2.5, 1.5))).toBe('crosshair')
    // The door, on its edge.
    expect(await cursorAt(wrapper, viewport, at(2, 0.5))).toBe('pointer')
    // A teleport endpoint, in the cell interior.
    expect(await cursorAt(wrapper, viewport, at(3.5, 1.5))).toBe('pointer')
    // Bare grid: nothing starts here, so it must not look like it might.
    expect(await cursorAt(wrapper, viewport, at(9.5, 9.5))).toBe('')
    wrapper.unmount()
  })

  // Draw mode's cursor over the very same points, to show the two modes are
  // reading different tables rather than one leaking into the other.
  it('does not show Draw mode’s cursors, or the other way round', async () => {
    const { wrapper, viewport } = mountCanvas()
    twoRoomsAndADoor()

    // Draw mode: the seam at x=2 is an edge run of both rooms, so it resizes.
    expect(await cursorAt(wrapper, viewport, at(2, 0.5))).toBe('ew-resize')

    useModeStore().setMode('door')
    expect(await cursorAt(wrapper, viewport, at(2, 0.5))).toBe('pointer')
    wrapper.unmount()
  })

  // Switching modes changes what the pointer is over without the pointer moving.
  it('updates the cursor when the mode changes under a still pointer', async () => {
    const { wrapper, viewport } = mountCanvas()
    twoRoomsAndADoor()
    const cursor = () => (wrapper.get('.canvas-viewport').element as HTMLElement).style.cursor

    expect(await cursorAt(wrapper, viewport, at(2, 0.5))).toBe('ew-resize')
    useModeStore().setMode('door')
    await nextTick()
    expect(cursor()).toBe('pointer')
    wrapper.unmount()
  })

  // A press in Door mode must never fall through to Draw mode's paint: the
  // failure that would eat the map. None of these four presses touches a cell:
  // three do nothing at all, and the one that does something (a room cell starts
  // a pending teleport) is by definition not a model change.
  it('paints nothing on a press, on empty grid and on a room alike', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = twoRoomsAndADoor()
    const model = useModelStore()
    useModeStore().setMode('door')
    const before = model.rev

    for (const point of [at(9.5, 9.5), at(2.5, 1.5), at(2, 0.5), at(3.5, 1.5)]) {
      viewport.dispatchEvent(pointer('pointerdown', point))
      viewport.dispatchEvent(pointer('pointerup', point))
    }

    expect(model.rev).toBe(before)
    expect(model.project.mapsById.get(mapId)!.rooms.size).toBe(2)
    wrapper.unmount()
  })

  // The left button draws a box; the right button is the erase column, and must
  // not draw one however far it is dragged. A right drag is the case a button
  // check alone would miss, because a right press that goes nowhere commits an
  // empty transaction and looks identical either way. (That this drag also
  // deletes nothing is the erase column's own rule: it crosses no transition.)
  it('creates nothing on a right-button drag across a seam', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = twoRoomsAndADoor()
    const model = useModelStore()
    useModeStore().setMode('door')
    const before = model.project.mapsById.get(mapId)!.transitions.size

    viewport.dispatchEvent(pointer('pointerdown', { ...at(2.5, 1.5), button: 2 }))
    viewport.dispatchEvent(pointer('pointermove', { ...at(1.5, 1.5), button: 2 }))
    viewport.dispatchEvent(pointer('pointerup', { ...at(1.5, 1.5), button: 2 }))

    expect(model.project.mapsById.get(mapId)!.transitions.size).toBe(before)
    wrapper.unmount()
  })

  // The same drag on the left button does make one: otherwise the test above
  // would pass on a mode where nothing works at all.
  it('creates a door on the same drag with the left button', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = twoRoomsAndADoor()
    const model = useModelStore()
    useModeStore().setMode('door')
    const before = model.project.mapsById.get(mapId)!.transitions.size

    viewport.dispatchEvent(pointer('pointerdown', at(2.5, 1.5)))
    viewport.dispatchEvent(pointer('pointermove', at(1.5, 1.5)))
    viewport.dispatchEvent(pointer('pointerup', at(1.5, 1.5)))

    expect(model.project.mapsById.get(mapId)!.transitions.size).toBe(before + 1)
    expect(model.status.undoLabel).toBe('Add Transition')
    wrapper.unmount()
  })

  // A press in Door mode must not arm a room either: the active room is Draw
  // mode's, and its handles are not drawn here.
  it('does not arm a room, and draws no handles', () => {
    const { wrapper, viewport } = mountCanvas()
    twoRoomsAndADoor()
    const activeRoom = useActiveRoomStore()
    useModeStore().setMode('door')

    viewport.dispatchEvent(pointer('pointerdown', at(2.5, 1.5)))
    viewport.dispatchEvent(pointer('pointerup', at(2.5, 1.5)))

    expect(activeRoom.isArmed).toBe(false)
    wrapper.unmount()
  })

  // A room armed in Draw mode stays armed (switching modes is not a deselect),
  // but its handles come off the canvas, because in Door mode a press on one
  // does nothing.
  it('takes the armed room’s handles off the canvas in Door mode', async () => {
    const { wrapper, viewport } = mountCanvas()
    twoRoomsAndADoor()
    const activeRoom = useActiveRoomStore()
    const ctx = (wrapper.get('.canvas').element as HTMLCanvasElement).getContext(
      '2d',
    ) as unknown as FakeContext2D

    // Arm the eastern room in Draw mode and put the pointer in it.
    viewport.dispatchEvent(pointer('pointerdown', at(2.5, 0.5)))
    viewport.dispatchEvent(pointer('pointerup', at(2.5, 0.5)))
    viewport.dispatchEvent(new PointerEvent('pointermove', { ...at(2.4, 0.4), bubbles: true }))
    await nextTick()

    // One repaint each way, through the same mode watch: comparing a single
    // repaint against a running total would be true whatever the modes drew.
    const strokesAfterModeChange = async (mode: 'draw' | 'door') => {
      ctx.stroke.mockClear()
      useModeStore().setMode(mode)
      await nextTick()
      return ctx.stroke.mock.calls.length
    }

    const door = await strokesAfterModeChange('door')
    const drawing = await strokesAfterModeChange('draw')

    expect(activeRoom.isArmed).toBe(true)
    expect(door).toBeLessThan(drawing)
    wrapper.unmount()
  })

  // The brush footprint says "a press lands here", which is false in Door mode.
  it('drops the brush preview in Door mode', async () => {
    const { wrapper, viewport } = mountCanvas()
    twoRoomsAndADoor()
    useToolsStore().setBrushSize(3)
    const ctx = (wrapper.get('.canvas').element as HTMLCanvasElement).getContext(
      '2d',
    ) as unknown as FakeContext2D

    viewport.dispatchEvent(new PointerEvent('pointermove', { ...at(6.5, 6.5), bubbles: true }))
    await nextTick()

    // One repaint each way, for the same reason as the handles above.
    const strokesAfterModeChange = async (mode: 'draw' | 'door') => {
      ctx.stroke.mockClear()
      useModeStore().setMode(mode)
      await nextTick()
      return ctx.stroke.mock.calls.length
    }

    const door = await strokesAfterModeChange('door')
    const drawing = await strokesAfterModeChange('draw')

    expect(door).toBeLessThan(drawing)
    wrapper.unmount()
  })
})

// The teleport gesture as the component sees it: the click-vs-drag rule
// deciding which of the table's first two columns a press belongs to, and the
// wiring the store cannot own: `Esc`, and the prompt.
//
// The state machine itself is `stores/pendingTeleport.test.ts`; nothing here
// re-asserts it.
describe('CanvasRegion pending teleport', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    viewport.setPointerCapture = () => {}
    return { wrapper, viewport }
  }

  function pointer(type: string, init: PointerEventInit = {}) {
    return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  }

  function at(x: number, y: number) {
    const tabsStore = useTabsStore()
    const tile = useModelStore().tileSize
    const camera = tabsStore.cameraOf(tabsStore.activeTabId)
    return {
      clientX: (x - camera.pan.x) * tile * camera.zoom,
      clientY: (y - camera.pan.y) * tile * camera.zoom,
    }
  }

  // Two rooms two cells apart, so a box drag between them is an elevator and a
  // teleport between them is valid, and the gap gives a bare-grid cell to
  // misclick on.
  function twoRooms() {
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    model.run('Setup', mapScope(mapId), (tx) => {
      const map = model.project.mapsById.get(mapId)!
      paintCells(tx, model.project, map, ['0,0', '0,1'], { areaId: WORLD_AREA_ID })
      paintCells(tx, model.project, map, ['3,0', '3,1'], { areaId: WORLD_AREA_ID })
    })
    return mapId
  }

  function click(viewport: HTMLElement, point: { clientX: number; clientY: number }) {
    viewport.dispatchEvent(pointer('pointerdown', point))
    viewport.dispatchEvent(pointer('pointerup', point))
  }

  function teleports(mapId: MapId) {
    return [...useModelStore().project.mapsById.get(mapId)!.transitions.values()].filter(
      (transition) => transition.kind === 'teleport',
    )
  }

  it('starts pending on a click, and completes on the second one', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = twoRooms()
    const pending = usePendingTeleportStore()
    useModeStore().setMode('door')

    click(viewport, at(0.5, 0.5))
    expect(pending.originOn(mapId)).toBe('0,0')
    expect(teleports(mapId)).toEqual([])

    click(viewport, at(3.5, 0.5))
    expect(pending.isPending).toBe(false)
    expect(teleports(mapId)).toHaveLength(1)
    wrapper.unmount()
  })

  // The three rows of the table that are not "room cell, no transition". Each
  // has its own reason: bare grid because gestures start on a room cell, and
  // the two transition rows because select beats create, so clicking one of
  // those selects it, and starting a teleport instead would put an endpoint on
  // a cell the user was trying to act on.
  it('starts nothing on bare grid, on a door edge, or on an existing teleport', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = twoRooms()
    const model = useModelStore()
    const pending = usePendingTeleportStore()
    useModeStore().setMode('door')
    // A teleport in the eastern room's lower cell, and a door on the seam of two
    // adjacent rooms: the gap fixture has no shared boundary, so the door
    // needs a room of its own against the eastern one.
    model.run('Existing', mapScope(mapId), (tx) => {
      const map = model.project.mapsById.get(mapId)!
      createTeleport(tx, model.project, { mapId, cell: '0,1' }, { mapId, cell: '3,1' })
      paintCells(tx, model.project, map, ['4,0'], { areaId: WORLD_AREA_ID })
      createFromBox(tx, model.project, map, '3,0', '4,0')
    })

    click(viewport, at(9.5, 9.5))
    expect(pending.isPending).toBe(false)

    // On the door's edge, at the seam x = 4: the edge hit, not the interior.
    click(viewport, at(4, 0.5))
    expect(pending.isPending).toBe(false)

    click(viewport, at(3.5, 1.5))
    expect(pending.isPending).toBe(false)
    wrapper.unmount()
  })

  it('does nothing outside Door mode', () => {
    const { wrapper, viewport } = mountCanvas()
    twoRooms()

    // Draw mode is the default, and a click there paints.
    click(viewport, at(0.5, 0.5))

    expect(usePendingTeleportStore().isPending).toBe(false)
    wrapper.unmount()
  })

  // A press becomes a drag only once the pointer has both left its cell and
  // passed the pixel dead-zone.
  describe('the click-vs-drag rule', () => {
    // The jitter guard is only load-bearing zoomed out: a tap that slips a
    // pixel or two must stay a click even where a cell is only a few pixels on
    // screen. At 100% a 2px wobble cannot leave a 32px cell, so the cell
    // trigger alone would carry the test below; here a cell is a few pixels
    // across and the same wobble crosses one, so only the pixel half can save
    // it.
    it('still counts as a click after a wobble that crosses a cell, zoomed out', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = twoRooms()
      const tabsStore = useTabsStore()
      useModeStore().setMode('door')
      tabsStore.setZoom(mapId, 0.1)

      const start = at(0.5, 0.5)
      const cellPx = useModelStore().tileSize * 0.1
      // Well past a cell boundary, and still inside the 5px dead-zone.
      expect(cellPx).toBeLessThan(DRAG_DEAD_ZONE)
      viewport.dispatchEvent(pointer('pointerdown', start))
      viewport.dispatchEvent(
        pointer('pointermove', { clientX: start.clientX + 4, clientY: start.clientY }),
      )
      viewport.dispatchEvent(pointer('pointerup', start))

      expect(usePendingTeleportStore().originOn(mapId)).toBe('0,0')
      wrapper.unmount()
    })

    // The jitter guard, which is the whole reason the pixel half exists: a tap
    // that slips a pixel or two stays a click.
    it('still counts as a click after a wobble inside the dead-zone', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = twoRooms()
      useModeStore().setMode('door')

      const start = at(0.5, 0.5)
      viewport.dispatchEvent(pointer('pointerdown', start))
      viewport.dispatchEvent(
        pointer('pointermove', { clientX: start.clientX + 2, clientY: start.clientY + 2 }),
      )
      viewport.dispatchEvent(pointer('pointerup', start))

      expect(usePendingTeleportStore().originOn(mapId)).toBe('0,0')
      wrapper.unmount()
    })

    // The case the browser's own `click` event gets wrong, and the reason this
    // is no longer wired to one: it fires when press and release share an
    // element, however far the pointer went in between.
    it('is a drag, not a click, when the pointer leaves the cell and comes back', () => {
      const { wrapper, viewport } = mountCanvas()
      twoRooms()
      const model = useModelStore()
      useModeStore().setMode('door')
      const before = model.status.undoLabel

      const start = at(0.5, 0.5)
      viewport.dispatchEvent(pointer('pointerdown', start))
      viewport.dispatchEvent(pointer('pointermove', at(3.5, 0.5)))
      viewport.dispatchEvent(pointer('pointermove', start))
      viewport.dispatchEvent(pointer('pointerup', start))

      // Neither gesture happened: the box classified to nothing where it ended,
      // and a drag is not a click.
      expect(usePendingTeleportStore().isPending).toBe(false)
      expect(model.status.undoLabel).toBe(before)
      wrapper.unmount()
    })

    // The other half of the same rule: a real drag makes its transition and must
    // not also leave a teleport pending behind it.
    it('leaves nothing pending after a drag that made an elevator', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = twoRooms()
      const model = useModelStore()
      useModeStore().setMode('door')

      viewport.dispatchEvent(pointer('pointerdown', at(0.5, 0.5)))
      viewport.dispatchEvent(pointer('pointermove', at(3.5, 0.5)))
      viewport.dispatchEvent(pointer('pointerup', at(3.5, 0.5)))

      expect(model.project.mapsById.get(mapId)!.transitions.size).toBe(1)
      expect(usePendingTeleportStore().isPending).toBe(false)
      wrapper.unmount()
    })
  })

  // The `gesture` tier, where the stack puts it by name, and LIFO inside that
  // tier: these two gestures are not mutually exclusive, since you may draw a
  // door while a teleport is pending.
  describe('Esc', () => {
    it('cancels the pending teleport', () => {
      const { wrapper, viewport } = mountCanvas()
      twoRooms()
      const pending = usePendingTeleportStore()
      useModeStore().setMode('door')
      click(viewport, at(0.5, 0.5))

      expect(resolveEscape()).toBe(true)

      expect(pending.isPending).toBe(false)
      wrapper.unmount()
    })

    // The peel: the box drag pushed later, so it dies first and the teleport is
    // still waiting underneath. A shared tier with the wrong order, or a tier
    // below the box, would take the teleport out from under a drag the user
    // was only trying to abandon.
    it('aborts a box drag first, leaving the teleport pending', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = twoRooms()
      const model = useModelStore()
      const pending = usePendingTeleportStore()
      useModeStore().setMode('door')
      click(viewport, at(0.5, 0.5))

      viewport.dispatchEvent(pointer('pointerdown', at(0.5, 1.5)))
      viewport.dispatchEvent(pointer('pointermove', at(3.5, 1.5)))
      expect(resolveEscape()).toBe(true)
      viewport.dispatchEvent(pointer('pointerup', at(3.5, 1.5)))

      expect(model.project.mapsById.get(mapId)!.transitions.size).toBe(0)
      expect(pending.originOn(mapId)).toBe('0,0')

      // And the second press peels the layer underneath.
      expect(resolveEscape()).toBe(true)
      expect(pending.isPending).toBe(false)
      wrapper.unmount()
    })

    // The tier itself, which nothing in Door mode can distinguish on its own:
    // the box drag is also in the gesture tier, so LIFO would give the same
    // answer wherever this sat, and Door mode never arms a room, so the
    // selection tier is empty here. Pushing a selection handler by hand is the
    // only way to ask the question, and the answer has to be that pending wins,
    // because a tier below `selection` would deselect before cancelling.
    it('outranks the selection tier however late that registers', () => {
      const { wrapper, viewport } = mountCanvas()
      twoRooms()
      const pending = usePendingTeleportStore()
      useModeStore().setMode('door')
      click(viewport, at(0.5, 0.5))

      let deselected = false
      const pop = pushEscHandler('selection', () => {
        deselected = true
      })

      expect(resolveEscape()).toBe(true)
      expect(pending.isPending).toBe(false)
      expect(deselected).toBe(false)

      pop()
      wrapper.unmount()
    })

    // Registered only while pending, or it would sit in the gesture tier
    // swallowing every `Esc` meant for the tiers below it.
    it('falls through to the tiers below when nothing is pending', () => {
      const { wrapper } = mountCanvas()
      twoRooms()
      useModeStore().setMode('door')

      expect(resolveEscape()).toBe(false)
      wrapper.unmount()
    })

    // And it has to come off again, which the test above cannot see because it
    // never put anything on. A handler left behind after the gesture completed
    // would swallow the next `Esc` and do nothing with it: the worst kind of
    // dead key, since the tier below would never hear it.
    it('comes off the stack again once the teleport completes', () => {
      const { wrapper, viewport } = mountCanvas()
      twoRooms()
      useModeStore().setMode('door')

      click(viewport, at(0.5, 0.5))
      click(viewport, at(3.5, 0.5))

      expect(usePendingTeleportStore().isPending).toBe(false)
      expect(resolveEscape()).toBe(false)
      wrapper.unmount()
    })

    it('stops answering once the component is gone', () => {
      const { wrapper, viewport } = mountCanvas()
      twoRooms()
      useModeStore().setMode('door')
      click(viewport, at(0.5, 0.5))

      wrapper.unmount()

      expect(resolveEscape()).toBe(false)
    })
  })

  // After the first click, the origin endpoint shows a marker and a "pick a
  // destination" prompt.
  describe('the prompt', () => {
    it('appears while pending and goes with it', async () => {
      const { wrapper, viewport } = mountCanvas()
      twoRooms()
      useModeStore().setMode('door')
      expect(wrapper.find('.pending-prompt').exists()).toBe(false)

      click(viewport, at(0.5, 0.5))
      await nextTick()
      expect(wrapper.find('.pending-prompt').exists()).toBe(true)

      click(viewport, at(3.5, 0.5))
      await nextTick()
      expect(wrapper.find('.pending-prompt').exists()).toBe(false)
      wrapper.unmount()
    })

    // It appears without focus moving and without being asked for, which is
    // exactly the case `aria-live` exists for.
    it('announces itself', async () => {
      const { wrapper, viewport } = mountCanvas()
      twoRooms()
      useModeStore().setMode('door')

      click(viewport, at(0.5, 0.5))
      await nextTick()

      expect(wrapper.get('.pending-prompt').attributes('aria-live')).toBe('polite')
      wrapper.unmount()
    })
  })

  // The origin marker is drawn from state no model revision moves: starting a
  // pending teleport changes nothing in the project by definition, so without a
  // watch of its own it would appear only on the next unrelated edit.
  it('repaints when the pending state starts and when it ends', async () => {
    const { wrapper, viewport } = mountCanvas()
    twoRooms()
    useModeStore().setMode('door')
    const ctx = (wrapper.get('.canvas').element as HTMLCanvasElement).getContext(
      '2d',
    ) as unknown as FakeContext2D
    await nextTick()

    ctx.stroke.mockClear()
    click(viewport, at(0.5, 0.5))
    await nextTick()
    expect(ctx.stroke.mock.calls.length).toBeGreaterThan(0)

    ctx.stroke.mockClear()
    usePendingTeleportStore().cancel()
    await nextTick()
    expect(ctx.stroke.mock.calls.length).toBeGreaterThan(0)
    wrapper.unmount()
  })

  // While pending, every click is a completion attempt, so the table's cursors
  // would all be promising something the dispatch has already given away. The
  // crosshair marks exactly where a click would complete.
  it('points the cursor at the cells a click would complete on', async () => {
    const { wrapper, viewport } = mountCanvas()
    twoRooms()
    useModeStore().setMode('door')
    const cursorAt = async (point: { clientX: number; clientY: number }) => {
      viewport.dispatchEvent(new PointerEvent('pointermove', { ...point, bubbles: true }))
      await nextTick()
      return (wrapper.get('.canvas-viewport').element as HTMLElement).style.cursor
    }

    // Before: the ordinary table. A room cell offers both creation gestures.
    expect(await cursorAt(at(3.5, 0.5))).toBe('crosshair')

    click(viewport, at(0.5, 0.5))

    // After: the other room still offers, because a click there completes...
    expect(await cursorAt(at(3.5, 0.5))).toBe('crosshair')
    // ...and the origin's own room no longer does, because a click there is
    // ignored.
    expect(await cursorAt(at(0.5, 1.5))).toBe('')
    wrapper.unmount()
  })

  // You may switch and create tabs freely while pending: the reason this is a
  // store and not a gesture.
  it('survives a tab switch and completes across two maps', () => {
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()
    const tabsStore = useTabsStore()
    const mapId = twoRooms()
    const pending = usePendingTeleportStore()
    useModeStore().setMode('door')

    click(viewport, at(0.5, 0.5))

    tabsStore.addTab()
    const otherId = tabsStore.activeTabId
    model.run('Setup', mapScope(otherId), (tx) =>
      paintCells(tx, model.project, model.project.mapsById.get(otherId)!, ['2,2'], {
        areaId: WORLD_AREA_ID,
      }),
    )
    expect(pending.isPending).toBe(true)
    // Nothing is drawn on the new tab: the origin belongs to the other map.
    expect(pending.originOn(otherId)).toBeNull()

    click(viewport, at(2.5, 2.5))

    expect(pending.isPending).toBe(false)
    // Stored once, under the origin map.
    expect(teleports(mapId)).toHaveLength(1)
    expect(teleports(otherId)).toEqual([])

    // And scoped to the map that stores it, which is what makes the single
    // Ctrl+Z land somewhere coherent: undo takes you back to the end you
    // started from rather than leaving you on a tab whose marker just vanished.
    model.undo()
    expect(tabsStore.activeTabId).toBe(mapId)
    expect(teleports(mapId)).toEqual([])
    wrapper.unmount()
  })

  // An invalid second click is ignored uniformly, and selection is one of the
  // things that gives way to it: a click on a transition while pending is a
  // misclick, not a select. Anything else would be a different answer to the
  // same misclick depending on where it landed.
  //
  // Navigation is not given up, and does not need to be: it lives on
  // double-click, which is not a completion attempt at all. You may switch and
  // create tabs freely while pending, so a double-click that takes you to the
  // destination tab with the gesture still live is exactly the intended path.
  it('takes the click away from selection while pending, and keeps navigation', () => {
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()
    const tabsStore = useTabsStore()
    const mapId = twoRooms()
    const pending = usePendingTeleportStore()
    const selection = useSelectionStore()

    tabsStore.addTab()
    const otherId = tabsStore.activeTabId
    tabsStore.activate(mapId)
    model.run('Setup', PROJECT_SCOPE, (tx) => {
      paintCells(tx, model.project, model.project.mapsById.get(otherId)!, ['2,2'], {
        areaId: WORLD_AREA_ID,
      })
      createTeleport(tx, model.project, { mapId, cell: '3,1' }, { mapId: otherId, cell: '2,2' })
    })
    useModeStore().setMode('door')

    // Without a pending teleport, a click on that marker selects it.
    click(viewport, at(3.5, 1.5))
    expect(selection.selected).toHaveLength(1)

    click(viewport, at(0.5, 0.5))
    expect(pending.isPending).toBe(true)
    // Starting the gesture cleared the selection, and the misclick does not
    // bring it back: it is an ignored completion attempt and nothing else.
    expect(selection.isEmpty).toBe(true)

    click(viewport, at(3.5, 1.5))
    expect(selection.isEmpty).toBe(true)
    expect(tabsStore.activeTabId).toBe(mapId)
    expect(pending.originOn(mapId)).toBe('0,0')

    // And the double-click still travels, with the gesture intact.
    click(viewport, at(3.5, 1.5))
    viewport.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true, ...at(3.5, 1.5) }),
    )
    expect(tabsStore.activeTabId).toBe(otherId)
    expect(pending.originOn(mapId)).toBe('0,0')
    wrapper.unmount()
  })
})

// The erase column of the table: delete it on the two transition rows, nothing
// on the other two.
//
// That second half is the interesting one, because it is the deliberate
// opposite of Draw mode's erase-priority rule: there a right-press that misses
// an inner wall still erases the cell under it, and here a miss is simply a
// miss.
describe('CanvasRegion Door mode delete', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    viewport.setPointerCapture = () => {}
    return { wrapper, viewport }
  }

  function pointer(type: string, init: PointerEventInit = {}) {
    return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  }

  function at(x: number, y: number) {
    const tabsStore = useTabsStore()
    const tile = useModelStore().tileSize
    const camera = tabsStore.cameraOf(tabsStore.activeTabId)
    return {
      clientX: (x - camera.pan.x) * tile * camera.zoom,
      clientY: (y - camera.pan.y) * tile * camera.zoom,
    }
  }

  // All three kinds on one map: a door on the seam at x = 2, an elevator across
  // the gap on row 4, and a same-map teleport between the two western rooms.
  function allThreeKinds() {
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId

    model.run('Setup', mapScope(mapId), (tx) => {
      const map = model.project.mapsById.get(mapId)!
      paintCells(tx, model.project, map, ['0,0', '1,0', '0,1', '1,1'], { areaId: WORLD_AREA_ID })
      paintCells(tx, model.project, map, ['2,0', '2,1'], { areaId: WORLD_AREA_ID })
      paintCells(tx, model.project, map, ['0,4'], { areaId: WORLD_AREA_ID })
      paintCells(tx, model.project, map, ['4,4'], { areaId: WORLD_AREA_ID })
      createFromBox(tx, model.project, map, '1,0', '2,0')
      createFromBox(tx, model.project, map, '0,4', '4,4')
      createTeleport(tx, model.project, { mapId, cell: '0,1' }, { mapId, cell: '2,1' })
    })
    useModeStore().setMode('door')
    return mapId
  }

  function transitions(mapId: MapId) {
    return useModelStore().project.mapsById.get(mapId)!.transitions
  }

  function rightClick(viewport: HTMLElement, point: { clientX: number; clientY: number }) {
    viewport.dispatchEvent(pointer('pointerdown', { ...point, button: 2 }))
    viewport.dispatchEvent(pointer('pointerup', { ...point, button: 2 }))
  }

  // Each kind is reached through a different zone: a door and an elevator end
  // by their edge, a teleport by its cell interior, so "delete works" has to be
  // asked once per kind rather than once.
  it('deletes a door, an elevator and a teleport, each as one undo step', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = allThreeKinds()
    const model = useModelStore()
    expect(transitions(mapId).size).toBe(3)

    // The door, on the seam at x = 2.
    rightClick(viewport, at(2, 0.5))
    expect(transitions(mapId).size).toBe(2)
    expect(model.status.undoLabel).toBe('Delete Transition')

    // The elevator, on its A end's facing edge at x = 1, row 4.
    rightClick(viewport, at(1, 4.5))
    expect(transitions(mapId).size).toBe(1)

    // The teleport, through the cell interior.
    rightClick(viewport, at(0.5, 1.5))
    expect(transitions(mapId).size).toBe(0)

    // One step each, and every one of them reversible.
    model.undo()
    model.undo()
    model.undo()
    expect(transitions(mapId).size).toBe(3)
    expect(checkInvariants(model.project)).toEqual([])
    wrapper.unmount()
  })

  // Erase/right-click on a non-transition does nothing: Door mode never
  // destroys a room, so a stray right-drag across the map is harmless here
  // where it would be dangerous in Draw mode.
  //
  // Watching for a thrown error is half the test: a press on a row with no
  // transition reaches `deleteTransition` with no id, which throws
  // `ModelError`. jsdom swallows an exception thrown inside an event listener
  // (`dispatchEvent` reports it and returns normally), so without this check
  // the mutation that drops the guard would pass every assertion below.
  it('destroys nothing on a bare room cell or on empty grid', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = allThreeKinds()
    const model = useModelStore()
    const before = model.status.undoLabel

    const thrown: unknown[] = []
    const onError = (event: ErrorEvent) => thrown.push(event.error ?? event.message)
    window.addEventListener('error', onError)

    rightClick(viewport, at(0.5, 0.5))
    rightClick(viewport, at(9.5, 9.5))

    window.removeEventListener('error', onError)
    expect(thrown).toEqual([])
    expect(transitions(mapId).size).toBe(3)
    expect(model.project.mapsById.get(mapId)!.rooms.size).toBe(4)
    expect(model.status.undoLabel).toBe(before)
    wrapper.unmount()
  })

  // The fourth row of the input table: neither create nor erase. Middle-drag
  // pan does not exist yet, and until it does the one thing it must not do is
  // fall through: a middle press that started a teleport would be a gesture
  // nobody asked for, on a button reserved for something else entirely.
  it('starts nothing at all on a middle-button press', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = allThreeKinds()
    const model = useModelStore()
    const before = model.status.undoLabel

    // On a room cell, where the primary button would start a teleport...
    viewport.dispatchEvent(pointer('pointerdown', { ...at(0.5, 0.5), button: 1 }))
    viewport.dispatchEvent(pointer('pointerup', { ...at(0.5, 0.5), button: 1 }))
    expect(usePendingTeleportStore().isPending).toBe(false)

    // ...and on a door, where the secondary button would delete it.
    viewport.dispatchEvent(pointer('pointerdown', { ...at(2, 0.5), button: 1 }))
    viewport.dispatchEvent(pointer('pointerup', { ...at(2, 0.5), button: 1 }))

    expect(transitions(mapId).size).toBe(3)
    expect(model.status.undoLabel).toBe(before)
    wrapper.unmount()
  })

  // The toggle is the third erase route and the only one touch has, so the same
  // press that would create must delete while it is on.
  it('deletes on a left click while the erase toggle is on', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = allThreeKinds()
    const tools = useToolsStore()

    // With the toggle off, that same click is the create column: a click on a
    // room cell starts a teleport.
    viewport.dispatchEvent(pointer('pointerdown', at(0.5, 0.5)))
    viewport.dispatchEvent(pointer('pointerup', at(0.5, 0.5)))
    expect(usePendingTeleportStore().isPending).toBe(true)
    usePendingTeleportStore().cancel()

    tools.toggleErase()
    viewport.dispatchEvent(pointer('pointerdown', at(2, 0.5)))
    viewport.dispatchEvent(pointer('pointerup', at(2, 0.5)))

    expect(transitions(mapId).size).toBe(2)
    wrapper.unmount()
  })

  // While the toggle is on, the primary pointer erases instead of its normal
  // action, so neither creation gesture may fire: a box drag from a room cell
  // least of all, since it would make the very thing the user is deleting.
  it('starts no box drag and no teleport while the erase toggle is on', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = allThreeKinds()
    useToolsStore().toggleErase()

    // The drag that makes a door with the toggle off.
    viewport.dispatchEvent(pointer('pointerdown', at(1.5, 1.5)))
    viewport.dispatchEvent(pointer('pointermove', at(2.5, 1.5)))
    viewport.dispatchEvent(pointer('pointerup', at(2.5, 1.5)))

    expect(transitions(mapId).size).toBe(3)
    expect(usePendingTeleportStore().isPending).toBe(false)
    wrapper.unmount()
  })

  // A cross-tab teleport is stored under its origin map, and the destination
  // tab's marker is derived, so deleting from there has to reach across and
  // take the stored object with it, far-end index and all.
  it('deletes a cross-tab teleport from its far end', () => {
    const { wrapper, viewport } = mountCanvas()
    const model = useModelStore()
    const tabsStore = useTabsStore()
    const surfaceId = tabsStore.activeTabId

    tabsStore.addTab()
    const cavesId = tabsStore.activeTabId
    tabsStore.activate(surfaceId)
    model.run('Setup', PROJECT_SCOPE, (tx) => {
      paintCells(tx, model.project, model.project.mapsById.get(surfaceId)!, ['1,1'], {
        areaId: WORLD_AREA_ID,
      })
      paintCells(tx, model.project, model.project.mapsById.get(cavesId)!, ['4,3'], {
        areaId: WORLD_AREA_ID,
      })
      createTeleport(
        tx,
        model.project,
        { mapId: surfaceId, cell: '1,1' },
        { mapId: cavesId, cell: '4,3' },
      )
    })
    useModeStore().setMode('door')

    tabsStore.activate(cavesId)
    rightClick(viewport, at(4.5, 3.5))

    // Gone from the map that stored it, and its derived marker with it.
    expect(transitions(surfaceId).size).toBe(0)
    expect(model.project.teleportFarEnds.size).toBe(0)
    expect(checkInvariants(model.project)).toEqual([])

    // And back in one step, on the tab it was deleted from: the undo entry is
    // scoped to where the user acted, not to where the object lived.
    model.undo()
    expect(transitions(surfaceId).size).toBe(1)
    expect(tabsStore.activeTabId).toBe(cavesId)
    wrapper.unmount()
  })

  it('does nothing outside Door mode', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = allThreeKinds()
    const model = useModelStore()
    useModeStore().setMode('draw')

    // A right-press on a plain cell of the western room. In Draw mode that is
    // an erase stroke, which takes the cell: the opposite of Door mode, where
    // the same press on the same pixel takes nothing.
    //
    // Deliberately a cell no transition is anchored to. Erasing one that is
    // would take the transition too, but by the cascade (a teleport whose
    // endpoint left its room is invalid and goes), which is a rule about rooms,
    // not about this dispatch, and would make the test unable to tell the two
    // apart.
    rightClick(viewport, at(0.5, 0.5))

    expect(transitions(mapId).size).toBe(3)
    expect(model.status.undoLabel).toBe('Erase')
    wrapper.unmount()
  })

  // The cursor never promises a gesture the dispatch does not have, and the
  // erase toggle replaces the whole primary column rather than adding to it.
  it('drops the create cursor while the erase toggle is on', async () => {
    const { wrapper, viewport } = mountCanvas()
    allThreeKinds()
    const tools = useToolsStore()
    const cursorAt = async (point: { clientX: number; clientY: number }) => {
      viewport.dispatchEvent(new PointerEvent('pointermove', { ...point, bubbles: true }))
      await nextTick()
      return (wrapper.get('.canvas-viewport').element as HTMLElement).style.cursor
    }

    expect(await cursorAt(at(0.5, 0.5))).toBe('crosshair')
    expect(await cursorAt(at(2, 0.5))).toBe('pointer')

    tools.toggleErase()
    await nextTick()

    // A room cell erases nothing, so it must stop offering. The door still
    // answers, because there a click does something either way.
    expect(await cursorAt(at(0.5, 0.5))).toBe('')
    expect(await cursorAt(at(2, 0.5))).toBe('pointer')
    wrapper.unmount()
  })

  // Toggled from the toolbar, so the pointer is nowhere near the canvas when it
  // changes: the same catch-up the mode and the sub-mode lock need.
  it('updates the cursor when the toggle changes under a still pointer', async () => {
    const { wrapper, viewport } = mountCanvas()
    allThreeKinds()
    const cursor = () => (wrapper.get('.canvas-viewport').element as HTMLElement).style.cursor

    viewport.dispatchEvent(new PointerEvent('pointermove', { ...at(0.5, 0.5), bubbles: true }))
    await nextTick()
    expect(cursor()).toBe('crosshair')

    useToolsStore().toggleErase()
    await nextTick()
    expect(cursor()).toBe('')
    wrapper.unmount()
  })
})

// Select beats create: clicking an existing transition selects it rather than
// starting a new one. The toolbar controls creation only and is
// `DoorToolbar`'s business, so what is tested here is only what a click does.
describe('CanvasRegion Door mode selection', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    viewport.setPointerCapture = () => {}
    return { wrapper, viewport }
  }

  function pointer(type: string, init: PointerEventInit = {}) {
    return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  }

  function at(x: number, y: number) {
    const tabsStore = useTabsStore()
    const tile = useModelStore().tileSize
    const camera = tabsStore.cameraOf(tabsStore.activeTabId)
    return {
      clientX: (x - camera.pan.x) * tile * camera.zoom,
      clientY: (y - camera.pan.y) * tile * camera.zoom,
    }
  }

  function click(viewport: HTMLElement, point: { clientX: number; clientY: number }) {
    viewport.dispatchEvent(pointer('pointerdown', point))
    viewport.dispatchEvent(pointer('pointerup', point))
  }

  // A door on the seam at x = 2, and a same-map teleport between the two rooms.
  function twoRoomsADoorAndATeleport() {
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    model.run('Setup', mapScope(mapId), (tx) => {
      const map = model.project.mapsById.get(mapId)!
      paintCells(tx, model.project, map, ['0,0', '1,0', '0,1', '1,1'], { areaId: WORLD_AREA_ID })
      paintCells(tx, model.project, map, ['2,0', '2,1'], { areaId: WORLD_AREA_ID })
      createFromBox(tx, model.project, map, '1,0', '2,0')
      createTeleport(tx, model.project, { mapId, cell: '0,1' }, { mapId, cell: '2,1' })
    })
    useModeStore().setMode('door')
    return mapId
  }

  function idOfKind(mapId: MapId, kind: 'edge' | 'teleport') {
    const map = useModelStore().project.mapsById.get(mapId)!
    return [...map.transitions.values()].find((each) => each.kind === kind)!.id
  }

  it('selects the door under the pointer, and the teleport under the pointer', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = twoRoomsADoorAndATeleport()
    const selection = useSelectionStore()

    click(viewport, at(2, 0.5))
    expect(selection.selected).toEqual([{ kind: 'transition', id: idOfKind(mapId, 'edge') }])

    // And swapping one for the other replaces rather than accumulates: click
    // -select is single-select until shift-click lands with Select/Move.
    click(viewport, at(0.5, 1.5))
    expect(selection.selected).toEqual([{ kind: 'transition', id: idOfKind(mapId, 'teleport') }])
    wrapper.unmount()
  })

  // Select beats create: the press that selects must not also start a gesture
  // on the room cell underneath it.
  it('starts no pending teleport when it selects', () => {
    const { wrapper, viewport } = mountCanvas()
    twoRoomsADoorAndATeleport()

    click(viewport, at(2, 0.5))

    expect(usePendingTeleportStore().isPending).toBe(false)
    wrapper.unmount()
  })

  // Unlike the active room, which has no canvas deselect at all, this is a
  // selection, so clicking off it clears it.
  it('clears on a click over empty grid, and when a new gesture starts', () => {
    const { wrapper, viewport } = mountCanvas()
    twoRoomsADoorAndATeleport()
    const selection = useSelectionStore()

    click(viewport, at(2, 0.5))
    expect(selection.isEmpty).toBe(false)
    click(viewport, at(9.5, 9.5))
    expect(selection.isEmpty).toBe(true)

    // A click on a bare room cell starts a teleport, and starting one clears the
    // selection too: the two states are alternatives, not layers.
    click(viewport, at(2, 0.5))
    expect(selection.isEmpty).toBe(false)
    click(viewport, at(0.5, 0.5))
    expect(selection.isEmpty).toBe(true)
    expect(usePendingTeleportStore().isPending).toBe(true)
    wrapper.unmount()
  })

  it('deselects on Esc', () => {
    const { wrapper, viewport } = mountCanvas()
    twoRoomsADoorAndATeleport()
    const selection = useSelectionStore()

    click(viewport, at(2, 0.5))
    expect(resolveEscape()).toBe(true)

    expect(selection.isEmpty).toBe(true)
    expect(resolveEscape()).toBe(false)
    wrapper.unmount()
  })

  // The selection outlives nothing: a room edit that cascades the transition
  // away has to take it with it. The store's prune does the work; what this
  // checks is that Door mode's selection is subject to it like any other.
  it('prunes when a room edit cascades the transition away', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = twoRoomsADoorAndATeleport()
    const model = useModelStore()
    const selection = useSelectionStore()

    click(viewport, at(2, 0.5))
    expect(selection.isEmpty).toBe(false)

    // Erase the eastern room out from under the door: with only one room left on
    // the seam, the door is invalid and goes.
    model.run('Erase', mapScope(mapId), (tx) =>
      eraseCells(tx, model.project, model.project.mapsById.get(mapId)!, ['2,0', '2,1']),
    )

    expect(selection.isEmpty).toBe(true)
    wrapper.unmount()
  })

  // Delete/Backspace, already in the keymap and on the cheat sheet: a
  // transition selection is the first thing it can act on.
  it('deletes the selection on the Delete key, as one undo step', () => {
    const { wrapper, viewport } = mountCanvas()
    const mapId = twoRoomsADoorAndATeleport()
    const model = useModelStore()
    const before = model.project.mapsById.get(mapId)!.transitions.size

    click(viewport, at(2, 0.5))
    runAction('deleteSelection')

    expect(model.project.mapsById.get(mapId)!.transitions.size).toBe(before - 1)
    expect(model.status.undoLabel).toBe('Delete Transition')
    expect(useSelectionStore().isEmpty).toBe(true)

    model.undo()
    expect(model.project.mapsById.get(mapId)!.transitions.size).toBe(before)
    wrapper.unmount()
  })

  it('does nothing on Delete with nothing selected', () => {
    const { wrapper } = mountCanvas()
    const mapId = twoRoomsADoorAndATeleport()
    const model = useModelStore()
    const before = model.status.undoLabel

    runAction('deleteSelection')

    expect(model.project.mapsById.get(mapId)!.transitions.size).toBe(2)
    expect(model.status.undoLabel).toBe(before)
    wrapper.unmount()
  })
})
