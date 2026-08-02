import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount } from '@vue/test-utils'
import CanvasRegion from './CanvasRegion.vue'
import { useTabsStore } from '@/stores/tabs'
import { useToolsStore } from '@/stores/tools'
import { useActiveRoomStore } from '@/stores/activeRoom'
import { mapScope, useModelStore } from '@/stores/model'
import { paintCells } from '@/core/ops/rooms'
import { edgeOfCell } from '@/core/cell'
import { WORLD_AREA_ID } from '@/core/ids'
import type { MapId, RoomId } from '@/core/ids'

// Draw/Edit mode's press behaviour, as a matrix: one `describe` per press
// zone, one `it` per gesture (click, drag, erase), plus the cross-cutting
// rules that apply regardless of zone.
//
// Deliberately overlapping the gesture-level suites rather than replacing
// them: those cover the mechanism (ghosting, undo granularity, byte-identical
// rollback); these cover which gesture a press resolves to.
//
// Everything here is Auto. The four sub-mode locks are filters over this
// table and are swept in `CanvasRegion.test.ts`.

describe('Draw/Edit precedence table (Auto)', () => {
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

  function press(type: string, init: PointerEventInit = {}) {
    return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  }

  // An arbitrary world point in screen coordinates: integers land on grid
  // lines, so `at(3, 3)` is a vertex and `at(3.5, 3.5)` a cell centre.
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

  function drag(viewport: HTMLElement, from: PointerEventInit, to: PointerEventInit, button = 0) {
    viewport.dispatchEvent(press('pointerdown', { ...from, button }))
    viewport.dispatchEvent(press('pointermove', { ...to, button }))
    viewport.dispatchEvent(press('pointerup', { ...to, button }))
  }

  function paint(mapId: MapId, cells: string[]): RoomId {
    const model = useModelStore()
    return model.run('Setup', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, model.project.mapsById.get(mapId)!, cells, {
        areaId: WORLD_AREA_ID,
      }),
    ).id
  }

  // The 3x3 at (2,2)-(4,4): every zone at once. Its faces are runs of three, its
  // interior vertices are (3,3), (4,3), (3,4) and (4,4), and (3.5, 3.5) is a
  // cell centre that is none of those.
  function square3(mapId: MapId): RoomId {
    const cells: string[] = []
    for (let x = 2; x <= 4; x++) for (let y = 2; y <= 4; y++) cells.push(`${x},${y}`)
    return paint(mapId, cells)
  }

  function map() {
    return useModelStore().project.mapsById.get(useTabsStore().activeTabId)!
  }

  function room(roomId: RoomId) {
    return map().rooms.get(roomId)!
  }

  function undoLabel() {
    return useModelStore().status.undoLabel
  }

  // -------------------------------------------------------------------------
  // Row 1: Empty cell
  // -------------------------------------------------------------------------
  describe('empty cell', () => {
    it('click: makes a new room, one brush footprint wide', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId

      click(viewport, at(6.5, 6.5))

      expect(map().cellOwner.get('6,6')).toBeDefined()
      expect(room(map().cellOwner.get('6,6')!).cells.size).toBe(1)
      expect(undoLabel()).toBe('Paint')
      void mapId
      wrapper.unmount()
    })

    it('drag: paints a swath, and crossing another room merges it in', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      paint(mapId, ['9,6'])

      drag(viewport, at(6.5, 6.5), at(9.5, 6.5))

      expect(map().rooms.size).toBe(1)
      expect(room(map().cellOwner.get('6,6')!).cells.size).toBe(4)
      wrapper.unmount()
    })

    // Nothing under the pointer to erase, so the transaction is empty and
    // the seam drops it: no wasted Ctrl+Z.
    it('erase: does nothing, and leaves no undo step', () => {
      const { wrapper, viewport } = mountCanvas()
      const before = undoLabel()

      drag(viewport, at(6.5, 6.5), at(9.5, 6.5), 2)

      expect(map().rooms.size).toBe(0)
      expect(undoLabel()).toBe(before)
      wrapper.unmount()
    })
  })

  // -------------------------------------------------------------------------
  // Row 2: Room interior
  // -------------------------------------------------------------------------
  describe('room interior', () => {
    it('click: sets the room active and changes no cell', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)

      click(viewport, at(3.5, 3.5))

      expect(useActiveRoomStore().roomIdOn(mapId)).toBe(roomId)
      expect(room(roomId).cells.size).toBe(9)
      expect(undoLabel()).toBe('Setup')
      wrapper.unmount()
    })

    // The brush footprint rule applies to grow as well as paint, so a sized
    // brush clicked near the edge reaches outside the room and grows it even
    // though a 1x1 click here would change no cell.
    it('click with a sized brush near the edge: grows, because the footprint does', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)
      useToolsStore().setBrushSize(3)

      // Centred on the room's own corner cell, so the footprint hangs outside.
      click(viewport, at(2.5, 2.5))

      expect(room(roomId).cells.size).toBeGreaterThan(9)
      expect(undoLabel()).toBe('Paint')
      wrapper.unmount()
    })

    it('drag into empty: grows the room it started in', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)

      drag(viewport, at(3.5, 3.5), at(8.5, 3.5))

      expect(map().rooms.size).toBe(1)
      expect(room(roomId).cells.size).toBe(13)
      wrapper.unmount()
    })

    it('drag into another room: merges it in, the origin winning', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)
      paint(mapId, ['8,3'])

      drag(viewport, at(3.5, 3.5), at(8.5, 3.5))

      expect(map().rooms.size).toBe(1)
      expect(map().cellOwner.get('8,3')).toBe(roomId)
      wrapper.unmount()
    })

    it('erase: erases the cells, and may split the room', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      square3(mapId)

      // Straight down the middle column.
      drag(viewport, at(3.5, 2.5), at(3.5, 4.5), 2)

      expect(map().rooms.size).toBe(2)
      expect(undoLabel()).toBe('Erase')
      wrapper.unmount()
    })
  })

  // -------------------------------------------------------------------------
  // Row 3: Outer edge run of length >= 2
  // -------------------------------------------------------------------------
  describe('outer edge run', () => {
    // Two pixels inside the east wall: within the grab band, and inside the
    // room's own cell, which is what makes the zone resolve as an edge run.
    const onRun = () => at(4.97, 3.5)

    it('click: sets the room active and changes no cell', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)

      click(viewport, onRun())

      expect(useActiveRoomStore().roomIdOn(mapId)).toBe(roomId)
      expect(room(roomId).cells.size).toBe(9)
      expect(undoLabel()).toBe('Setup')
      wrapper.unmount()
    })

    it('drag: resizes the grabbed run, whole run at a time', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)

      drag(viewport, onRun(), at(5.5, 3.5))

      // All three rows extruded, not the one cell the pointer crossed.
      expect(room(roomId).cells.size).toBe(12)
      expect(undoLabel()).toBe('Resize Room')
      wrapper.unmount()
    })

    it('erase: erases the cells there rather than resizing', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)

      click(viewport, onRun(), 2)

      expect(room(roomId).cells.size).toBe(8)
      expect(undoLabel()).toBe('Erase')
      wrapper.unmount()
    })
  })

  // -------------------------------------------------------------------------
  // Row 4: Length-1 face
  // -------------------------------------------------------------------------
  // A length-1 face has no resize handle: it grows by painting instead. A 1x1
  // room has nothing but length-1 faces, so every press on it takes this row.
  describe('length-1 face', () => {
    const onFace = () => at(7.97, 2.5)

    it('click: sets the room active, with no resize to be had', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = paint(mapId, ['7,2'])

      click(viewport, onFace())

      expect(useActiveRoomStore().roomIdOn(mapId)).toBe(roomId)
      expect(room(roomId).cells.size).toBe(1)
      wrapper.unmount()
    })

    it('drag: treated as interior, so it grows into empty', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = paint(mapId, ['7,2'])

      drag(viewport, onFace(), at(8.5, 2.5))

      expect([...room(roomId).cells].sort()).toEqual(['7,2', '8,2'])
      expect(undoLabel()).toBe('Paint')
      wrapper.unmount()
    })

    it('erase: erases the cell', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      paint(mapId, ['7,2'])

      click(viewport, onFace(), 2)

      expect(map().rooms.size).toBe(0)
      wrapper.unmount()
    })
  })

  // -------------------------------------------------------------------------
  // Row 5: Interior vertex
  // -------------------------------------------------------------------------
  describe('interior vertex', () => {
    it('click: sets the room active and draws no wall', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)

      click(viewport, at(3, 3))

      expect(useActiveRoomStore().roomIdOn(mapId)).toBe(roomId)
      // A wall needs two vertices, so a click that never moved draws nothing.
      expect(room(roomId).innerWalls.size).toBe(0)
      expect(undoLabel()).toBe('Setup')
      wrapper.unmount()
    })

    it('drag: draws inner-wall segments along the interior edges', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)

      drag(viewport, at(3, 3), at(4, 3))

      expect([...room(roomId).innerWalls.keys()]).toEqual([edgeOfCell('3,2', 'S')])
      expect(undoLabel()).toBe('Draw Inner Wall')
      wrapper.unmount()
    })

    // No vertex-specific erase behaviour: the cross-cutting rule deletes an
    // inner-wall segment when the press is on one, and otherwise erases the
    // cell, and a bare vertex is not on one.
    it('erase: falls through to erasing the cell', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)

      click(viewport, at(3, 3), 2)

      expect(room(roomId).cells.size).toBe(8)
      expect(undoLabel()).toBe('Erase')
      wrapper.unmount()
    })
  })

  // -------------------------------------------------------------------------
  // Row 6: On an inner-wall segment
  // -------------------------------------------------------------------------
  describe('on an inner-wall segment', () => {
    // Halfway along the wall drawn below, a whisker inside the cell beneath it.
    const onWall = () => at(3.5, 3.02)

    function withWall(mapId: MapId, viewport: HTMLElement): RoomId {
      const roomId = square3(mapId)
      drag(viewport, at(3, 3), at(4, 3))
      return roomId
    }

    it('click: sets the room active and leaves the wall as it was', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = withWall(mapId, viewport)
      const label = undoLabel()

      click(viewport, onWall())

      expect(useActiveRoomStore().roomIdOn(mapId)).toBe(roomId)
      expect(room(roomId).innerWalls.get(edgeOfCell('3,2', 'S'))).toBe('solid')
      // Drawing the same style over itself is an empty transaction.
      expect(undoLabel()).toBe(label)
      wrapper.unmount()
    })

    it('drag: re-styles it with whatever style is selected', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = withWall(mapId, viewport)
      useToolsStore().setWallStyle('dotted')

      drag(viewport, onWall(), at(4, 3))

      expect(room(roomId).innerWalls.get(edgeOfCell('3,2', 'S'))).toBe('dotted')
      wrapper.unmount()
    })

    it('erase: deletes the segment, not the cell', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = withWall(mapId, viewport)

      click(viewport, onWall(), 2)

      expect(room(roomId).innerWalls.size).toBe(0)
      expect(room(roomId).cells.size).toBe(9)
      expect(undoLabel()).toBe('Erase Inner Wall')
      wrapper.unmount()
    })
  })

  // -------------------------------------------------------------------------
  // Cross-cutting rules
  // -------------------------------------------------------------------------
  describe('cross-cutting rules', () => {
    // Brush footprint applies to paint, grow and erase only, not resize or
    // inner-wall drawing. Negative rules like this rot silently: nothing
    // fails when they stop being true, so both halves get a direct test.
    it('the brush does not reach resize', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)
      useToolsStore().setBrushSize(3)

      drag(viewport, at(4.97, 3.5), at(5.5, 3.5))

      // One column of three, as at brush 1, not three columns.
      expect(room(roomId).cells.size).toBe(12)
      expect(undoLabel()).toBe('Resize Room')
      wrapper.unmount()
    })

    it('the brush does not reach inner walls', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)
      useToolsStore().setBrushSize(3)

      drag(viewport, at(3, 3), at(4, 3))

      // One segment, not a three-wide band of them.
      expect(room(roomId).innerWalls.size).toBe(1)
      wrapper.unmount()
    })

    // Pressing any room cell makes it active, not just the interior, and on
    // the press rather than the release.
    it('every press on a room arms it, whichever zone it lands in', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      const roomId = square3(mapId)
      const active = useActiveRoomStore()

      for (const point of [at(3.5, 3.5), at(4.97, 3.5), at(3, 3)]) {
        active.clear()
        viewport.dispatchEvent(press('pointerdown', point))
        expect(useActiveRoomStore().roomIdOn(mapId)).toBe(roomId)
        viewport.dispatchEvent(press('pointerup', point))
      }
      wrapper.unmount()
    })

    it('a press on empty grid arms nothing', () => {
      const { wrapper, viewport } = mountCanvas()
      const mapId = useTabsStore().activeTabId
      square3(mapId)

      viewport.dispatchEvent(press('pointerdown', at(9.5, 9.5)))
      expect(useActiveRoomStore().isArmed).toBe(false)
      viewport.dispatchEvent(press('pointerup', at(9.5, 9.5)))
      wrapper.unmount()
    })
  })
})
