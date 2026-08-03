import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount } from '@vue/test-utils'
import CanvasRegion from './CanvasRegion.vue'
import { useTabsStore } from '@/stores/tabs'
import { useToolsStore } from '@/stores/tools'
import { useModeStore } from '@/stores/mode'
import { useSelectionStore } from '@/stores/selection'
import { usePendingTeleportStore } from '@/stores/pendingTeleport'
import { runAction } from '@/hotkeys/actions'
import { mapScope, PROJECT_SCOPE, useModelStore } from '@/stores/model'
import { paintCells } from '@/core/ops/rooms'
import { createFromBox, createTeleport } from '@/core/ops/doors'
import { edgeOfCell } from '@/core/cell'
import { WORLD_AREA_ID } from '@/core/ids'
import type { MapId, TransitionId } from '@/core/ids'

// Door mode's press behaviour, as a matrix: one `describe` per target under the
// pointer, one `it` per gesture (click, drag, erase), plus the rules that cut
// across every target.
//
// Deliberately overlapping the gesture-level suites rather than replacing them.
// `boxDrag.test.ts`, `pendingTeleport.test.ts` and `CanvasRegion.test.ts` cover
// the mechanism (ghosting, undo granularity, pruning); these cover which gesture
// a press resolves to.

describe('Door precedence table', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
    useModeStore().setMode('door')
  })

  function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    viewport.setPointerCapture = () => {}
    return { wrapper, viewport }
  }

  function press(type: string, init: PointerEventInit = {}) {
    return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  }

  // A world point in screen coordinates: integers land on cell boundaries, so
  // `at(2, 2.5)` is on the vertical edge at x = 2 and `at(2.5, 2.5)` is the
  // centre of the cell beyond it.
  function at(x: number, y: number) {
    const tabs = useTabsStore()
    const tile = useModelStore().tileSize
    const camera = tabs.cameraOf(tabs.activeTabId)
    return {
      clientX: (x - camera.pan.x) * tile * camera.zoom,
      clientY: (y - camera.pan.y) * tile * camera.zoom,
    }
  }

  function click(viewport: HTMLElement, point: PointerEventInit, button = 0) {
    viewport.dispatchEvent(press('pointerdown', { ...point, button }))
    viewport.dispatchEvent(press('pointerup', { ...point, button }))
  }

  // The additive half of the selection policy. Shift is read at press time, so
  // it rides on `pointerdown` and `pointerup` alike.
  function shiftClick(viewport: HTMLElement, point: PointerEventInit) {
    click(viewport, { ...point, shiftKey: true })
  }

  // One cell of travel, which clears both halves of the click-vs-drag rule at
  // once: it is well past the pixel dead-zone and it leaves the origin cell.
  function drag(viewport: HTMLElement, from: PointerEventInit, to: PointerEventInit, button = 0) {
    viewport.dispatchEvent(press('pointerdown', { ...from, button }))
    viewport.dispatchEvent(press('pointermove', { ...to, button }))
    viewport.dispatchEvent(press('pointerup', { ...to, button }))
  }

  // The erase column, through the route every pointer has. The other two
  // (the stylus eraser end and the toolbar toggle) are `strokeAction`'s to
  // prove; what matters here is that the column exists per target.
  function erase(viewport: HTMLElement, point: PointerEventInit) {
    click(viewport, point, 2)
  }

  function map() {
    return useModelStore().project.mapsById.get(useTabsStore().activeTabId)!
  }

  function undoLabel() {
    return useModelStore().status.undoLabel
  }

  function transitions() {
    return [...map().transitions.values()]
  }

  function transitionCount() {
    return map().transitions.size
  }

  // One map carrying every target the matrix names, laid out in separate rows so
  // no press can be ambiguous about which one it lands on.
  //
  //   row 0  A(0,0)(1,0) | B(2,0)          a bare seam: the "no transition" row
  //   row 2  D(0,2)(1,2) | E(2,2)  J(4,2)  a door on the seam, a gap beyond it
  //   row 4  F(0,4) ....... G(4,4)         an elevator across a three-cell gap
  //   row 6  H(0,6)(1,6) | I(2,6)          a teleport between the two rooms
  //
  // Separate `paintCells` calls make separate rooms even where the cells touch,
  // which is what gives rows 0, 2 and 6 a real shared boundary to work across.
  function fixture(): MapId {
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    model.run('Setup', mapScope(mapId), (tx) => {
      const project = model.project
      const m = project.mapsById.get(mapId)!
      const paint = (cells: string[]) =>
        paintCells(tx, project, m, cells, { areaId: WORLD_AREA_ID })

      paint(['0,0', '1,0'])
      paint(['2,0'])

      paint(['0,2', '1,2'])
      paint(['2,2'])
      paint(['4,2'])
      createFromBox(tx, project, m, '1,2', '2,2')

      paint(['0,4'])
      paint(['4,4'])
      createFromBox(tx, project, m, '0,4', '4,4')

      paint(['0,6', '1,6'])
      paint(['2,6'])
      createTeleport(tx, project, { mapId, cell: '1,6' }, { mapId, cell: '2,6' })
    })
    return mapId
  }

  function idOf(kind: 'edge' | 'elevator' | 'teleport'): TransitionId {
    return transitions().find((each) => each.kind === kind)!.id
  }

  // The four targets, at the points that resolve to them. Named rather than
  // inlined, because every test below has to be pointing at the row it claims.
  const BARE_GRID = [9.5, 9.5] as const // no room, no transition
  const CLEAN_CELL = [1.5, 0.5] as const // room A, nothing on it
  const DOOR_EDGE = [2, 2.5] as const // the door on the row-2 seam
  const TELEPORT_MARK = [1.5, 6.5] as const // the teleport's near endpoint

  // -------------------------------------------------------------------------
  // Row 1: empty (non-room) cell. Every gesture starts on a room cell, so this
  // is the only target that is inert in all three columns.
  // -------------------------------------------------------------------------
  describe('empty (non-room) cell', () => {
    it('click: starts nothing and commits nothing', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const before = undoLabel()

      click(viewport, at(...BARE_GRID))

      expect(usePendingTeleportStore().isPending).toBe(false)
      expect(undoLabel()).toBe(before)
      expect(transitionCount()).toBe(3)
      wrapper.unmount()
    })

    it('drag: starts no box, and commits nothing', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const before = undoLabel()

      drag(viewport, at(...BARE_GRID), at(10.5, 9.5))

      expect(undoLabel()).toBe(before)
      expect(transitionCount()).toBe(3)
      wrapper.unmount()
    })

    it('erase: does nothing', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const before = undoLabel()

      erase(viewport, at(...BARE_GRID))

      expect(undoLabel()).toBe(before)
      expect(transitionCount()).toBe(3)
      wrapper.unmount()
    })
  })

  // -------------------------------------------------------------------------
  // Row 2: room cell, no transition under the pointer. The only row that
  // starts something: a click starts a pending teleport, and a box drag
  // creates an edge door or elevator.
  // -------------------------------------------------------------------------
  describe('room cell, no transition', () => {
    it('click: starts a pending teleport, committing nothing yet', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = fixture()
      const before = undoLabel()

      click(viewport, at(...CLEAN_CELL))

      const pending = usePendingTeleportStore()
      expect(pending.isPending).toBe(true)
      expect(pending.originOn(mapId)).toBe('1,0')
      expect(undoLabel()).toBe(before)
      expect(transitionCount()).toBe(3)
      wrapper.unmount()
    })

    it('drag: rubber-bands a box, which classifies into a new transition', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()

      // Across the bare seam at x = 2 on row 0: a 2x1 box, which classifies as
      // an edge door.
      drag(viewport, at(...CLEAN_CELL), at(2.5, 0.5))

      expect(undoLabel()).toBe('Add Transition')
      expect(transitionCount()).toBe(4)
      expect(map().transitionsAtEdge.get(edgeOfCell('2,0', 'W'))?.size).toBe(1)
      wrapper.unmount()
    })

    it('erase: does nothing, and above all does not erase the cell', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = fixture()
      const before = undoLabel()

      erase(viewport, at(...CLEAN_CELL))

      // The deliberate opposite of Draw mode's erase-priority rule: falling
      // through to it would eat the room.
      expect(undoLabel()).toBe(before)
      expect(useModelStore().project.mapsById.get(mapId)!.cellOwner.has('1,0')).toBe(true)
      wrapper.unmount()
    })
  })

  // -------------------------------------------------------------------------
  // Row 3: existing edge door or elevator, hit on its edge. One row for both:
  // they are treated identically.
  // -------------------------------------------------------------------------
  describe('existing edge door or elevator (edge-hit)', () => {
    it('click: selects it, and starts no teleport', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = fixture()

      click(viewport, at(...DOOR_EDGE))

      const selection = useSelectionStore()
      expect(selection.selected).toEqual([{ kind: 'transition', id: idOf('edge') }])
      expect(selection.mapId).toBe(mapId)
      // Select beats create: the press must not also start the teleport the
      // room cell underneath it would have.
      expect(usePendingTeleportStore().isPending).toBe(false)
      wrapper.unmount()
    })

    it('click: selects an elevator from its facing edge too', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()

      // The far end's facing edge, at x = 4 on row 4: the side standing in a
      // room. (The near end's edge stands in the gap; see the cross-cutting
      // rules below.)
      click(viewport, at(4, 4.5))

      expect(useSelectionStore().selected).toEqual([{ kind: 'transition', id: idOf('elevator') }])
      wrapper.unmount()
    })

    it('drag: makes a new transition rather than moving this one', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const doorId = idOf('edge')

      // Starting on the door, ending across the one-cell gap at (3,2), which
      // classifies as an elevator between rooms E and J.
      drag(viewport, at(...DOOR_EDGE), at(4.5, 2.5))

      expect(undoLabel()).toBe('Add Transition')
      expect(transitionCount()).toBe(4)
      // And the door that was pressed is untouched, still on its own edge.
      expect(map().transitions.has(doorId)).toBe(true)
      expect(map().transitionsAtEdge.get(edgeOfCell('2,2', 'W'))?.size).toBe(1)
      wrapper.unmount()
    })

    it('erase: deletes it, as one undo step', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const doorId = idOf('edge')

      erase(viewport, at(...DOOR_EDGE))

      expect(undoLabel()).toBe('Delete Transition')
      expect(map().transitions.has(doorId)).toBe(false)
      expect(transitionCount()).toBe(2)
      wrapper.unmount()
    })

    it('erase: deletes an elevator from its facing edge', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()

      erase(viewport, at(4, 4.5))

      expect(undoLabel()).toBe('Delete Transition')
      expect(transitions().some((each) => each.kind === 'elevator')).toBe(false)
      wrapper.unmount()
    })
  })

  // -------------------------------------------------------------------------
  // Row 4: existing teleport endpoint, hit through the cell interior.
  // -------------------------------------------------------------------------
  describe('existing teleport endpoint (interior-hit)', () => {
    it('click: selects the teleport, and starts no second one', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()

      click(viewport, at(...TELEPORT_MARK))

      expect(useSelectionStore().selected).toEqual([{ kind: 'transition', id: idOf('teleport') }])
      expect(usePendingTeleportStore().isPending).toBe(false)
      wrapper.unmount()
    })

    // A drag from a room cell is a box gesture even when the cell already holds
    // a teleport endpoint.
    it('drag: is a box gesture, not a select', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const teleportId = idOf('teleport')

      // Across the row-6 seam at x = 2, starting on the endpoint at (1,6).
      drag(viewport, at(...TELEPORT_MARK), at(2.5, 6.5))

      expect(undoLabel()).toBe('Add Transition')
      expect(transitionCount()).toBe(4)
      expect(map().transitionsAtEdge.get(edgeOfCell('2,6', 'W'))?.size).toBe(1)
      // The teleport it started on is untouched.
      expect(map().transitions.has(teleportId)).toBe(true)
      wrapper.unmount()
    })

    it('erase: deletes the teleport, as one undo step', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const teleportId = idOf('teleport')

      erase(viewport, at(...TELEPORT_MARK))

      expect(undoLabel()).toBe('Delete Transition')
      expect(map().transitions.has(teleportId)).toBe(false)
      wrapper.unmount()
    })
  })

  // -------------------------------------------------------------------------
  // Row 4, the other half: the cross-tab teleport's far marker. Unlike every
  // other target, it is derived rather than stored: the transition lives under
  // its origin map, and this tab rebuilds the marker from a project-scope
  // index, so every column has to reach across.
  // -------------------------------------------------------------------------
  describe('cross-tab teleport far marker (interior-hit)', () => {
    // Two tabs, a room on each, and a teleport stored under the first tab. The
    // second tab is left active, so every press below lands on the far marker.
    function crossTab() {
      const model = useModelStore()
      const tabs = useTabsStore()
      const originId = tabs.activeTabId
      tabs.addTab()
      const farId = tabs.activeTabId
      model.run('Setup', PROJECT_SCOPE, (tx) => {
        const project = model.project
        // A 2x1 room on the far map, so a box drag has somewhere to go.
        paintCells(tx, project, project.mapsById.get(originId)!, ['1,1'], { areaId: WORLD_AREA_ID })
        paintCells(tx, project, project.mapsById.get(farId)!, ['4,3'], { areaId: WORLD_AREA_ID })
        paintCells(tx, project, project.mapsById.get(farId)!, ['5,3'], { areaId: WORLD_AREA_ID })
        createTeleport(tx, project, { mapId: originId, cell: '1,1' }, { mapId: farId, cell: '4,3' })
      })
      const teleportId = [...model.project.mapsById.get(originId)!.transitions.values()][0].id
      return { originId, farId, teleportId }
    }

    it('click: selects the teleport, from a marker this map does not store', () => {
      const { wrapper, viewport } = mountCanvas()
      const { farId, teleportId } = crossTab()

      click(viewport, at(4.5, 3.5))

      const selection = useSelectionStore()
      expect(selection.selected).toEqual([{ kind: 'transition', id: teleportId }])
      // Selected on this tab, the one the user is looking at, even though the
      // transition is stored on the other one.
      expect(selection.mapId).toBe(farId)
      wrapper.unmount()
    })

    it('drag: is a box gesture, exactly as on the near end', () => {
      const { wrapper, viewport } = mountCanvas()
      const { originId, farId, teleportId } = crossTab()
      const model = useModelStore()

      // Across the seam between the far map's two rooms.
      drag(viewport, at(4.5, 3.5), at(5.5, 3.5))

      expect(undoLabel()).toBe('Add Transition')
      expect(model.project.mapsById.get(farId)!.transitions.size).toBe(1)
      // And the teleport, stored on the other map, is untouched.
      expect(model.project.mapsById.get(originId)!.transitions.has(teleportId)).toBe(true)
      wrapper.unmount()
    })

    it('erase: deletes the stored transition on the other map', () => {
      const { wrapper, viewport } = mountCanvas()
      const { originId, teleportId } = crossTab()
      const model = useModelStore()

      erase(viewport, at(4.5, 3.5))

      expect(undoLabel()).toBe('Delete Transition')
      expect(model.project.mapsById.get(originId)!.transitions.has(teleportId)).toBe(false)
      wrapper.unmount()
    })

    // A single click selects; the cross-tab affordance to navigate could not
    // also live on the click, so navigation moved to the double-click.
    it('double-click: travels to the other tab, where one click only selected', () => {
      const { wrapper, viewport } = mountCanvas()
      const { originId, farId } = crossTab()
      const tabs = useTabsStore()

      click(viewport, at(4.5, 3.5))
      expect(tabs.activeTabId).toBe(farId)

      viewport.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, cancelable: true, ...at(4.5, 3.5) }),
      )
      expect(tabs.activeTabId).toBe(originId)
      wrapper.unmount()
    })
  })

  // -------------------------------------------------------------------------
  // Rules that cut across every target, regardless of row.
  // -------------------------------------------------------------------------
  describe('cross-cutting rules', () => {
    // A tap starts a teleport unless it hits an existing transition (an
    // edge-hit door or an interior-hit teleport selects instead); the target
    // only disambiguates which existing thing gets selected.
    it('a tap starts a teleport only where it hits nothing', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const pending = usePendingTeleportStore()

      click(viewport, at(...DOOR_EDGE))
      expect(pending.isPending).toBe(false)

      click(viewport, at(...TELEPORT_MARK))
      expect(pending.isPending).toBe(false)

      click(viewport, at(...CLEAN_CELL))
      expect(pending.isPending).toBe(true)
      wrapper.unmount()
    })

    // A drag from any room cell is a box gesture: it makes a new transition
    // even where one already exists.
    it('a drag from any room cell is a box gesture, wherever it starts', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()

      // Bare cell, a door, and a teleport endpoint: three different rows, one
      // gesture, three new transitions.
      drag(viewport, at(...CLEAN_CELL), at(2.5, 0.5))
      drag(viewport, at(...DOOR_EDGE), at(4.5, 2.5))
      drag(viewport, at(...TELEPORT_MARK), at(2.5, 6.5))

      expect(transitionCount()).toBe(6)
      wrapper.unmount()
    })

    // Transitions are never dragged or moved directly: they are edge- or
    // cell-anchored and follow room edits. Relocating one means deleting and
    // redrawing it.
    it('a drag never moves the transition it started on', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const before = transitions().map((each) => ({ id: each.id, anchor: JSON.stringify(each) }))

      drag(viewport, at(...DOOR_EDGE), at(4.5, 2.5))
      drag(viewport, at(...TELEPORT_MARK), at(2.5, 6.5))

      // Every transition that existed still exists, byte-identical: the drags
      // added, and touched nothing.
      for (const { id, anchor } of before) {
        expect(map().transitions.has(id)).toBe(true)
        expect(JSON.stringify(map().transitions.get(id))).toBe(anchor)
      }
      wrapper.unmount()
    })

    // Select beats create.
    it('a press on a transition never creates, and a press off one never selects', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const selection = useSelectionStore()
      const before = undoLabel()

      click(viewport, at(...DOOR_EDGE))
      expect(selection.selected).toHaveLength(1)
      expect(undoLabel()).toBe(before)

      // And the reverse: clicking off everything clears rather than selects.
      click(viewport, at(...BARE_GRID))
      expect(selection.selected).toEqual([])
      wrapper.unmount()
    })

    it('shift-click adds to the selection, and removes what is already in it', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const selection = useSelectionStore()
      const door = idOf('edge')
      const teleport = idOf('teleport')

      click(viewport, at(...DOOR_EDGE))
      shiftClick(viewport, at(...TELEPORT_MARK))
      expect(selection.selected).toEqual([
        { kind: 'transition', id: door },
        { kind: 'transition', id: teleport },
      ])

      shiftClick(viewport, at(...DOOR_EDGE))
      expect(selection.selected).toEqual([{ kind: 'transition', id: teleport }])
      wrapper.unmount()
    })

    // A shift-click only ever edits the selection. Both halves matter: a miss
    // must not clear what is being built, and the row's own create column must
    // not fire underneath it, which here is a room cell starting a teleport.
    it('a shift-click that finds nothing leaves the selection alone and starts no teleport', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const selection = useSelectionStore()
      const door = idOf('edge')

      click(viewport, at(...DOOR_EDGE))
      shiftClick(viewport, at(...CLEAN_CELL))
      shiftClick(viewport, at(...BARE_GRID))

      expect(selection.selected).toEqual([{ kind: 'transition', id: door }])
      expect(usePendingTeleportStore().isPending).toBe(false)
      wrapper.unmount()
    })

    // Multi-delete is one transaction, and this is the first route by which a
    // user can build the selection it acts on.
    it('Delete removes a shift-built selection in one undo step', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const door = idOf('edge')
      const teleport = idOf('teleport')

      click(viewport, at(...DOOR_EDGE))
      shiftClick(viewport, at(...TELEPORT_MARK))
      runAction('deleteSelection')

      expect(map().transitions.has(door)).toBe(false)
      expect(map().transitions.has(teleport)).toBe(false)
      expect(transitionCount()).toBe(1)

      useModelStore().undo()
      expect(transitionCount()).toBe(3)
      wrapper.unmount()
    })

    // Erase (right-click) on a non-transition does nothing.
    it('erase on a non-transition does nothing, on grid or on a room', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = fixture()
      const before = undoLabel()

      erase(viewport, at(...BARE_GRID))
      erase(viewport, at(...CLEAN_CELL))

      expect(undoLabel()).toBe(before)
      expect(transitionCount()).toBe(3)
      // Draw mode's erase would have taken the cell; Door mode's must not.
      expect(useModelStore().project.mapsById.get(mapId)!.cellOwner.has('1,0')).toBe(true)
      wrapper.unmount()
    })

    // An elevator's near facing edge is shared with the empty gap cell on the
    // far side of it, so that press selects and deletes a transition while
    // standing on no room at all: it can never start a box.
    it('an elevator edge hit from the gap side selects but starts no box', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const before = transitionCount()

      // x = 1 on row 4 is the near end's facing edge; the cell it lands in,
      // (1,4), is empty.
      drag(viewport, at(1, 4.5), at(2.5, 4.5))
      expect(transitionCount()).toBe(before)

      // The same press as a click still selects, which is the half that works.
      click(viewport, at(1, 4.5))
      expect(useSelectionStore().selected).toEqual([{ kind: 'transition', id: idOf('elevator') }])
      wrapper.unmount()
    })

    // The other two columns of that same standing-on-nothing row. Erase has to
    // reach it: an elevator's near end is the one a user is most likely to aim
    // at, and refusing there because the pointer happened to land a pixel into
    // the gap would be indistinguishable from a broken delete.
    it('an elevator edge hit from the gap side still deletes', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()

      erase(viewport, at(1, 4.5))

      expect(undoLabel()).toBe('Delete Transition')
      expect(transitions().some((each) => each.kind === 'elevator')).toBe(false)
      wrapper.unmount()
    })

    // While a teleport is pending, every click is a completion attempt instead
    // of running its usual row: nothing selects, nothing starts a second
    // teleport, nothing is deleted.
    //
    // What decides validity is the cell, not what was drawn on it: a click on a
    // door's edge is a click in whichever room that cell belongs to.
    it('a pending teleport turns every row into a completion attempt', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const pending = usePendingTeleportStore()
      const selection = useSelectionStore()

      click(viewport, at(...CLEAN_CELL))
      expect(pending.isPending).toBe(true)

      // Bare grid: no room, so not a valid destination. An invalid second click
      // is ignored and the gesture stays pending.
      click(viewport, at(...BARE_GRID))
      expect(pending.isPending).toBe(true)

      // A teleport endpoint: a room cell, but one that already has a teleport,
      // which is capped at one per cell. Also ignored, and it does not select
      // the existing teleport.
      click(viewport, at(...TELEPORT_MARK))
      expect(pending.isPending).toBe(true)
      expect(selection.selected).toEqual([])
      expect(transitionCount()).toBe(3)

      // A door's edge completes the teleport, because the cell under that edge
      // is a room cell in a different room. The door itself is not selected or
      // touched: the pending gesture simply takes the click.
      click(viewport, at(...DOOR_EDGE))
      expect(pending.isPending).toBe(false)
      expect(undoLabel()).toBe('Add Teleport')
      expect(selection.selected).toEqual([])
      expect(map().transitions.has(idOf('edge'))).toBe(true)
      wrapper.unmount()
    })

    // There is no fourth column. The middle button must start nothing at all
    // rather than fall through to the create column, which is the failure that
    // would show up as a stray transition from an autoscroll press.
    it('the middle button is in no column', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const before = undoLabel()

      click(viewport, at(...CLEAN_CELL), 1)
      drag(viewport, at(...CLEAN_CELL), at(2.5, 0.5), 1)
      click(viewport, at(...DOOR_EDGE), 1)

      expect(usePendingTeleportStore().isPending).toBe(false)
      expect(useSelectionStore().selected).toEqual([])
      expect(undoLabel()).toBe(before)
      expect(transitionCount()).toBe(3)
      wrapper.unmount()
    })

    // A drag that goes out and comes back is still a drag, not a click, which
    // is why Door mode's click cannot be a DOM `click` listener. The box
    // returns to its origin, classifies to nothing, and must not fall back to
    // starting a teleport.
    it('a drag out and back is a drag, not a tap', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const before = undoLabel()

      viewport.dispatchEvent(press('pointerdown', at(...CLEAN_CELL)))
      viewport.dispatchEvent(press('pointermove', at(2.5, 0.5)))
      viewport.dispatchEvent(press('pointermove', at(...CLEAN_CELL)))
      viewport.dispatchEvent(press('pointerup', at(...CLEAN_CELL)))

      expect(usePendingTeleportStore().isPending).toBe(false)
      expect(undoLabel()).toBe(before)
      expect(transitionCount()).toBe(3)
      wrapper.unmount()
    })

    // The erase toggle is the third route into the erase column and the only
    // one touch has, so the column has to be reachable without a right button.
    it('the erase toggle puts the primary button in the erase column', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      const doorId = idOf('edge')
      useToolsStore().toggleErase()

      click(viewport, at(...DOOR_EDGE))

      expect(undoLabel()).toBe('Delete Transition')
      expect(map().transitions.has(doorId)).toBe(false)
      wrapper.unmount()
    })

    // And with the toggle on there is no create column at all: the toggle
    // makes the primary pointer erase instead of its normal action.
    it('the erase toggle removes the create column entirely', () => {
      const { wrapper, viewport } = mountCanvas()
      fixture()
      useToolsStore().toggleErase()
      const before = undoLabel()

      click(viewport, at(...CLEAN_CELL))
      drag(viewport, at(...CLEAN_CELL), at(2.5, 0.5))

      expect(usePendingTeleportStore().isPending).toBe(false)
      expect(undoLabel()).toBe(before)
      expect(transitionCount()).toBe(3)
      wrapper.unmount()
    })
  })
})
