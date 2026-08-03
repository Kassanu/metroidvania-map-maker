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
import { runAction } from '@/hotkeys/actions'
import { resolveEscape } from '@/hotkeys/escStack'
import { mapScope, useModelStore } from '@/stores/model'
import { paintCells } from '@/core/ops/rooms'
import { createFromBox } from '@/core/ops/doors'
import { createLine, placeIcon } from '@/core/ops/markup'
import { ok } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { IconId, LineId, MapId, RoomId, TransitionId } from '@/core/ids'
import type { CellKey } from '@/core/cell'

// Select mode's Cells granularity, as a matrix: one `describe` per target under
// the pointer, one `it` per gesture, plus the rules that cut across the table.
//
// The Cells table is its own table, not the Rooms table filtered. Only cells are
// reachable here: a room, transition, icon and line are all unselectable, so a
// press over an icon or a door resolves to the cell it stands on.
//
// Drag and Delete have no Cells column yet, so this covers Click, Shift-click
// and the whole-tab select key.

describe('Cell-select precedence table', () => {
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

  // Shift is read at press time, so it rides on `pointerdown` and `pointerup`
  // alike.
  async function shiftClick(viewport: HTMLElement, point: PointerEventInit) {
    await click(viewport, { ...point, shiftKey: true })
  }

  // Select mode opens in the Rooms granularity, so every test states the one it
  // is about.
  async function granularity(subMode: 'rooms' | 'cells') {
    useToolsStore().setSelectSubMode(subMode)
    await nextTick()
  }

  const selection = () => useSelectionStore()

  function undoLabel() {
    return useModelStore().status.undoLabel
  }

  function cellRefs(keys: CellKey[]) {
    return keys.map((id) => ({ kind: 'cell', id }))
  }

  // One map carrying every target the table names.
  //
  //   row 0  room A (0,0)(1,0)(2,0), icon on (0,0)
  //   row 1  room B (0,1)(1,1)(2,1)(3,1), line M over (2,1)(3,1)
  //          door on the shared edge between (1,0) and (1,1)
  //   row 5  line L across (0,5)(1,5)(2,5), owned by no room
  //
  // Seven owned cells in total, which is what the whole-tab select must produce.
  function fixture() {
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    let roomA!: RoomId
    let roomB!: RoomId
    let icon!: IconId
    let door!: TransitionId
    let roomLine!: LineId
    let gridLine!: LineId

    model.run('Setup', mapScope(mapId), (tx) => {
      const project = model.project
      const map = project.mapsById.get(mapId)!
      const paint = (cells: CellKey[]) =>
        paintCells(tx, project, map, cells, { areaId: WORLD_AREA_ID })
      const colors = { plateColor: '#111111', glyphColor: '#222222' }
      const style = { color: '#ffcc00', arrowStart: false, arrowEnd: false }

      roomA = paint(['0,0', '1,0', '2,0']).id
      roomB = paint(['0,1', '1,1', '2,1', '3,1']).id
      icon = ok(placeIcon(tx, map, '0,0', 'save', colors)).id
      door = ok(createFromBox(tx, project, map, '1,0', '1,1'))[0].id
      roomLine = ok(createLine(tx, map, ['2,1', '3,1'], style)).id
      gridLine = ok(createLine(tx, map, ['0,5', '1,5', '2,5'], style)).id
    })
    return { mapId, roomA, roomB, icon, door, roomLine, gridLine }
  }

  // Paints one more room on another tab, to prove the selectors answer per map.
  function paintOn(mapId: MapId, cells: CellKey[]) {
    const model = useModelStore()
    model.run('Setup', mapScope(mapId), (tx) => {
      const map = model.project.mapsById.get(mapId)!
      paintCells(tx, model.project, map, cells, { areaId: WORLD_AREA_ID })
    })
  }

  const OWNED_CELLS: CellKey[] = ['0,0', '0,1', '1,0', '1,1', '2,0', '2,1', '3,1']

  // The targets, at the points that resolve to them.
  const PLAIN_CELL = [2.5, 0.5] as const
  const ICON_CELL = [0.5, 0.5] as const
  const OTHER_ROOM_CELL = [0.5, 1.5] as const
  const LINE_OVER_ROOM = [2.5, 1.5] as const
  const LINE_OVER_GRID = [1.5, 5.5] as const
  const BARE_GRID = [9.5, 9.5] as const
  // The door sits on the wall at y = 1. These two points straddle it, each a
  // tenth of a cell from the wall and inside the cell on its own side.
  const DOOR_FROM_ABOVE = [1.5, 0.9] as const
  const DOOR_FROM_BELOW = [1.5, 1.1] as const

  // -------------------------------------------------------------------------
  // Row 1: a cell a room owns.
  // -------------------------------------------------------------------------
  describe('a cell in a room', () => {
    it('click: selects that cell', async () => {
      const { viewport } = await mountCanvas()
      const { mapId } = fixture()
      await granularity('cells')
      const before = undoLabel()

      await click(viewport, at(...PLAIN_CELL))

      expect(selection().selected).toEqual(cellRefs(['2,0']))
      expect(selection().cellsOn(mapId)).toEqual(['2,0'])
      // Selecting is not an edit.
      expect(undoLabel()).toBe(before)
    })

    it('click: replaces whatever was selected before', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      await granularity('cells')

      await click(viewport, at(...PLAIN_CELL))
      await click(viewport, at(...OTHER_ROOM_CELL))

      expect(selection().selected).toEqual(cellRefs(['0,1']))
    })

    it('click: takes the cell under an icon, not the icon', async () => {
      const { viewport } = await mountCanvas()
      const { mapId } = fixture()
      await granularity('cells')

      await click(viewport, at(...ICON_CELL))

      expect(selection().selected).toEqual(cellRefs(['0,0']))
      expect(selection().iconsOn(mapId)).toEqual([])
    })

    it('click: takes the cell on the pointer side of a door, not the door', async () => {
      const { viewport } = await mountCanvas()
      const { mapId } = fixture()
      await granularity('cells')

      await click(viewport, at(...DOOR_FROM_ABOVE))
      expect(selection().selected).toEqual(cellRefs(['1,0']))
      expect(selection().transitionsOn(mapId)).toEqual([])

      await click(viewport, at(...DOOR_FROM_BELOW))
      expect(selection().selected).toEqual(cellRefs(['1,1']))
      expect(selection().transitionsOn(mapId)).toEqual([])
    })

    it('click: takes the cell under a markup line, not the line', async () => {
      const { viewport } = await mountCanvas()
      const { mapId } = fixture()
      await granularity('cells')

      await click(viewport, at(...LINE_OVER_ROOM))

      expect(selection().selected).toEqual(cellRefs(['2,1']))
      expect(selection().linesOn(mapId)).toEqual([])
    })

    it('click: reaches cells and nothing else, wherever in a room it lands', async () => {
      const { viewport } = await mountCanvas()
      const { mapId } = fixture()
      await granularity('cells')

      for (const [x, y] of [PLAIN_CELL, ICON_CELL, LINE_OVER_ROOM, DOOR_FROM_ABOVE]) {
        await click(viewport, at(x, y))
        expect(selection().selected.map((ref) => ref.kind)).toEqual(['cell'])
        expect(selection().roomsOn(mapId)).toEqual([])
        expect(selection().soleRoomOn(mapId)).toBeNull()
      }
    })
  })

  // -------------------------------------------------------------------------
  // Row 2: empty space, which is any cell no room owns.
  // -------------------------------------------------------------------------
  describe('empty space', () => {
    it('click: deselects everything', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      await granularity('cells')
      await click(viewport, at(...PLAIN_CELL))
      expect(selection().isEmpty).toBe(false)

      await click(viewport, at(...BARE_GRID))

      expect(selection().isEmpty).toBe(true)
    })

    it('click: a cell a line crosses is empty space while no room owns it', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      await granularity('cells')
      await click(viewport, at(...PLAIN_CELL))

      await click(viewport, at(...LINE_OVER_GRID))

      expect(selection().isEmpty).toBe(true)
    })

    it('click: clears a multi-cell selection whole, not a cell at a time', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      await granularity('cells')
      await click(viewport, at(...PLAIN_CELL))
      await shiftClick(viewport, at(...OTHER_ROOM_CELL))
      expect(selection().selected).toHaveLength(2)

      await click(viewport, at(...BARE_GRID))

      expect(selection().isEmpty).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // The shift-click column.
  // -------------------------------------------------------------------------
  describe('shift-click', () => {
    it('adds a cell to the selection, in press order', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      await granularity('cells')

      await click(viewport, at(...PLAIN_CELL))
      await shiftClick(viewport, at(...ICON_CELL))
      await shiftClick(viewport, at(...LINE_OVER_ROOM))

      expect(selection().selected).toEqual(cellRefs(['2,0', '0,0', '2,1']))
    })

    it('removes a cell already in the selection', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      await granularity('cells')

      await click(viewport, at(...PLAIN_CELL))
      await shiftClick(viewport, at(...ICON_CELL))
      await shiftClick(viewport, at(...PLAIN_CELL))

      expect(selection().selected).toEqual(cellRefs(['0,0']))
    })

    // A stray shift-click on bare grid must not destroy the multi-selection it
    // is being used to build.
    it('leaves the selection alone when it finds nothing', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      await granularity('cells')

      await click(viewport, at(...PLAIN_CELL))
      await shiftClick(viewport, at(...BARE_GRID))
      await shiftClick(viewport, at(...LINE_OVER_GRID))

      expect(selection().selected).toEqual(cellRefs(['2,0']))
    })

    it('holds cells of two different rooms at once', async () => {
      const { viewport } = await mountCanvas()
      const { mapId } = fixture()
      await granularity('cells')

      await click(viewport, at(...PLAIN_CELL))
      await shiftClick(viewport, at(...OTHER_ROOM_CELL))

      expect(selection().cellsOn(mapId)).toEqual(['2,0', '0,1'])
      expect(selection().roomsOn(mapId)).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // The whole-tab select.
  // -------------------------------------------------------------------------
  describe('select all', () => {
    // The grid is unbounded, so "every cell" can only mean every owned cell.
    it('selects every cell a room on this tab owns, and no bare grid', async () => {
      await mountCanvas()
      const { mapId } = fixture()
      await granularity('cells')

      runAction('selectAll')

      expect([...selection().cellsOn(mapId)].sort()).toEqual(OWNED_CELLS)
      expect(selection().selected).toHaveLength(OWNED_CELLS.length)
    })

    it('replaces a cell selection rather than adding to it', async () => {
      const { viewport } = await mountCanvas()
      const { mapId } = fixture()
      await granularity('cells')
      await click(viewport, at(...PLAIN_CELL))

      runAction('selectAll')

      expect([...selection().cellsOn(mapId)].sort()).toEqual(OWNED_CELLS)
    })

    it('selects rooms instead while the granularity is Rooms', async () => {
      await mountCanvas()
      const { mapId, roomA, roomB } = fixture()
      await granularity('rooms')

      runAction('selectAll')

      expect([...selection().roomsOn(mapId)].sort()).toEqual([roomA, roomB].sort())
      expect(selection().cellsOn(mapId)).toEqual([])
    })

    it('does nothing in the modes that are not Select', async () => {
      await mountCanvas()
      const { mapId } = fixture()
      await granularity('cells')

      for (const mode of ['draw', 'door', 'markup'] as const) {
        useModeStore().setMode(mode)
        await nextTick()
        runAction('selectAll')
        expect(selection().isEmpty).toBe(true)
        expect(selection().cellsOn(mapId)).toEqual([])
      }
    })
  })

  // -------------------------------------------------------------------------
  // Clearing, by key and by granularity switch.
  // -------------------------------------------------------------------------
  describe('clearing the selection', () => {
    it('Esc clears a cell selection', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      await granularity('cells')
      await click(viewport, at(...PLAIN_CELL))

      expect(resolveEscape()).toBe(true)
      expect(selection().isEmpty).toBe(true)
    })

    it('the deselect action clears a cell selection', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      await granularity('cells')
      await click(viewport, at(...PLAIN_CELL))

      expect(runAction('deselect')).toBe(true)
      expect(selection().isEmpty).toBe(true)
    })

    // The two granularities hold different kinds, so a destructive key must
    // never point at something selected in the other one.
    it('switching granularity clears the selection', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      await granularity('cells')
      await click(viewport, at(...PLAIN_CELL))

      await granularity('rooms')

      expect(selection().isEmpty).toBe(true)
    })

    it('re-picking the granularity already in use keeps the selection', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      await granularity('cells')
      await click(viewport, at(...PLAIN_CELL))
      await shiftClick(viewport, at(...OTHER_ROOM_CELL))

      await granularity('cells')

      expect(selection().selected).toEqual(cellRefs(['2,0', '0,1']))
    })
  })

  // -------------------------------------------------------------------------
  // The rules that cut across the table.
  // -------------------------------------------------------------------------
  describe('cross-cutting rules', () => {
    // A cell key names a cell on every map there is, so an unguarded selector
    // would light up the wrong tab with the right-looking key.
    it('a cell selection answers only for the tab it was made on', async () => {
      const { viewport } = await mountCanvas()
      const { mapId } = fixture()
      await granularity('cells')
      await click(viewport, at(...PLAIN_CELL))

      const tabs = useTabsStore()
      tabs.addTab()
      await nextTick()
      const second = tabs.activeTabId
      paintOn(second, ['2,0'])
      await nextTick()

      expect(selection().cellsOn(second)).toEqual([])

      await click(viewport, at(...PLAIN_CELL))

      expect(selection().mapId).toBe(second)
      expect(selection().cellsOn(second)).toEqual(['2,0'])
      expect(selection().cellsOn(mapId)).toEqual([])
    })

    // The same press, one granularity apart: the Cells table reaches the cell
    // an icon stands on, the Rooms table reaches the icon.
    it('the Rooms granularity reads the same press as the icon', async () => {
      const { viewport } = await mountCanvas()
      const { icon } = fixture()
      await granularity('rooms')

      await click(viewport, at(...ICON_CELL))

      expect(selection().selected).toEqual([{ kind: 'icon', id: icon }])
    })
  })
})
