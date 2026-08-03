import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import CanvasRegion from './CanvasRegion.vue'
import { useTabsStore } from '@/stores/tabs'
import { useToolsStore } from '@/stores/tools'
import { useModeStore } from '@/stores/mode'
import { useSelectionStore } from '@/stores/selection'
import { useCanvasViewStore } from '@/stores/canvasView'
import { mapScope, useModelStore } from '@/stores/model'
import { paintCells } from '@/core/ops/rooms'
import { createFromBox } from '@/core/ops/doors'
import { createLine, placeIcon } from '@/core/ops/markup'
import { WORLD_AREA_ID } from '@/core/ids'
import type { IconId, LineId, RoomId, TransitionId } from '@/core/ids'

// Select mode's press behaviour, as a matrix: one `describe` per target under
// the pointer, one `it` per gesture, plus the rules that cut across every
// target.
//
// The mode's own dispatch is what this suite is about. It is the one mode that
// does not route through `strokeActionFor`, so the secondary button's meaning
// is not inherited from anywhere and has to be pinned here.
describe('Select precedence table', () => {
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

  async function click(viewport: HTMLElement, point: PointerEventInit, button = 0) {
    viewport.dispatchEvent(press('pointerdown', { ...point, button }))
    viewport.dispatchEvent(press('pointerup', { ...point, button }))
    await nextTick()
    await nextTick()
  }

  async function shiftClick(viewport: HTMLElement, point: PointerEventInit) {
    await click(viewport, { ...point, shiftKey: true })
  }

  async function drag(viewport: HTMLElement, from: PointerEventInit, to: PointerEventInit) {
    viewport.dispatchEvent(press('pointerdown', from))
    viewport.dispatchEvent(press('pointermove', to))
    viewport.dispatchEvent(press('pointerup', to))
    await nextTick()
    await nextTick()
  }

  const selection = () => useSelectionStore()

  function map() {
    return useModelStore().project.mapsById.get(useTabsStore().activeTabId)!
  }

  // One map carrying one of every selectable kind, in separate rows so no press
  // is ambiguous about what it lands on.
  //
  //   row 0  room A (0,0)(1,0), room B (2,0)(3,0), a door on the seam at x=2
  //   row 2  room C (0,2)(1,2)(2,2), icon on (1,2)
  //   row 4  line L across (0,4)..(4,4), owned by no room
  function fixture() {
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    let roomA!: RoomId
    let roomC!: RoomId
    let door!: TransitionId
    let icon!: IconId
    let line!: LineId

    model.run('Setup', mapScope(mapId), (tx) => {
      const project = model.project
      const m = project.mapsById.get(mapId)!
      const paint = (cells: string[]) =>
        paintCells(tx, project, m, cells, { areaId: WORLD_AREA_ID })

      roomA = paint(['0,0', '1,0']).id
      paint(['2,0', '3,0'])
      door = (createFromBox(tx, project, m, '1,0', '2,0') as { id: TransitionId }[])[0].id

      roomC = paint(['0,2', '1,2', '2,2']).id
      icon = (
        placeIcon(tx, m, '1,2', 'save', { plateColor: '#111111', glyphColor: '#222222' }) as {
          id: IconId
        }
      ).id

      line = (
        createLine(tx, m, ['0,4', '1,4', '2,4', '3,4', '4,4'], {
          color: '#ffcc00',
          arrowStart: false,
          arrowEnd: false,
        }) as { id: LineId }
      ).id
    })
    return { mapId, roomA, roomC, door, icon, line }
  }

  // The Object row, which is one row for four kinds: the table treats a room, a
  // transition, an icon and a line identically in this column.
  describe('an object', () => {
    it('selects whichever kind is under the pointer', async () => {
      const { viewport } = await mountCanvas()
      const { roomA, door, icon, line } = fixture()

      await click(viewport, at(0.5, 0.5))
      expect(selection().selected).toEqual([{ kind: 'room', id: roomA }])

      await click(viewport, at(2, 0.5))
      expect(selection().selected).toEqual([{ kind: 'transition', id: door }])

      await click(viewport, at(1.5, 2.5))
      expect(selection().selected).toEqual([{ kind: 'icon', id: icon }])

      await click(viewport, at(2.5, 4.5))
      expect(selection().selected).toEqual([{ kind: 'line', id: line }])
    })

    it('adds and removes on shift-click', async () => {
      const { viewport } = await mountCanvas()
      const { roomA, icon } = fixture()

      await click(viewport, at(0.5, 0.5))
      await shiftClick(viewport, at(1.5, 2.5))
      expect(selection().selected).toEqual([
        { kind: 'room', id: roomA },
        { kind: 'icon', id: icon },
      ])

      await shiftClick(viewport, at(0.5, 0.5))
      expect(selection().selected).toEqual([{ kind: 'icon', id: icon }])
    })
  })

  describe('empty space', () => {
    it('deselects everything on a plain click', async () => {
      const { viewport } = await mountCanvas()
      fixture()

      await click(viewport, at(0.5, 0.5))
      expect(selection().isEmpty).toBe(false)

      await click(viewport, at(9.5, 9.5))
      expect(selection().isEmpty).toBe(true)
    })

    // A stray shift-click on bare grid must not destroy the multi-selection it
    // is being used to build.
    it('leaves the selection alone on a shift-click', async () => {
      const { viewport } = await mountCanvas()
      const { roomA } = fixture()

      await click(viewport, at(0.5, 0.5))
      await shiftClick(viewport, at(9.5, 9.5))
      expect(selection().selected).toEqual([{ kind: 'room', id: roomA }])
    })
  })

  // The Cells arm, reached through the store because the toolbar's half of it is
  // deliberately disabled. Every press resolves to the cell it landed in, and
  // the objects standing on that cell are unreachable.
  describe('the Cells sub-mode', () => {
    it('selects the cell where Rooms selects the object on it', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      useToolsStore().setSelectSubMode('cells')

      await click(viewport, at(1.5, 2.5))
      expect(selection().selected).toEqual([{ kind: 'cell', id: '1,2' }])
    })

    it('deselects on a cell no room owns, where a line happens to run', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      useToolsStore().setSelectSubMode('cells')

      await click(viewport, at(1.5, 2.5))
      await click(viewport, at(2.5, 4.5))
      expect(selection().isEmpty).toBe(true)
    })
  })

  // Cuts across every row.
  describe('every target', () => {
    // The one mode where the secondary button does not erase. It opens the
    // context menu, which does not exist yet, so what has to hold today is that
    // nothing is deleted and nothing is selected by it.
    it('deletes nothing on a right-click, unlike the other three modes', async () => {
      const { viewport } = await mountCanvas()
      const { icon } = fixture()

      await click(viewport, at(1.5, 2.5), 2)

      expect(map().icons.has(icon)).toBe(true)
      expect(selection().isEmpty).toBe(true)
      expect(useModelStore().status.undoLabel).not.toContain('Delete')
    })

    // A press that wandered is not a click. Nothing consumes the drag yet, so
    // what this pins is that the press did not quietly become one.
    it('selects nothing when the press leaves its cell', async () => {
      const { viewport } = await mountCanvas()
      fixture()

      await drag(viewport, at(0.5, 0.5), at(3.5, 3.5))
      expect(selection().isEmpty).toBe(true)
    })

    // You cannot select what you cannot see. The press falls through to the room
    // underneath rather than finding nothing, because the room is still there
    // and still visible.
    it('selects past an object whose layer is hidden', async () => {
      const { viewport } = await mountCanvas()
      const { roomC, icon } = fixture()

      await click(viewport, at(1.5, 2.5))
      expect(selection().selected).toEqual([{ kind: 'icon', id: icon }])

      useCanvasViewStore().toggleMarkup()
      await click(viewport, at(1.5, 2.5))
      expect(selection().selected).toEqual([{ kind: 'room', id: roomC }])
    })

    // The erase toggle is one flag across modes, so it can be on when Select is
    // entered. It governs the primary button in the three modes that author
    // something; here there is nothing to erase and it must not change a click.
    it('still selects while the erase toggle is on', async () => {
      const { viewport } = await mountCanvas()
      const { roomA } = fixture()
      useToolsStore().toggleErase()

      await click(viewport, at(0.5, 0.5))
      expect(selection().selected).toEqual([{ kind: 'room', id: roomA }])
    })
  })
})
