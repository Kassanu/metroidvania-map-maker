import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import CanvasRegion from './CanvasRegion.vue'
import { useTabsStore } from '@/stores/tabs'
import { useToolsStore } from '@/stores/tools'
import { useModeStore } from '@/stores/mode'
import { useArmedIconStore } from '@/stores/armedIcon'
import { useMarkupDefaultsStore } from '@/stores/markupDefaults'
import { useSelectionStore } from '@/stores/selection'
import { runAction } from '@/hotkeys/actions'
import { resolveEscape } from '@/hotkeys/escStack'
import { mapScope, useModelStore } from '@/stores/model'
import { paintCells } from '@/core/ops/rooms'
import { createLine, placeIcon } from '@/core/ops/markup'
import { WORLD_AREA_ID } from '@/core/ids'
import type { IconId, LineId } from '@/core/ids'

// Markup mode's press behaviour, as a matrix: one `describe` per target under
// the pointer, one `it` per gesture (click, drag, erase), plus the rules that
// cut across every target.
//
// Deliberately overlapping the gesture-level suites rather than replacing them.
// `lineStroke.test.ts`, `iconDrag.test.ts`, `linePeel.test.ts` and
// `CanvasRegion.test.ts` cover the mechanism (ghosting, undo granularity,
// interpolation); these cover which gesture a press resolves to.
//
// Every cell of the table is implemented. The Click column's "select" rows were
// found unbuilt by the first run of this sweep, which is what the sweep is for.

