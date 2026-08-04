import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia, type FakeContext2D } from '@/test-setup'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import CanvasRegion from './CanvasRegion.vue'
import { useTabsStore } from '@/stores/tabs'
import { useToolsStore } from '@/stores/tools'
import { useModeStore } from '@/stores/mode'
import { useSelectionStore } from '@/stores/selection'
import { useCanvasViewStore } from '@/stores/canvasView'
import { mapScope, useModelStore } from '@/stores/model'
import { runAction } from '@/hotkeys/actions'
import { resolveEscape } from '@/hotkeys/escStack'
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

  // One move, so the press crosses the dead zone and leaves its origin cell in
  // a single step: a drag, by both halves of the rule at once.
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

    // The other two kinds through the same column, so the row really is one row
    // for four kinds rather than two that happen to have been tested.
    it('builds a selection across all four kinds', async () => {
      const { viewport } = await mountCanvas()
      const { roomA, door, icon, line } = fixture()

      await click(viewport, at(0.5, 0.5))
      await shiftClick(viewport, at(2, 0.5))
      await shiftClick(viewport, at(1.5, 2.5))
      await shiftClick(viewport, at(2.5, 4.5))

      expect(selection().selected).toEqual([
        { kind: 'room', id: roomA },
        { kind: 'transition', id: door },
        { kind: 'icon', id: icon },
        { kind: 'line', id: line },
      ])

      // And out again, from the middle of the list.
      await shiftClick(viewport, at(2, 0.5))
      expect(selection().selected).toEqual([
        { kind: 'room', id: roomA },
        { kind: 'icon', id: icon },
        { kind: 'line', id: line },
      ])
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

  // The Cells arm. Every press resolves to the cell it landed in, and the
  // objects standing on that cell are unreachable: the granularity is the
  // whole of what the toggle changes.
  describe('the Cells sub-mode', () => {
    it('selects the cell where Rooms selects the object on it', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      useToolsStore().setSelectSubMode('cells')

      await click(viewport, at(1.5, 2.5))
      expect(selection().selected).toEqual([{ kind: 'cell', id: '1,2' }])
    })

    // The icon on (1,2) and the door on the seam at x=2 are both topmost in
    // Rooms. Here neither is reachable, which is what makes this a different
    // table rather than the same one filtered.
    it('takes the cell under a door, where Rooms takes the door', async () => {
      const { viewport } = await mountCanvas()
      const { mapId, door } = fixture()
      const tools = useToolsStore()

      await click(viewport, at(2, 0.5))
      expect(selection().selected).toEqual([{ kind: 'transition', id: door }])

      tools.setSelectSubMode('cells')
      await click(viewport, at(2, 0.5))
      expect(selection().transitionsOn(mapId)).toEqual([])
      expect(selection().cellsOn(mapId)).toHaveLength(1)
    })

    it('adds and removes a cell on shift-click', async () => {
      const { viewport } = await mountCanvas()
      const { mapId } = fixture()
      useToolsStore().setSelectSubMode('cells')

      await click(viewport, at(0.5, 2.5))
      await shiftClick(viewport, at(1.5, 2.5))
      expect(selection().cellsOn(mapId)).toEqual(['0,2', '1,2'])

      await shiftClick(viewport, at(0.5, 2.5))
      expect(selection().cellsOn(mapId)).toEqual(['1,2'])
    })

    // Cells of two different rooms in one selection, which is the ordinary
    // case: what was swept is a region, and which room owns each cell of it is
    // not the selection's business.
    it('builds a selection spanning two rooms', async () => {
      const { viewport } = await mountCanvas()
      const { mapId } = fixture()
      useToolsStore().setSelectSubMode('cells')

      await click(viewport, at(1.5, 0.5))
      await shiftClick(viewport, at(2.5, 0.5))
      expect(selection().cellsOn(mapId)).toEqual(['1,0', '2,0'])
    })

    // The same rule bare grid follows in Rooms, and for the same reason: a
    // stray shift-click must not destroy the selection it is building.
    it('leaves the selection alone on a shift-click off any room', async () => {
      const { viewport } = await mountCanvas()
      const { mapId } = fixture()
      useToolsStore().setSelectSubMode('cells')

      await click(viewport, at(0.5, 2.5))
      await shiftClick(viewport, at(9.5, 9.5))
      expect(selection().cellsOn(mapId)).toEqual(['0,2'])
    })

    // The Drag column. A band from bare grid takes the owned cells it covers,
    // where the same drag one granularity over takes whole rooms.
    it('marquees cells on a drag over the grid, and no bare grid with them', async () => {
      const { viewport } = await mountCanvas()
      const { mapId } = fixture()
      useToolsStore().setSelectSubMode('cells')

      // Sixteen cells swept, seven of them owned.
      await drag(viewport, at(3.5, 3.5), at(0.5, 0.5))

      expect([...selection().cellsOn(mapId)].sort()).toEqual([
        '0,0',
        '0,2',
        '1,0',
        '1,2',
        '2,0',
        '2,2',
        '3,0',
      ])
      expect(selection().roomsOn(mapId)).toEqual([])
    })

    // A drag from an unselected cell bands rather than moving, which looks
    // wrong from the Rooms table's side and is not: sweeping out from inside a
    // room is how a cell selection gets built, so the fragment move stays
    // reserved for cells that are already selected.
    it('marquees from an unselected cell rather than moving it', async () => {
      const { viewport } = await mountCanvas()
      const { mapId, roomC } = fixture()
      useToolsStore().setSelectSubMode('cells')

      await drag(viewport, at(0.5, 2.5), at(1.5, 2.5))

      expect([...selection().cellsOn(mapId)].sort()).toEqual(['0,2', '1,2'])
      // The band selected; it moved nothing.
      expect([...map().rooms.get(roomC)!.cells].sort()).toEqual(['0,2', '1,2', '2,2'])
    })

    // The other half of the same row: a drag from a cell already selected moves
    // the fragment instead of banding, and what lands is what is selected.
    it('moves the fragment from a cell that is already selected', async () => {
      const { viewport } = await mountCanvas()
      const { mapId, roomC } = fixture()
      useToolsStore().setSelectSubMode('cells')

      await click(viewport, at(0.5, 2.5))
      await drag(viewport, at(0.5, 2.5), at(0.5, 5.5))

      expect(selection().cellsOn(mapId)).toEqual(['0,5'])
      // Out of the room it came from, and into a room of its own.
      expect([...map().rooms.get(roomC)!.cells].sort()).toEqual(['1,2', '2,2'])
      expect(map().cellOwner.get('0,5')).not.toBe(roomC)
    })

    // A cell ref names a position, so the move invalidates the refs it is
    // moving: mid-drag the selection still names cells the fragment has left,
    // which are bare grid by then. A tint there would mark ground nothing is
    // on. The ghost draws the fragment where it actually is instead.
    it('stops marking the cells the fragment came from, while it is in flight', async () => {
      const { wrapper, viewport } = await mountCanvas()
      fixture()
      useToolsStore().setSelectSubMode('cells')
      await click(viewport, at(0.5, 2.5))

      const canvas = wrapper.get('.canvas').element as HTMLCanvasElement
      const ctx = canvas.getContext('2d') as unknown as FakeContext2D
      // The source cell's own rect, from the same mapping the presses use. The
      // only thing that fills it once the fragment has lifted off is the
      // selection tint: no room owns it, so there is no room fill either.
      const corner = at(0, 2)
      const size = useModelStore().tileSize
      const sourceRect = [corner.clientX, corner.clientY, size, size].join(',')
      ctx.fillRect.mockClear()

      viewport.dispatchEvent(press('pointerdown', at(0.5, 2.5)))
      viewport.dispatchEvent(press('pointermove', at(0.5, 5.5)))
      await nextTick()

      expect(ctx.fillRect.mock.calls.map((call) => call.join(','))).not.toContain(sourceRect)
      viewport.dispatchEvent(press('pointerup', at(0.5, 5.5)))
      await nextTick()
    })

    it('unions with the selection when the band is dragged with shift', async () => {
      const { viewport } = await mountCanvas()
      const { mapId } = fixture()
      useToolsStore().setSelectSubMode('cells')

      await click(viewport, at(3.5, 0.5))
      await drag(viewport, at(0.5, 2.5), at(1.5, 2.5), true)

      expect(selection().cellsOn(mapId)).toEqual(['3,0', '0,2', '1,2'])
    })

    // Two granularities, one key. Erasing cells is a different op on a
    // different kind, so this arm answers for nothing yet rather than deleting
    // the room the selected cells belong to.
    it('deletes nothing on Del, where Rooms would delete the room', async () => {
      const { viewport } = await mountCanvas()
      const { mapId, roomC } = fixture()
      const tools = useToolsStore()

      tools.setSelectSubMode('cells')
      await click(viewport, at(0.5, 2.5))
      expect(selection().selected).toEqual([{ kind: 'cell', id: '0,2' }])
      runAction('deleteSelection')
      expect(map().rooms.has(roomC)).toBe(true)

      // The same key on the same pixel, one sub-mode over.
      tools.setSelectSubMode('rooms')
      await click(viewport, at(0.5, 2.5))
      runAction('deleteSelection')
      expect(map().rooms.has(roomC)).toBe(false)
      expect(selection().roomsOn(mapId)).toEqual([])
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

  // The Drag column's Object rows. What each kind moves by is the gesture's own
  // suite; what this pins is which press reaches it and what the selection
  // looks like when it does.
  describe('dragging an object', () => {
    function roomCells(id: RoomId) {
      return [...map().rooms.get(id)!.cells].sort()
    }

    it('moves a selected room, and the press stays out of the click column', async () => {
      const { viewport } = await mountCanvas()
      const { roomA } = fixture()

      await click(viewport, at(0.5, 0.5))
      await drag(viewport, at(0.5, 0.5), at(0.5, 1.5))

      expect(roomCells(roomA)).toEqual(['0,1', '1,1'])
      expect(selection().selected).toEqual([{ kind: 'room', id: roomA }])
    })

    // The half that is new here: what moves is what was pointed at, so an
    // unselected object is selected first rather than dragging the selection
    // that happens to be live somewhere else.
    it('selects an unselected room before moving it, dropping what was selected', async () => {
      const { viewport } = await mountCanvas()
      const { roomA, roomC } = fixture()

      await click(viewport, at(0.5, 2.5))
      await drag(viewport, at(0.5, 0.5), at(0.5, 1.5))

      expect(selection().selected).toEqual([{ kind: 'room', id: roomA }])
      expect(roomCells(roomA)).toEqual(['0,1', '1,1'])
      // The room that was selected stayed exactly where it was.
      expect(roomCells(roomC)).toEqual(['0,2', '1,2', '2,2'])
    })

    it('adds an unselected room to the selection on a shift-drag, and moves both', async () => {
      const { viewport } = await mountCanvas()
      const { roomA, roomC } = fixture()

      await click(viewport, at(0.5, 2.5))
      viewport.dispatchEvent(press('pointerdown', { ...at(0.5, 0.5), shiftKey: true }))
      viewport.dispatchEvent(press('pointermove', at(0.5, 1.5)))
      viewport.dispatchEvent(press('pointerup', at(0.5, 1.5)))
      await nextTick()
      await nextTick()

      expect(selection().selected).toEqual([
        { kind: 'room', id: roomC },
        { kind: 'room', id: roomA },
      ])
      expect(roomCells(roomA)).toEqual(['0,1', '1,1'])
      expect(roomCells(roomC)).toEqual(['0,3', '1,3', '2,3'])
    })

    // The documented dead cell. Tested with a drag rather than a click, because
    // a click cannot pin "this does nothing": the gesture at zero delta does
    // nothing anyway.
    it('selects a transition on a drag and moves nothing', async () => {
      const { viewport } = await mountCanvas()
      const { door } = fixture()
      const before = useModelStore().status.undoLabel

      await drag(viewport, at(2, 0.5), at(2, 3.5))

      expect(selection().selected).toEqual([{ kind: 'transition', id: door }])
      expect(map().transitions.has(door)).toBe(true)
      expect(useModelStore().status.undoLabel).toBe(before)
    })

    // The other two movable kinds. Each has its own op, and the Drag column is
    // one row for all of them, so a press on any of the three has to reach it.
    it('moves an icon, by the same press that moves a room', async () => {
      const { viewport } = await mountCanvas()
      const { icon } = fixture()

      await drag(viewport, at(1.5, 2.5), at(2.5, 2.5))

      expect(map().icons.get(icon)!.cell).toBe('2,2')
      expect(selection().selected).toEqual([{ kind: 'icon', id: icon }])
    })

    it('translates a line by the same press', async () => {
      const { viewport } = await mountCanvas()
      const { line } = fixture()

      await drag(viewport, at(2.5, 4.5), at(2.5, 5.5))

      expect(map().lines.get(line)!.points).toEqual(['0,5', '1,5', '2,5', '3,5', '4,5'])
    })

    it('leaves no undo step when the drag comes back to the cell it started on', async () => {
      const { viewport } = await mountCanvas()
      const { roomA } = fixture()
      const before = useModelStore().status.undoLabel

      await click(viewport, at(0.5, 0.5))
      viewport.dispatchEvent(press('pointerdown', at(0.5, 0.5)))
      viewport.dispatchEvent(press('pointermove', at(3.5, 3.5)))
      viewport.dispatchEvent(press('pointermove', at(0.5, 0.5)))
      viewport.dispatchEvent(press('pointerup', at(0.5, 0.5)))
      await nextTick()

      expect(roomCells(roomA)).toEqual(['0,0', '1,0'])
      expect(useModelStore().status.undoLabel).toBe(before)
    })

    it('puts the room back on Esc mid-drag', async () => {
      const { viewport } = await mountCanvas()
      const { roomA } = fixture()

      await click(viewport, at(0.5, 0.5))
      viewport.dispatchEvent(press('pointerdown', at(0.5, 0.5)))
      viewport.dispatchEvent(press('pointermove', at(0.5, 1.5)))
      expect(resolveEscape()).toBe(true)
      viewport.dispatchEvent(press('pointerup', at(0.5, 1.5)))
      await nextTick()

      expect(roomCells(roomA)).toEqual(['0,0', '1,0'])
    })
  })

  // The Drag column of the empty row.
  describe('a marquee', () => {
    it('selects every room it touches, and none of the markup under it', async () => {
      const { viewport } = await mountCanvas()
      const { mapId, roomA, roomC } = fixture()

      // From bare grid past row 4, so the band covers the line and the icon as
      // well as all three rooms.
      await drag(viewport, at(5.5, 5.5), at(0.5, 0.5))

      expect(selection().roomsOn(mapId)).toEqual(expect.arrayContaining([roomA, roomC]))
      expect(selection().selected).toHaveLength(3)
    })

    it('unions with the selection when shift is held', async () => {
      const { viewport } = await mountCanvas()
      const { roomA, icon } = fixture()

      await click(viewport, at(1.5, 2.5))
      // From the bare row between the two banks of rooms, up over room A alone.
      await drag(viewport, at(1.5, 1.5), at(0.5, 0.5), true)

      expect(selection().selected).toEqual([
        { kind: 'icon', id: icon },
        { kind: 'room', id: roomA },
      ])
    })

    // Out and back is a drag that swept nothing, not a click: it lands on the
    // origin cell, which is bare grid, so it selects nothing. A plain marquee
    // replaces, so that clears.
    it('clears the selection when the drag returns to where it started', async () => {
      const { viewport } = await mountCanvas()
      fixture()

      await click(viewport, at(0.5, 0.5))
      viewport.dispatchEvent(press('pointerdown', at(9.5, 9.5)))
      viewport.dispatchEvent(press('pointermove', at(0.5, 0.5)))
      viewport.dispatchEvent(press('pointermove', at(9.5, 9.5)))
      viewport.dispatchEvent(press('pointerup', at(9.5, 9.5)))
      await nextTick()

      expect(selection().isEmpty).toBe(true)
    })

    // `Esc` ends the press, not just the band. The release that follows must
    // not fall through to the click on bare grid, which would deselect exactly
    // what the abort was protecting.
    it('abandons the band on Esc and keeps the selection, release included', async () => {
      const { viewport } = await mountCanvas()
      const { roomA } = fixture()

      await click(viewport, at(0.5, 0.5))
      viewport.dispatchEvent(press('pointerdown', at(9.5, 9.5)))
      viewport.dispatchEvent(press('pointermove', at(5.5, 5.5)))
      expect(resolveEscape()).toBe(true)
      viewport.dispatchEvent(press('pointerup', at(5.5, 5.5)))
      await nextTick()

      expect(selection().selected).toEqual([{ kind: 'room', id: roomA }])
    })
  })

  // The `Del` column, which is one op per kind and one transaction for the mix.
  describe('Del', () => {
    it('deletes whichever kind is selected', async () => {
      const { viewport } = await mountCanvas()
      const { roomA, door, icon, line } = fixture()

      await click(viewport, at(2, 0.5))
      runAction('deleteSelection')
      expect(map().transitions.has(door)).toBe(false)

      await click(viewport, at(1.5, 2.5))
      runAction('deleteSelection')
      expect(map().icons.has(icon)).toBe(false)

      await click(viewport, at(2.5, 4.5))
      runAction('deleteSelection')
      expect(map().lines.has(line)).toBe(false)

      await click(viewport, at(0.5, 0.5))
      runAction('deleteSelection')
      expect(map().rooms.has(roomA)).toBe(false)
    })

    it('deletes a mixed selection in one step', async () => {
      const { viewport } = await mountCanvas()
      const model = useModelStore()
      const { roomA, icon, line } = fixture()

      await click(viewport, at(0.5, 0.5))
      await shiftClick(viewport, at(1.5, 2.5))
      await shiftClick(viewport, at(2.5, 4.5))
      runAction('deleteSelection')

      expect(map().rooms.has(roomA)).toBe(false)
      expect(map().icons.has(icon)).toBe(false)
      expect(map().lines.has(line)).toBe(false)
      expect(model.status.undoLabel).toBe('Delete Selection')

      // One step for three kinds: a single undo brings all of them back.
      model.undo()
      expect(map().rooms.has(roomA)).toBe(true)
      expect(map().icons.has(icon)).toBe(true)
      expect(map().lines.has(line)).toBe(true)
    })

    // The dead cell of the column: nothing selected, nothing to delete, and no
    // undo step for a key that did nothing.
    it('does nothing with an empty selection', async () => {
      await mountCanvas()
      const model = useModelStore()
      fixture()
      const before = model.status.undoLabel

      runAction('deleteSelection')

      expect(model.status.undoLabel).toBe(before)
      expect(map().rooms.size).toBe(3)
    })

    // Deleting a room cascades to the transitions on its edges and the icons in
    // its cells, so a selection naming both a room and something it carries
    // must not trip over ids the cascade already swept up.
    it('deletes a room and the icon standing on it together', async () => {
      const { viewport } = await mountCanvas()
      const { roomC, icon } = fixture()

      await click(viewport, at(1.5, 2.5))
      await shiftClick(viewport, at(0.5, 2.5))
      expect(selection().selected).toHaveLength(2)
      runAction('deleteSelection')

      expect(map().rooms.has(roomC)).toBe(false)
      expect(map().icons.has(icon)).toBe(false)
    })
  })

  // Cuts across every row.
  describe('every target', () => {
    // The one mode where the secondary button does not erase. It aims the
    // context menu instead, which means selecting what it landed on.
    it('selects rather than deleting on a right-click, unlike the other three modes', async () => {
      const { viewport } = await mountCanvas()
      const { icon } = fixture()

      await click(viewport, at(1.5, 2.5), 2)

      expect(map().icons.has(icon)).toBe(true)
      expect(selection().selected).toEqual([{ kind: 'icon', id: icon }])
      expect(useModelStore().status.undoLabel).not.toContain('Delete')
    })

    // The drag rule, applied to the other button: what the menu acts on is what
    // was pointed at. A multi-selection survives a right-click on any of its
    // members, or the menu would offer to delete one room where the user can
    // see three haloed.
    it('leaves a multi-selection alone when the right-click lands inside it', async () => {
      const { viewport } = await mountCanvas()
      const { roomA, icon } = fixture()

      await click(viewport, at(0.5, 0.5))
      await shiftClick(viewport, at(1.5, 2.5))
      await click(viewport, at(0.5, 0.5), 2)

      expect(selection().selected).toEqual([
        { kind: 'room', id: roomA },
        { kind: 'icon', id: icon },
      ])
    })

    // Bare grid is not a target, and the menu's four verbs are all about the
    // selection: clearing it on the way to opening the menu would leave every
    // item disabled.
    it('leaves the selection alone on a right-click over bare grid', async () => {
      const { viewport } = await mountCanvas()
      const { roomA } = fixture()

      await click(viewport, at(0.5, 0.5))
      await click(viewport, at(9.5, 9.5), 2)

      expect(selection().selected).toEqual([{ kind: 'room', id: roomA }])
    })

    // A press that wandered is a drag and not also a click. Shift is what makes
    // that visible: the click column would toggle the dragged object straight
    // back out of the selection it is being moved with.
    it('does not fire the click column as well when the press leaves its cell', async () => {
      const { viewport } = await mountCanvas()
      const { roomA } = fixture()

      await click(viewport, at(0.5, 0.5))
      viewport.dispatchEvent(press('pointerdown', { ...at(0.5, 0.5), shiftKey: true }))
      viewport.dispatchEvent(press('pointermove', at(0.5, 1.5)))
      viewport.dispatchEvent(press('pointerup', at(0.5, 1.5)))
      await nextTick()
      await nextTick()

      expect(selection().selected).toEqual([{ kind: 'room', id: roomA }])
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

  // The keys that edit the selection without a pointer. `Ctrl+A` belongs to
  // this mode alone; `Deselect` and `Esc` belong to the selection, which every
  // mode shares.
  describe('the selection keys', () => {
    it('selects every room on the tab and nothing else that is on it', async () => {
      await mountCanvas()
      const { mapId, roomA, roomC } = fixture()

      runAction('selectAll')

      expect(selection().roomsOn(mapId)).toEqual(expect.arrayContaining([roomA, roomC]))
      expect(selection().roomsOn(mapId)).toHaveLength(3)
      // The door, the icon and the line are all inside the rectangle a marquee
      // over this map would cover, and none of them is selected: `Ctrl+A` means
      // every room, not everything.
      expect(selection().selected).toHaveLength(3)
    })

    it('selects the rooms of the tab it is pressed on, not the other tabs', async () => {
      await mountCanvas()
      const { mapId } = fixture()
      const tabs = useTabsStore()
      const model = useModelStore()

      tabs.addTab()
      const other = tabs.activeTabId
      model.run('Setup', mapScope(other), (tx) => {
        const map = model.project.mapsById.get(other)!
        paintCells(tx, model.project, map, ['0,0'], { areaId: WORLD_AREA_ID })
      })
      await nextTick()

      runAction('selectAll')

      expect(selection().roomsOn(other)).toHaveLength(1)
      expect(selection().roomsOn(mapId)).toEqual([])
    })

    it('does nothing in the three modes that are not Select', async () => {
      const { viewport } = await mountCanvas()
      const { roomA } = fixture()

      await click(viewport, at(0.5, 0.5))
      for (const mode of ['draw', 'door', 'markup'] as const) {
        useModeStore().setMode(mode)
        await nextTick()
        runAction('selectAll')
        expect(selection().selected).toEqual([{ kind: 'room', id: roomA }])
      }
    })

    // The two sub-modes hold different things, so a whole-tab select in Cells
    // is a list of cells. Selecting the rooms instead would put a selection in
    // the store that no press in this sub-mode could have made.
    //
    // Owned cells only. The grid is unbounded, so "every cell" is not a list,
    // and the line on row 4 sits on cells no room owns.
    it('selects every owned cell in the Cells sub-mode, and no bare grid', async () => {
      await mountCanvas()
      const { mapId } = fixture()
      useToolsStore().setSelectSubMode('cells')

      runAction('selectAll')

      expect([...selection().cellsOn(mapId)].sort()).toEqual([
        '0,0',
        '0,2',
        '1,0',
        '1,2',
        '2,0',
        '2,2',
        '3,0',
      ])
      expect(selection().roomsOn(mapId)).toEqual([])
    })

    it('clears the selection on Deselect, whatever the mode', async () => {
      const { viewport } = await mountCanvas()
      fixture()

      await click(viewport, at(0.5, 0.5))
      useModeStore().setMode('draw')
      await nextTick()

      expect(runAction('deselect')).toBe(true)
      expect(selection().isEmpty).toBe(true)
    })

    // `Esc` needs no new wiring: the selection tier already holds it. What has
    // to stay true is that a multi-selection clears in one press rather than
    // peeling off one object at a time.
    it('clears a whole multi-selection on Esc, in one press', async () => {
      const { viewport } = await mountCanvas()
      fixture()

      runAction('selectAll')
      await shiftClick(viewport, at(2.5, 4.5))
      expect(selection().selected).toHaveLength(4)

      expect(resolveEscape()).toBe(true)
      expect(selection().isEmpty).toBe(true)
    })
  })
})
