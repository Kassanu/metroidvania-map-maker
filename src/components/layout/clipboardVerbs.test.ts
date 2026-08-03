import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import CanvasRegion from './CanvasRegion.vue'
import { useModeStore } from '@/stores/mode'
import { useToolsStore } from '@/stores/tools'
import { useSelectionStore } from '@/stores/selection'
import { useClipboardStore } from '@/stores/clipboard'
import { useTabsStore } from '@/stores/tabs'
import { mapScope, PROJECT_SCOPE, useModelStore } from '@/stores/model'
import { runAction } from '@/hotkeys/actions'
import { paintCells } from '@/core/ops/rooms'
import { addMap } from '@/core/ops/maps'
import { createFromBox } from '@/core/ops/doors'
import { createLine, placeIcon } from '@/core/ops/markup'
import { ok, TEST_ICON_COLORS } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { LineId, MapId, RoomId } from '@/core/ids'
import type { MapModel } from '@/core/types'

// Copy, cut, paste and duplicate through the keys, which is where the payload
// meets the pointer: what a selection puts on the clipboard, and where a paste
// lands. What each op does to the model is the core suite's.
describe('the clipboard verbs', () => {
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

  const selection = () => useSelectionStore()
  const clipboard = () => useClipboardStore()
  const mapId = () => useTabsStore().activeTabId

  function map(id: MapId = mapId()): MapModel {
    return useModelStore().project.mapsById.get(id)!
  }

  function room(cells: string[], id: MapId = mapId()): RoomId {
    const model = useModelStore()
    return model.run('Setup', mapScope(id), (tx) =>
      paintCells(tx, model.project, map(id), cells, { areaId: WORLD_AREA_ID }),
    ).id
  }

  function line(points: string[]): LineId {
    const model = useModelStore()
    return model.run('Setup', mapScope(mapId()), (tx) =>
      ok(createLine(tx, map(), points, { color: '#d9a441', arrowStart: false, arrowEnd: false })),
    ).id
  }

  // The pointer's cell decides where a paste lands, so a test that means "no
  // pointer over the canvas" has to say so rather than rely on jsdom never
  // having moved one.
  async function movePointerTo(viewport: HTMLElement, x: number, y: number) {
    const tile = useModelStore().tileSize
    const camera = useTabsStore().cameraOf(mapId())
    viewport.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: (x - camera.pan.x) * tile * camera.zoom,
        clientY: (y - camera.pan.y) * tile * camera.zoom,
      }),
    )
    await nextTick()
  }

  async function leaveCanvas(viewport: HTMLElement) {
    viewport.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
    await nextTick()
  }

  function cellsOf(id: RoomId, on: MapId = mapId()) {
    return [...map(on).rooms.get(id)!.cells].sort()
  }

  function roomsOn(id: MapId = mapId()) {
    return [...map(id).rooms.values()]
  }

  describe('copy', () => {
    it('puts the selected rooms on the clipboard and changes no model', async () => {
      await mountCanvas()
      const model = useModelStore()
      const a = room(['0,0', '1,0'])
      selection().set([{ kind: 'room', id: a }], mapId())
      const before = model.status.undoLabel

      runAction('copy')

      expect(clipboard().isEmpty).toBe(false)
      expect(clipboard().payload.rooms).toHaveLength(1)
      expect(model.status.undoLabel).toBe(before)
      expect(map().rooms.has(a)).toBe(true)
    })

    // Transitions are never copied and an icon travels as content on a cell, so
    // a selection of only those has no payload. Refusing leaves whatever was
    // already on the clipboard, which beats emptying it silently.
    it('refuses a selection with nothing to copy, keeping what was there', async () => {
      await mountCanvas()
      const model = useModelStore()
      const a = room(['0,0'])
      room(['1,0'])
      const door = model.run('Door', mapScope(mapId()), (tx) =>
        ok(createFromBox(tx, model.project, map(), '0,0', '1,0')),
      )[0]

      selection().set([{ kind: 'room', id: a }], mapId())
      runAction('copy')
      const kept = clipboard().payload

      selection().set([{ kind: 'transition', id: door.id }], mapId())
      runAction('copy')

      expect(clipboard().payload).toBe(kept)
    })

    it('does nothing outside Select mode', async () => {
      await mountCanvas()
      const a = room(['0,0'])
      selection().set([{ kind: 'room', id: a }], mapId())
      useModeStore().setMode('draw')
      await nextTick()

      runAction('copy')

      expect(clipboard().isEmpty).toBe(true)
    })

    // A cell selection carries no room and no line, so every verb here would
    // act on two empty lists. Refusing keeps the clipboard the user filled in
    // the other granularity, rather than replacing it with a payload a paste
    // does nothing with.
    it('leaves the clipboard alone in the Cells sub-mode', async () => {
      await mountCanvas()
      const a = room(['0,0'])
      selection().set([{ kind: 'room', id: a }], mapId())
      runAction('copy')
      const kept = clipboard().payload

      useToolsStore().setSelectSubMode('cells')
      selection().set([{ kind: 'cell', id: '0,0' }], mapId())
      runAction('copy')

      expect(clipboard().payload).toBe(kept)
    })
  })

  describe('paste', () => {
    it('lands the payload origin on the cell under the pointer', async () => {
      const { viewport } = await mountCanvas()
      const a = room(['0,0', '1,0'])
      selection().set([{ kind: 'room', id: a }], mapId())
      runAction('copy')

      await movePointerTo(viewport, 6.5, 4.5)
      runAction('paste')

      const pasted = roomsOn().find((entry) => entry.id !== a)!
      expect([...pasted.cells].sort()).toEqual(['6,4', '7,4'])
    })

    // No pointer over the canvas, so the payload falls back to clear of where
    // it came from: its own width plus a one-cell gap.
    it('lands clear of the source when the pointer is off the canvas', async () => {
      const { viewport } = await mountCanvas()
      const a = room(['2,3', '3,3'])
      selection().set([{ kind: 'room', id: a }], mapId())
      runAction('copy')

      await leaveCanvas(viewport)
      runAction('paste')

      const pasted = roomsOn().find((entry) => entry.id !== a)!
      expect([...pasted.cells].sort()).toEqual(['5,3', '6,3'])
    })

    it('names the copy by the locked convention, twice over', async () => {
      const { viewport } = await mountCanvas()
      const a = room(['0,0'])
      useModelStore().run('Name', mapScope(mapId()), () => {
        map().rooms.get(a)!.name = 'Landing Site'
      })
      selection().set([{ kind: 'room', id: a }], mapId())
      runAction('copy')

      await leaveCanvas(viewport)
      runAction('paste')
      const first = roomsOn().find((entry) => entry.id !== a)!.name
      runAction('paste')

      // The second paste lands on the first, because the anchor is a function
      // of the payload and nothing about it changed: paste is destructive, so
      // the first copy is gone and only its name is spent.
      expect(first).toBe('Landing Site copy')
      expect(
        roomsOn()
          .map((entry) => entry.name)
          .sort(),
      ).toEqual(['Landing Site', 'Landing Site copy 2'])
    })

    it('selects what it pasted, not what was selected before', async () => {
      const { viewport } = await mountCanvas()
      const a = room(['0,0'])
      selection().set([{ kind: 'room', id: a }], mapId())
      runAction('copy')

      await movePointerTo(viewport, 5.5, 5.5)
      runAction('paste')

      const pasted = roomsOn().find((entry) => entry.id !== a)!
      expect(selection().selected).toEqual([{ kind: 'room', id: pasted.id }])
    })

    it('does nothing with an empty clipboard', async () => {
      await mountCanvas()
      const model = useModelStore()
      room(['0,0'])
      const before = model.status.undoLabel

      runAction('paste')

      expect(model.status.undoLabel).toBe(before)
    })

    // The payload carries no absolute geometry apart from where it came from,
    // which is what lets it cross to a map that has never seen it.
    it('pastes onto another tab', async () => {
      const { viewport } = await mountCanvas()
      const model = useModelStore()
      const source = mapId()
      const a = room(['0,0', '1,0'])
      selection().set([{ kind: 'room', id: a }], mapId())
      runAction('copy')

      const other = model.run('Add map', PROJECT_SCOPE, (tx) => addMap(tx, model.project, 'Caves'))
      useTabsStore().activate(other.id)
      await nextTick()

      await movePointerTo(viewport, 3.5, 2.5)
      runAction('paste')

      expect(roomsOn(other.id)).toHaveLength(1)
      expect([...roomsOn(other.id)[0].cells].sort()).toEqual(['3,2', '4,2'])
      // The source is untouched on the tab it came from.
      expect(cellsOf(a, source)).toEqual(['0,0', '1,0'])
    })
  })

  describe('cut', () => {
    it('takes the payload and removes the source in one undo step', async () => {
      const { viewport } = await mountCanvas()
      const model = useModelStore()
      const a = room(['0,0', '1,0'])
      const l = line(['0,4', '1,4'])
      selection().set(
        [
          { kind: 'room', id: a },
          { kind: 'line', id: l },
        ],
        mapId(),
      )

      runAction('cut')

      expect(map().rooms.has(a)).toBe(false)
      expect(map().lines.has(l)).toBe(false)
      expect(model.status.undoLabel).toBe('Cut')

      // One step for both kinds: a single undo brings the pair back.
      model.undo()
      expect(map().rooms.has(a)).toBe(true)
      expect(map().lines.has(l)).toBe(true)

      // And what it took is still pasteable after the source is gone.
      model.redo()
      await leaveCanvas(viewport)
      runAction('paste')
      expect(roomsOn()).toHaveLength(1)
    })
  })

  describe('duplicate', () => {
    it('copies in place without touching the clipboard', async () => {
      await mountCanvas()
      const a = room(['0,0', '1,0'])
      const b = room(['5,5'])
      selection().set([{ kind: 'room', id: b }], mapId())
      runAction('copy')
      const kept = clipboard().payload

      selection().set([{ kind: 'room', id: a }], mapId())
      runAction('duplicate')

      expect(roomsOn()).toHaveLength(3)
      // Whatever was copied is still there to paste.
      expect(clipboard().payload).toBe(kept)
    })

    // Duplicate and a pointerless paste share one offset definition, so the two
    // routes put a copy in the same place.
    it('lands where a pointerless paste would', async () => {
      const { viewport } = await mountCanvas()
      const a = room(['2,3', '3,3'])
      selection().set([{ kind: 'room', id: a }], mapId())

      runAction('duplicate')
      const duplicated = roomsOn().find((entry) => entry.id !== a)!
      const at = [...duplicated.cells].sort()

      useModelStore().undo()
      selection().set([{ kind: 'room', id: a }], mapId())
      runAction('copy')
      await leaveCanvas(viewport)
      runAction('paste')

      const pasted = roomsOn().find((entry) => entry.id !== a)!
      expect([...pasted.cells].sort()).toEqual(at)
    })
  })

  // A mixed selection is the case the payload had to grow for: two payloads
  // merged after the fact would each be relative to their own top-left.
  describe('a mixed room and line selection', () => {
    it('round-trips with the geometry between them intact', async () => {
      const { viewport } = await mountCanvas()
      const a = room(['4,4', '5,4'])
      const l = line(['4,7', '5,7'])
      selection().set(
        [
          { kind: 'room', id: a },
          { kind: 'line', id: l },
        ],
        mapId(),
      )

      runAction('copy')
      await movePointerTo(viewport, 10.5, 20.5)
      runAction('paste')

      const pasted = roomsOn().find((entry) => entry.id !== a)!
      const pastedLine = [...map().lines.values()].find((entry) => entry.id !== l)!
      expect([...pasted.cells].sort()).toEqual(['10,20', '11,20'])
      // Three rows below the room, exactly as it was.
      expect(pastedLine.points).toEqual(['10,23', '11,23'])
    })

    it('carries an icon standing on a copied room', async () => {
      const { viewport } = await mountCanvas()
      const model = useModelStore()
      const a = room(['0,0'])
      model.run('Icon', mapScope(mapId()), (tx) =>
        ok(placeIcon(tx, map(), '0,0', 'save', TEST_ICON_COLORS)),
      )
      selection().set([{ kind: 'room', id: a }], mapId())

      runAction('copy')
      await movePointerTo(viewport, 8.5, 8.5)
      runAction('paste')

      expect(map().iconAtCell.has('8,8')).toBe(true)
    })
  })
})