describe('Markup precedence table', () => {
  let mounted: ReturnType<typeof mount> | null = null

  beforeEach(() => {
    setActivePinia(createTestPinia())
    useModeStore().setMode('markup')
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
    // The mode watcher flushes on the microtask queue, so a press dispatched in
    // the same tick would land before the mode's own hover update.
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

  // The additive half of the selection policy. Shift is read at press time, so
  // it rides on `pointerdown` and `pointerup` alike.
  async function shiftClick(viewport: HTMLElement, point: PointerEventInit) {
    await click(viewport, { ...point, shiftKey: true })
  }

  // Two cells of travel, which clears both halves of the click-vs-drag rule and
  // is long enough that a line drawn from here has more than one segment.
  async function drag(
    viewport: HTMLElement,
    from: PointerEventInit,
    to: PointerEventInit,
    button = 0,
  ) {
    viewport.dispatchEvent(press('pointerdown', { ...from, button }))
    viewport.dispatchEvent(press('pointermove', { ...to, button }))
    viewport.dispatchEvent(press('pointerup', { ...to, button }))
    await nextTick()
    await nextTick()
  }

  // The erase column through the route every pointer has. The other two (the
  // stylus eraser end and the toolbar toggle) are `strokeAction`'s to prove;
  // what matters here is that the column exists per target.
  const erase = (viewport: HTMLElement, point: PointerEventInit) => click(viewport, point, 2)
  const erasedrag = (viewport: HTMLElement, from: PointerEventInit, to: PointerEventInit) =>
    drag(viewport, from, to, 2)

  function map() {
    return useModelStore().project.mapsById.get(useTabsStore().activeTabId)!
  }

  function undoLabel() {
    return useModelStore().status.undoLabel
  }

  function lines() {
    return [...map().lines.values()]
  }

  function icons() {
    return [...map().icons.values()]
  }

  const selection = () => useSelectionStore()

  function pickerIsOpen() {
    return document.querySelector('.icon-picker-popover')?.getAttribute('data-state') === 'open'
  }

  // One map carrying every target the matrix names, in separate rows so no
  // press is ambiguous about which one it lands on.
  //
  //   row 0  room A (0,0)(1,0)(2,0)                     an empty room cell
  //   row 2  room B (0,2)(1,2)(2,2), icon on (1,2)      a cell with an icon
  //   row 4  line L across (0,4)..(4,4), no room        a body and two endpoints
  //   row 6  room C (0,6)(1,6)(2,6), line M across it,
  //          icon on (1,6)                              an icon and a line, one cell
  //
  // Row 4's line is five cells so its middle is two clear cells from either
  // endpoint, well outside the endpoint radius.
  function fixture() {
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    let icon!: IconId
    let sharedIcon!: IconId
    let line!: LineId
    let shared!: LineId

    model.run('Setup', mapScope(mapId), (tx) => {
      const project = model.project
      const m = project.mapsById.get(mapId)!
      const paint = (cells: string[]) =>
        paintCells(tx, project, m, cells, { areaId: WORLD_AREA_ID })
      const colors = { plateColor: '#111111', glyphColor: '#222222' }
      const style = { color: '#ffcc00', arrowStart: false, arrowEnd: false }

      paint(['0,0', '1,0', '2,0'])

      paint(['0,2', '1,2', '2,2'])
      icon = (placeIcon(tx, m, '1,2', 'save', colors) as { id: IconId }).id

      line = (createLine(tx, m, ['0,4', '1,4', '2,4', '3,4', '4,4'], style) as { id: LineId }).id

      paint(['0,6', '1,6', '2,6'])
      shared = (createLine(tx, m, ['0,6', '1,6', '2,6'], style) as { id: LineId }).id
      sharedIcon = (placeIcon(tx, m, '1,6', 'missile', colors) as { id: IconId }).id
    })
    return { mapId, icon, sharedIcon, line, shared }
  }

  // The six targets, at the points that resolve to them. Named rather than
  // inlined, because every test below has to be pointing at the row it claims.
  const EMPTY_ROOM_CELL = [1.5, 0.5] as const
  const ICON_CELL = [1.5, 2.5] as const
  const LINE_BODY = [2.5, 4.5] as const
  const LINE_ENDPOINT = [4.5, 4.5] as const
  const ICON_AND_LINE = [1.5, 6.5] as const
  const BARE_GRID = [9.5, 9.5] as const

  // -------------------------------------------------------------------------
  // Row 1: empty room cell. The only row whose click column is implemented.
  // -------------------------------------------------------------------------
  describe('empty room cell', () => {
    it('click: opens the icon picker', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      const before = undoLabel()

      await click(viewport, at(...EMPTY_ROOM_CELL))

      expect(pickerIsOpen()).toBe(true)
      // Opening the picker is not an edit: nothing is placed until a pick.
      expect(undoLabel()).toBe(before)
    })

    it('drag: draws a new line', async () => {
      const { viewport } = await mountCanvas()
      const { line, shared } = fixture()

      await drag(viewport, at(...EMPTY_ROOM_CELL), at(1.5, 1.5))

      expect(lines()).toHaveLength(3)
      const drawn = lines().find((each) => each.id !== line && each.id !== shared)!
      expect(drawn.points).toEqual(['1,0', '1,1'])
      expect(undoLabel()).toBe('Draw Line')
    })

    it('erase: does nothing', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      const before = undoLabel()

      await erase(viewport, at(...EMPTY_ROOM_CELL))

      expect(undoLabel()).toBe(before)
      expect(lines()).toHaveLength(2)
      expect(icons()).toHaveLength(2)
    })
  })

  // -------------------------------------------------------------------------
  // Row 2: cell with an icon.
  // -------------------------------------------------------------------------
  describe('cell with an icon', () => {
    // Select beats create: the picker must not open over an occupied cell, or
    // it would offer to replace an icon the user meant to select.
    it('click: selects the icon, and does not open the picker', async () => {
      const { viewport } = await mountCanvas()
      const { icon } = fixture()
      const before = undoLabel()

      await click(viewport, at(...ICON_CELL))

      expect(selection().selected).toEqual([{ kind: 'icon', id: icon }])
      expect(pickerIsOpen()).toBe(false)
      // Selecting is not an edit.
      expect(undoLabel()).toBe(before)
    })

    // Unselected, deliberately: an icon fills its whole cell, so no other
    // gesture competes for it and requiring a select first would be a
    // regression. This is the one row that moves without being selected.
    it('drag: moves the icon, selected or not', async () => {
      const { viewport } = await mountCanvas()
      const { icon } = fixture()

      await drag(viewport, at(...ICON_CELL), at(2.5, 2.5))

      expect(selection().isEmpty).toBe(true)
      expect(map().icons.get(icon)!.cell).toBe('2,2')
      expect(undoLabel()).toBe('Move Icon')
    })

    it('erase: deletes the icon', async () => {
      const { viewport } = await mountCanvas()
      const { icon } = fixture()

      await erase(viewport, at(...ICON_CELL))

      expect(map().icons.has(icon)).toBe(false)
      expect(undoLabel()).toBe('Delete Icon')
    })
  })

  // -------------------------------------------------------------------------
  // Row 3: a line's body, away from both its ends.
  // -------------------------------------------------------------------------
  describe('line body (middle)', () => {
    it('click: selects the line, and opens no picker outside a room', async () => {
      const { viewport } = await mountCanvas()
      const { line } = fixture()

      await click(viewport, at(...LINE_BODY))

      expect(selection().selected).toEqual([{ kind: 'line', id: line }])
      expect(pickerIsOpen()).toBe(false)
    })

    // Lines may overlap, so an unselected body still draws: without this there
    // would be no way to start a line on top of one.
    it('drag: draws a new line while the line is not selected', async () => {
      const { viewport } = await mountCanvas()
      const { line } = fixture()

      await drag(viewport, at(...LINE_BODY), at(2.5, 2.5))

      expect(map().lines.get(line)!.points).toEqual(['0,4', '1,4', '2,4', '3,4', '4,4'])
      expect(lines()).toHaveLength(3)
      expect(undoLabel()).toBe('Draw Line')
    })

    it('drag: translates the line once it is selected', async () => {
      const { viewport } = await mountCanvas()
      const { line } = fixture()

      await click(viewport, at(...LINE_BODY))
      await drag(viewport, at(...LINE_BODY), at(2.5, 6.5))

      // Two cells down, every point, and no new line.
      expect(map().lines.get(line)!.points).toEqual(['0,6', '1,6', '2,6', '3,6', '4,6'])
      expect(lines()).toHaveLength(2)
      expect(undoLabel()).toBe('Move Line')
    })

    // The op guards the zero delta itself, so the gesture does not: guarding in
    // the gesture is what makes the op's own guard untestable.
    it('drag: out and back leaves no undo step', async () => {
      const { viewport } = await mountCanvas()
      const { line } = fixture()

      await click(viewport, at(...LINE_BODY))
      const before = undoLabel()

      const from = at(...LINE_BODY)
      viewport.dispatchEvent(press('pointerdown', from))
      viewport.dispatchEvent(press('pointermove', at(2.5, 6.5)))
      viewport.dispatchEvent(press('pointermove', from))
      viewport.dispatchEvent(press('pointerup', from))
      await nextTick()
      await nextTick()

      expect(map().lines.get(line)!.points).toEqual(['0,4', '1,4', '2,4', '3,4', '4,4'])
      expect(undoLabel()).toBe(before)
    })

    // Dispatch and cursor read the same row and the same selection.
    it('cursor: says move once the line is selected', async () => {
      const { wrapper, viewport } = await mountCanvas()
      fixture()
      const cursor = () =>
        (wrapper.get('.canvas-viewport').element as HTMLElement).style.cursor || null

      viewport.dispatchEvent(
        new PointerEvent('pointermove', { ...at(...LINE_BODY), bubbles: true }),
      )
      await nextTick()
      expect(cursor()).toBe('pointer')

      await click(viewport, at(...LINE_BODY))
      viewport.dispatchEvent(
        new PointerEvent('pointermove', { ...at(...LINE_BODY), bubbles: true }),
      )
      await nextTick()
      expect(cursor()).toBe('move')
    })

    it('erase: does nothing, because peel works only from an end', async () => {
      const { viewport } = await mountCanvas()
      const { line } = fixture()
      const before = undoLabel()

      // Dragged, not clicked: a peel of nothing is what a click does wherever it
      // lands, so only a drag tells an inert row from a gesture that went
      // nowhere.
      await erasedrag(viewport, at(...LINE_BODY), at(0.5, 4.5))

      expect(map().lines.get(line)!.points).toEqual(['0,4', '1,4', '2,4', '3,4', '4,4'])
      expect(undoLabel()).toBe(before)
    })
  })

  // -------------------------------------------------------------------------
  // Row 4: a line's endpoint.
  // -------------------------------------------------------------------------
  describe('line endpoint', () => {
    // The same line the body row selects: which end the pointer is near decides
    // what a drag does, never what is selected.
    it('click: selects the line, the same one its body does', async () => {
      const { viewport } = await mountCanvas()
      const { line } = fixture()

      await click(viewport, at(...LINE_ENDPOINT))
      expect(selection().selected).toEqual([{ kind: 'line', id: line }])

      await click(viewport, at(...LINE_BODY))
      expect(selection().selected).toEqual([{ kind: 'line', id: line }])
    })

    it('drag: extends the line from the end that was grabbed', async () => {
      const { viewport } = await mountCanvas()
      const { line } = fixture()

      await drag(viewport, at(...LINE_ENDPOINT), at(6.5, 4.5))

      expect(map().lines.get(line)!.points).toEqual([
        '0,4',
        '1,4',
        '2,4',
        '3,4',
        '4,4',
        '5,4',
        '6,4',
      ])
      expect(lines()).toHaveLength(2)
      expect(undoLabel()).toBe('Extend Line')
    })

    it('erase: peels from that end', async () => {
      const { viewport } = await mountCanvas()
      const { line } = fixture()

      await erasedrag(viewport, at(...LINE_ENDPOINT), at(2.5, 4.5))

      expect(map().lines.get(line)!.points).toEqual(['0,4', '1,4', '2,4'])
      expect(undoLabel()).toBe('Erase Line')
    })
  })

  // -------------------------------------------------------------------------
  // Row 5: an icon and a line in the same cell. Not a target of its own: it is
  // what the priority rule produces, and every column answers "the icon".
  // -------------------------------------------------------------------------
  describe('icon and line in the same cell', () => {
    it('click: selects the icon, not the line under it', async () => {
      const { viewport } = await mountCanvas()
      const { sharedIcon } = fixture()

      await click(viewport, at(...ICON_AND_LINE))

      expect(selection().selected).toEqual([{ kind: 'icon', id: sharedIcon }])
    })

    it('drag: moves the icon, leaving the line where it was', async () => {
      const { viewport } = await mountCanvas()
      const { sharedIcon, shared } = fixture()

      await drag(viewport, at(...ICON_AND_LINE), at(2.5, 6.5))

      expect(map().icons.get(sharedIcon)!.cell).toBe('2,6')
      expect(map().lines.get(shared)!.points).toEqual(['0,6', '1,6', '2,6'])
      expect(undoLabel()).toBe('Move Icon')
    })

    it('erase: deletes the icon, leaving the line', async () => {
      const { viewport } = await mountCanvas()
      const { sharedIcon, shared } = fixture()

      await erase(viewport, at(...ICON_AND_LINE))

      expect(map().icons.has(sharedIcon)).toBe(false)
      expect(map().lines.has(shared)).toBe(true)
      expect(undoLabel()).toBe('Delete Icon')
    })
  })

  // -------------------------------------------------------------------------
  // Row 6: bare grid. Unlike Door mode's empty row this is not inert: a line
  // may be drawn where no room is.
  // -------------------------------------------------------------------------
  describe('non-room empty cell', () => {
    it('click: opens no picker and deselects, since nothing is there', async () => {
      const { viewport } = await mountCanvas()
      const { icon } = fixture()
      await click(viewport, at(...ICON_CELL))
      expect(selection().isEmpty).toBe(false)
      expect(icon).toBeDefined()

      await click(viewport, at(...BARE_GRID))

      expect(pickerIsOpen()).toBe(false)
      expect(selection().isEmpty).toBe(true)
    })

    it('drag: draws a new line, because lines may live outside rooms', async () => {
      const { viewport } = await mountCanvas()
      fixture()

      await drag(viewport, at(...BARE_GRID), at(11.5, 9.5))

      expect(lines()).toHaveLength(3)
      expect(undoLabel()).toBe('Draw Line')
    })

    it('erase: does nothing', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      const before = undoLabel()

      await erasedrag(viewport, at(...BARE_GRID), at(11.5, 9.5))

      expect(undoLabel()).toBe(before)
      expect(lines()).toHaveLength(2)
    })
  })

  // -------------------------------------------------------------------------
  // The rules that cut across every row.
  // -------------------------------------------------------------------------
  describe('cross-cutting rules', () => {
    // Priority is icon → line-endpoint → line-body. The icon half is row 5;
    // this is the other half, and the only place the two line rows can be told
    // apart by behaviour: from an end a drag extends, from the body it draws.
    it('an endpoint outranks the body it also sits on', async () => {
      const { viewport } = await mountCanvas()
      const { line } = fixture()

      // The line's own end cell, which is body and endpoint at once.
      await drag(viewport, at(...LINE_ENDPOINT), at(5.5, 4.5))

      expect(lines()).toHaveLength(2)
      expect(map().lines.get(line)!.points).toHaveLength(6)
    })

    it('shift-click adds to the selection, and removes what is already in it', async () => {
      const { viewport } = await mountCanvas()
      const { icon, line, sharedIcon } = fixture()

      // The last press lands on a cell holding both an icon and a line, so it
      // also pins that shift-click resolves through the same precedence a plain
      // click does: icon beats line.
      await click(viewport, at(...ICON_CELL))
      await shiftClick(viewport, at(...LINE_BODY))
      await shiftClick(viewport, at(...ICON_AND_LINE))
      expect(selection().selected).toEqual([
        { kind: 'icon', id: icon },
        { kind: 'line', id: line },
        { kind: 'icon', id: sharedIcon },
      ])

      await shiftClick(viewport, at(...LINE_BODY))
      expect(selection().selected).toEqual([
        { kind: 'icon', id: icon },
        { kind: 'icon', id: sharedIcon },
      ])
    })

    // A shift-click only ever edits the selection. Both halves matter: a miss
    // must not clear what is being built, and the row's own create column must
    // not fire underneath it.
    it('a shift-click that finds nothing leaves the selection alone and opens no picker', async () => {
      const { viewport } = await mountCanvas()
      const { icon } = fixture()

      await click(viewport, at(...ICON_CELL))
      await shiftClick(viewport, at(...EMPTY_ROOM_CELL))
      await shiftClick(viewport, at(...BARE_GRID))

      expect(selection().selected).toEqual([{ kind: 'icon', id: icon }])
      expect(pickerIsOpen()).toBe(false)
    })

    it('the picker opens on an empty room cell and nowhere else', async () => {
      const { viewport } = await mountCanvas()
      fixture()

      for (const [x, y] of [ICON_CELL, LINE_BODY, LINE_ENDPOINT, ICON_AND_LINE, BARE_GRID]) {
        await click(viewport, at(x, y))
        expect(pickerIsOpen()).toBe(false)
      }

      await click(viewport, at(...EMPTY_ROOM_CELL))
      expect(pickerIsOpen()).toBe(true)
    })

    it('a drag draws a line unless it starts on an icon or a line end', async () => {
      const { viewport } = await mountCanvas()
      fixture()

      // The two rows that draw, and the two that do not.
      await drag(viewport, at(...EMPTY_ROOM_CELL), at(1.5, 1.5))
      await drag(viewport, at(...BARE_GRID), at(11.5, 9.5))
      expect(lines()).toHaveLength(4)

      await drag(viewport, at(...ICON_CELL), at(2.5, 2.5))
      await drag(viewport, at(...LINE_ENDPOINT), at(6.5, 4.5))
      expect(lines()).toHaveLength(4)
    })

    it('an icon needs a room and a line does not', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      useArmedIconStore().arm('save')
      await nextTick()

      await click(viewport, at(...BARE_GRID))
      expect(icons()).toHaveLength(2)

      await click(viewport, at(...EMPTY_ROOM_CELL))
      expect(icons()).toHaveLength(3)
      expect(map().iconAtCell.get('1,0')).toBeDefined()
    })

    // Lines may overlap freely, so a press where two cross has to choose. The
    // topmost wins, and topmost is the most recently drawn, which is the one
    // painted last: the hit and the paint read the collection the same way, so
    // a click can never select the line hidden under the one you aimed at.
    it('a press where two lines overlap takes the topmost', async () => {
      const { viewport } = await mountCanvas()
      const { line } = fixture()

      // Straight across the row-4 line, sharing its middle cell.
      await drag(viewport, at(2.5, 2.5), at(2.5, 6.5))
      const drawn = lines().find((each) => each.id !== line && each.points.includes('2,4'))!

      await click(viewport, at(...LINE_BODY))

      expect(selection().selected).toEqual([{ kind: 'line', id: drawn.id }])
    })

    it('an empty room cell both deselects and opens the picker', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      await click(viewport, at(...ICON_CELL))
      expect(selection().isEmpty).toBe(false)

      await click(viewport, at(...EMPTY_ROOM_CELL))

      // Not either/or: the picker is about the cell, the deselect about the
      // click having landed on nothing.
      expect(selection().isEmpty).toBe(true)
      expect(pickerIsOpen()).toBe(true)
    })

    // Editing an existing object requires disarming first, which is the locked
    // rule. A click that both placed and selected would be two acts at once.
    it('while armed, a click places and selects nothing', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      useArmedIconStore().arm('save')
      await nextTick()

      await click(viewport, at(...EMPTY_ROOM_CELL))
      expect(selection().isEmpty).toBe(true)

      // And a click on an existing icon is a refused placement, not a select.
      await click(viewport, at(...ICON_CELL))
      expect(selection().isEmpty).toBe(true)
    })

    it('Delete removes the selected object, named for what it was', async () => {
      const { viewport } = await mountCanvas()
      const { icon, line } = fixture()

      await click(viewport, at(...ICON_CELL))
      runAction('deleteSelection')
      expect(map().icons.has(icon)).toBe(false)
      expect(undoLabel()).toBe('Delete Icon')

      await click(viewport, at(...LINE_BODY))
      runAction('deleteSelection')
      expect(map().lines.has(line)).toBe(false)
      expect(undoLabel()).toBe('Delete Line')
    })

    // The only route that removes a whole line in one step: erase on a body
    // does nothing by design, so peeling is otherwise the only way.
    it('Delete is the one-step route to removing a whole line', async () => {
      const { viewport } = await mountCanvas()
      const { line } = fixture()

      await erasedrag(viewport, at(...LINE_BODY), at(0.5, 4.5))
      expect(map().lines.has(line)).toBe(true)

      await click(viewport, at(...LINE_BODY))
      runAction('deleteSelection')
      expect(map().lines.has(line)).toBe(false)
    })

    it('Delete names a mixed selection generically, and empties it in one step', async () => {
      const { viewport } = await mountCanvas()
      const { icon, line } = fixture()

      await click(viewport, at(...ICON_CELL))
      await shiftClick(viewport, at(...LINE_BODY))
      expect(selection().selected).toEqual([
        { kind: 'icon', id: icon },
        { kind: 'line', id: line },
      ])

      runAction('deleteSelection')

      expect(map().icons.has(icon)).toBe(false)
      expect(map().lines.has(line)).toBe(false)
      expect(undoLabel()).toBe('Delete Selection')

      // One transaction for the whole selection, not one per object.
      useModelStore().undo()
      expect(map().icons.has(icon)).toBe(true)
      expect(map().lines.has(line)).toBe(true)
    })

    it('Esc clears a markup selection', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      await click(viewport, at(...ICON_CELL))
      expect(selection().isEmpty).toBe(false)

      resolveEscape()
      expect(selection().isEmpty).toBe(true)
    })

    it('deleting a selected object empties the selection with it', async () => {
      const { viewport } = await mountCanvas()
      fixture()

      await click(viewport, at(...ICON_CELL))
      // Through the erase route rather than the key, so it is the store's
      // pruning being tested and not the key clearing up after itself.
      await erase(viewport, at(...ICON_CELL))

      expect(selection().isEmpty).toBe(true)
    })

    // The armed state replaces the click column for every row, so the picker
    // stays shut on the one row that would otherwise open it.
    it('while armed, a click places and the picker does not open', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      useArmedIconStore().arm('save')
      await nextTick()

      await click(viewport, at(...EMPTY_ROOM_CELL))

      expect(pickerIsOpen()).toBe(false)
      expect(map().iconAtCell.get('1,0')).toBeDefined()
      expect(undoLabel()).toBe('Place Icon')
      // Still armed: arming places several, and disarming is its own act.
      expect(useArmedIconStore().isArmed).toBe(true)
    })

    it('while armed, an occupied cell is refused until replace is on', async () => {
      const { viewport } = await mountCanvas()
      const { icon } = fixture()
      useArmedIconStore().arm('missile')
      await nextTick()

      await click(viewport, at(...ICON_CELL))
      expect(map().icons.get(icon)!.iconType).toBe('save')

      useMarkupDefaultsStore().setReplace(true)
      await click(viewport, at(...ICON_CELL))
      expect(map().icons.has(icon)).toBe(false)
      expect(map().icons.get(map().iconAtCell.get('1,2')!)!.iconType).toBe('missile')
    })

    // Erase outranks the armed state, because the toggle governs the whole
    // primary button: a placement here would be a press that added something
    // where the cursor said it would delete.
    it('erase outranks an armed icon', async () => {
      const { viewport } = await mountCanvas()
      const { icon } = fixture()
      useArmedIconStore().arm('missile')
      useToolsStore().toggleErase()
      await nextTick()

      await click(viewport, at(...ICON_CELL))

      expect(map().icons.has(icon)).toBe(false)
      expect(undoLabel()).toBe('Delete Icon')
    })

    // The erase toggle is the third route into the erase column and the only
    // one touch has, so the column has to be reachable without a right button.
    it('the erase toggle puts the primary button in the erase column', async () => {
      const { viewport } = await mountCanvas()
      const { line } = fixture()
      useToolsStore().toggleErase()
      await nextTick()

      await drag(viewport, at(...LINE_ENDPOINT), at(3.5, 4.5))

      expect(map().lines.get(line)!.points).toEqual(['0,4', '1,4', '2,4', '3,4'])
    })

    // And with the toggle on there is no create column at all.
    it('the erase toggle removes the create column entirely', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      useToolsStore().toggleErase()
      await nextTick()
      const before = undoLabel()

      await click(viewport, at(...EMPTY_ROOM_CELL))
      await drag(viewport, at(...EMPTY_ROOM_CELL), at(1.5, 1.5))

      expect(pickerIsOpen()).toBe(false)
      expect(lines()).toHaveLength(2)
      expect(undoLabel()).toBe(before)
    })

    // A drag out and back is still a drag, not a click, which is why the click
    // column cannot be a DOM `click` listener: the picker must not open on the
    // way back.
    //
    // Markup differs from Door here, and deliberately. A box drag out and back
    // classifies to nothing, so Door's equivalent commits nothing; a line
    // accumulates an ordered path, so doubling back appends the way back and
    // the drag really did draw something. What the two share is that neither
    // falls through into its click column.
    it('a drag out and back is a drag, not a tap', async () => {
      const { viewport } = await mountCanvas()
      const { line, shared } = fixture()

      viewport.dispatchEvent(press('pointerdown', at(...EMPTY_ROOM_CELL)))
      viewport.dispatchEvent(press('pointermove', at(1.5, 1.5)))
      viewport.dispatchEvent(press('pointermove', at(...EMPTY_ROOM_CELL)))
      viewport.dispatchEvent(press('pointerup', at(...EMPTY_ROOM_CELL)))
      await nextTick()
      await nextTick()

      expect(pickerIsOpen()).toBe(false)
      const drawn = lines().find((each) => each.id !== line && each.id !== shared)!
      expect(drawn.points).toEqual(['1,0', '1,1', '1,0'])
    })
  })
})
