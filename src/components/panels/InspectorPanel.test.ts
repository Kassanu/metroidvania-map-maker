import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import InspectorPanel from './InspectorPanel.vue'
import { useTabsStore } from '@/stores/tabs'
import { useSelectionStore } from '@/stores/selection'
import { mapScope, useModelStore } from '@/stores/model'
import { assignRoomArea, paintCells, renameRoom, setRoomNotes } from '@/core/ops/rooms'
import { createNewArea } from '@/core/ops/project'
import { createLine } from '@/core/ops/markup'
import { ok } from '@/core/testUtils'
import { PROJECT_SCOPE } from '@/core/journal'
import { WORLD_AREA_ID } from '@/core/ids'
import type { AreaId, LineId, MapId, RoomId } from '@/core/ids'
import type { CellKey } from '@/core/cell'

// The Inspector's four states and the Room panel's three fields.
//
// The states are tested through the selection store rather than through a
// pointer, because the panel reads the store and nothing else: what put a ref
// there is the canvas's business and is covered by the mode's own suite.

describe('InspectorPanel', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createTestPinia())
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  interface Fixture {
    mapId: MapId
    roomA: RoomId
    roomB: RoomId
    line: LineId
    brinstar: AreaId
  }

  function setup(): Fixture {
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    let roomA!: RoomId
    let roomB!: RoomId
    let line!: LineId
    let brinstar!: AreaId

    model.run('Setup', mapScope(mapId), (tx) => {
      const map = model.project.mapsById.get(mapId)!
      const paint = (cells: CellKey[]) =>
        paintCells(tx, model.project, map, cells, { areaId: WORLD_AREA_ID })
      // Painted rooms start unnamed, and two empty names make every
      // "did it re-seed" assertion pass without testing anything.
      roomA = paint(['0,0', '1,0']).id
      roomB = paint(['0,2', '1,2']).id
      renameRoom(tx, map, roomA, 'Crateria')
      renameRoom(tx, map, roomB, 'Norfair')
      line = ok(
        createLine(tx, map, ['5,5', '6,5'], {
          color: '#ffcc00',
          arrowStart: false,
          arrowEnd: false,
        }),
      ).id
    })
    model.run('Area', PROJECT_SCOPE, (tx) => {
      brinstar = createNewArea(tx, model.project, 'Brinstar', '#3355aa', '#112244').id
    })

    return { mapId, roomA, roomB, line, brinstar }
  }

  function mountPanel() {
    wrapper = mount(InspectorPanel, { attachTo: document.body })
    return wrapper
  }

  function selectRoom(mapId: MapId, roomId: RoomId) {
    useSelectionStore().set([{ kind: 'room', id: roomId }], mapId)
  }

  function room(mapId: MapId, roomId: RoomId) {
    return useModelStore().project.mapsById.get(mapId)!.rooms.get(roomId)!
  }

  describe('the four states', () => {
    it('shows nothing at all when the selection is empty', () => {
      setup()
      const panel = mountPanel()
      expect(panel.text()).toBe('')
      expect(panel.find('.inspector-fields').exists()).toBe(false)
    })

    it('shows one object per kind it has a panel for', async () => {
      const { mapId, roomA } = setup()
      const panel = mountPanel()
      selectRoom(mapId, roomA)
      await nextTick()
      expect(panel.find('.inspector-fields').exists()).toBe(true)
    })

    it('shows a count for two or more objects, and no fields', async () => {
      const { mapId, roomA, roomB } = setup()
      const panel = mountPanel()
      useSelectionStore().set(
        [
          { kind: 'room', id: roomA },
          { kind: 'room', id: roomB },
        ],
        mapId,
      )
      await nextTick()
      expect(panel.text()).toContain('2 selected')
      expect(panel.find('.inspector-fields').exists()).toBe(false)
    })

    it('counts a mixture of kinds too', async () => {
      const { mapId, roomA, line } = setup()
      const panel = mountPanel()
      useSelectionStore().set(
        [
          { kind: 'room', id: roomA },
          { kind: 'line', id: line },
        ],
        mapId,
      )
      await nextTick()
      expect(panel.text()).toContain('2 selected')
    })

    it('renders nothing for a single object of a kind with no panel yet', async () => {
      const { mapId, line } = setup()
      const panel = mountPanel()
      useSelectionStore().set([{ kind: 'line', id: line }], mapId)
      await nextTick()
      expect(panel.text()).toBe('')
    })
  })

  describe('cells are counted, never inspected', () => {
    it('says "1 cell selected" for a single cell rather than showing fields', async () => {
      const { mapId } = setup()
      const panel = mountPanel()
      useSelectionStore().set([{ kind: 'cell', id: '0,0' }], mapId)
      await nextTick()
      expect(panel.text()).toContain('1 cell selected')
      expect(panel.find('.inspector-fields').exists()).toBe(false)
    })

    it('counts several cells', async () => {
      const { mapId } = setup()
      const panel = mountPanel()
      useSelectionStore().set(
        [
          { kind: 'cell', id: '0,0' },
          { kind: 'cell', id: '1,0' },
        ],
        mapId,
      )
      await nextTick()
      expect(panel.text()).toContain('2 cells selected')
    })

    it('falls back to the plain count when cells are mixed with an object', async () => {
      const { mapId, roomA } = setup()
      const panel = mountPanel()
      useSelectionStore().set(
        [
          { kind: 'cell', id: '0,0' },
          { kind: 'room', id: roomA },
        ],
        mapId,
      )
      await nextTick()
      expect(panel.text()).toContain('2 selected')
      expect(panel.text()).not.toContain('cell')
    })
  })

  describe('a selection belongs to the tab it was made on', () => {
    it('shows nothing for a selection left on another tab', async () => {
      const { mapId, roomA } = setup()
      const tabs = useTabsStore()
      const panel = mountPanel()
      selectRoom(mapId, roomA)
      await nextTick()

      tabs.addTab()
      await nextTick()
      expect(panel.text()).toBe('')
      expect(panel.find('.inspector-fields').exists()).toBe(false)
    })
  })

  describe('the Room panel', () => {
    async function mountWithRoom() {
      const fixture = setup()
      const panel = mountPanel()
      selectRoom(fixture.mapId, fixture.roomA)
      await nextTick()
      return { ...fixture, panel }
    }

    it('shows the room name, notes and area', async () => {
      const { panel, mapId, roomA } = await mountWithRoom()
      const name = panel.get('#inspector-room-name').element as HTMLInputElement
      const area = panel.get('#inspector-room-area').element as HTMLSelectElement
      expect(name.value).toBe(room(mapId, roomA).name)
      expect(area.value).toBe(WORLD_AREA_ID)
    })

    it('commits a rename on Enter, as one undo step', async () => {
      const { panel, mapId, roomA } = await mountWithRoom()
      const model = useModelStore()
      const before = model.status.canUndo

      const name = panel.get('#inspector-room-name')
      await name.setValue('Landing Site')
      await name.trigger('keydown.enter')

      expect(room(mapId, roomA).name).toBe('Landing Site')
      expect(before).toBe(true)
      model.undo()
      expect(room(mapId, roomA).name).not.toBe('Landing Site')
    })

    it('commits a rename on blur', async () => {
      const { panel, mapId, roomA } = await mountWithRoom()
      const name = panel.get('#inspector-room-name')
      await name.setValue('Brinstar Entry')
      await name.trigger('blur')
      expect(room(mapId, roomA).name).toBe('Brinstar Entry')
    })

    it('abandons a blank name rather than erasing it', async () => {
      const { panel, mapId, roomA } = await mountWithRoom()
      const original = room(mapId, roomA).name

      const name = panel.get('#inspector-room-name')
      await name.setValue('   ')
      await name.trigger('blur')

      expect(room(mapId, roomA).name).toBe(original)
    })

    it('abandons the edit on Escape and shows the stored name again', async () => {
      const { panel, mapId, roomA } = await mountWithRoom()
      const original = room(mapId, roomA).name

      const name = panel.get('#inspector-room-name')
      await name.setValue('Discarded')
      await name.trigger('keydown.esc')
      await name.trigger('blur')

      expect(room(mapId, roomA).name).toBe(original)
      expect((name.element as HTMLInputElement).value).toBe(original)
    })

    it('leaves no undo entry when the field is committed unchanged', async () => {
      const { panel, mapId, roomA } = await mountWithRoom()
      const model = useModelStore()
      const label = model.status.undoLabel

      const name = panel.get('#inspector-room-name')
      await name.setValue(room(mapId, roomA).name)
      await name.trigger('blur')

      expect(model.status.undoLabel).toBe(label)
    })

    it('commits notes on blur, and accepts an empty value', async () => {
      const { panel, mapId, roomA } = await mountWithRoom()
      const notes = panel.get('#inspector-room-notes')

      await notes.setValue('Missile behind the wall')
      await notes.trigger('blur')
      expect(room(mapId, roomA).notes).toBe('Missile behind the wall')

      await notes.setValue('')
      await notes.trigger('blur')
      expect(room(mapId, roomA).notes).toBe('')
    })

    it('reassigns the area immediately on change', async () => {
      const { panel, mapId, roomA, brinstar } = await mountWithRoom()
      await panel.get('#inspector-room-area').setValue(brinstar)
      expect(room(mapId, roomA).areaId).toBe(brinstar)
    })

    it('lists World first among the areas', async () => {
      const { panel } = await mountWithRoom()
      const options = panel.get('#inspector-room-area').findAll('option')
      expect(options[0].element.value).toBe(WORLD_AREA_ID)
      expect(options).toHaveLength(2)
    })

    it('shows the area colour as a read-only swatch, not a control', async () => {
      const { panel, brinstar } = await mountWithRoom()
      await panel.get('#inspector-room-area').setValue(brinstar)
      await nextTick()

      const swatch = panel.get('.color-swatch')
      expect(swatch.attributes('style')).toContain('rgb(51, 85, 170)')
      expect(swatch.element.tagName).toBe('SPAN')
      expect(swatch.attributes('title')).toBeTruthy()
    })

    // The panel reads plain core objects, which Vue cannot observe. Every one
    // of these changes the model without touching the field, so a binding that
    // subscribes to nothing fails them rather than passing on a coincidence.
    it('shows a rename made anywhere else', async () => {
      const { panel, mapId, roomA } = await mountWithRoom()
      const model = useModelStore()

      model.run('Elsewhere', mapScope(mapId), (tx) =>
        renameRoom(tx, model.project.mapsById.get(mapId)!, roomA, 'Renamed elsewhere'),
      )
      await nextTick()

      expect((panel.get('#inspector-room-name').element as HTMLInputElement).value).toBe(
        'Renamed elsewhere',
      )
    })

    it('shows notes written anywhere else', async () => {
      const { panel, mapId, roomA } = await mountWithRoom()
      const model = useModelStore()

      model.run('Elsewhere', mapScope(mapId), (tx) =>
        setRoomNotes(tx, model.project.mapsById.get(mapId)!, roomA, 'From elsewhere'),
      )
      await nextTick()

      expect((panel.get('#inspector-room-notes').element as HTMLTextAreaElement).value).toBe(
        'From elsewhere',
      )
    })

    it('reverts the displayed name when the rename is undone', async () => {
      const { panel, mapId, roomA } = await mountWithRoom()
      const model = useModelStore()
      const name = panel.get('#inspector-room-name')

      await name.setValue('Typed')
      await name.trigger('keydown.enter')
      await nextTick()
      expect((name.element as HTMLInputElement).value).toBe('Typed')

      model.undo()
      await nextTick()
      expect((name.element as HTMLInputElement).value).toBe('Crateria')
      expect(room(mapId, roomA).name).toBe('Crateria')
    })

    it('shows an area reassignment made anywhere else, swatch included', async () => {
      const { panel, mapId, roomA, brinstar } = await mountWithRoom()
      const model = useModelStore()

      model.run('Elsewhere', mapScope(mapId), (tx) =>
        assignRoomArea(tx, model.project.mapsById.get(mapId)!, roomA, brinstar),
      )
      await nextTick()

      expect((panel.get('#inspector-room-area').element as HTMLSelectElement).value).toBe(brinstar)
      expect(panel.get('.color-swatch').attributes('style')).toContain('rgb(51, 85, 170)')
    })

    it('re-seeds its fields when the selection moves to another room', async () => {
      const { panel, mapId, roomA, roomB } = await mountWithRoom()
      const name = panel.get('#inspector-room-name')
      await name.setValue('Half typed')

      selectRoom(mapId, roomB)
      await nextTick()

      const reseeded = panel.get('#inspector-room-name').element as HTMLInputElement
      expect(reseeded.value).toBe(room(mapId, roomB).name)
      expect(room(mapId, roomA).name).not.toBe('Half typed')
    })
  })
})
