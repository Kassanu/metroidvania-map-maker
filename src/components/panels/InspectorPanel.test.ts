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
import { createNewArea, renameArea } from '@/core/ops/project'
import { createLine, placeIcon, setIconColors, setIconLabel, setLineStyle } from '@/core/ops/markup'
import { createFromBox, createTeleport, setLock } from '@/core/ops/doors'
import { ok } from '@/core/testUtils'
import { PROJECT_SCOPE } from '@/core/journal'
import { OPEN_LOCK_ID, WORLD_AREA_ID } from '@/core/ids'
import type { AreaId, IconId, LineId, LockTypeId, MapId, RoomId, TransitionId } from '@/core/ids'

// The one editable lock type the project ships with.
const LOCKED_LOCK_ID = 'locked' as LockTypeId
import type { CellKey } from '@/core/cell'
import type { ObjectRef } from '@/core/types'

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
    icon: IconId
    brinstar: AreaId
  }

  function setup(): Fixture {
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    let roomA!: RoomId
    let roomB!: RoomId
    let line!: LineId
    let icon!: IconId
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
      icon = ok(
        placeIcon(tx, map, '0,0', 'save', { plateColor: '#111111', glyphColor: '#222222' }),
      ).id
    })
    model.run('Area', PROJECT_SCOPE, (tx) => {
      brinstar = createNewArea(tx, model.project, 'Brinstar', '#3355aa', '#112244').id
    })

    return { mapId, roomA, roomB, line, icon, brinstar }
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

  function iconOf(mapId: MapId, iconId: IconId) {
    return useModelStore().project.mapsById.get(mapId)!.icons.get(iconId)!
  }

  function lineOf(mapId: MapId, lineId: LineId) {
    return useModelStore().project.mapsById.get(mapId)!.lines.get(lineId)!
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

    // Every kind the selection can hold now answers with something: five have
    // a panel and cells have a count. A kind that rendered nothing would be
    // indistinguishable from an empty selection.
    it('shows something for every kind a selection can hold', async () => {
      const { mapId, roomA, icon, line, brinstar } = setup()
      const model = useModelStore()
      let door!: TransitionId
      model.run('Door', mapScope(mapId), (tx) => {
        const map = model.project.mapsById.get(mapId)!
        paintCells(tx, model.project, map, ['2,0'], { areaId: WORLD_AREA_ID })
        door = ok(createFromBox(tx, model.project, map, '1,0', '2,0'))[0].id
      })
      const panel = mountPanel()

      const kinds: ObjectRef[] = [
        { kind: 'room', id: roomA },
        { kind: 'icon', id: icon },
        { kind: 'line', id: line },
        { kind: 'transition', id: door },
        { kind: 'area', id: brinstar },
      ]
      for (const ref of kinds) {
        useSelectionStore().set([ref], mapId)
        await nextTick()
        expect(panel.find('.inspector-fields').exists()).toBe(true)
      }

      useSelectionStore().set([{ kind: 'cell', id: '0,0' }], mapId)
      await nextTick()
      expect(panel.text()).toContain('1 cell selected')
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

  describe('the Icon panel', () => {
    async function mountWithIcon() {
      const fixture = setup()
      const panel = mountPanel()
      useSelectionStore().set([{ kind: 'icon', id: fixture.icon }], fixture.mapId)
      await nextTick()
      return { ...fixture, panel }
    }

    it("shows both of the icon's own fills", async () => {
      const { panel, mapId, icon } = await mountWithIcon()
      expect((panel.get('#inspector-icon-plate').element as HTMLInputElement).value).toBe(
        iconOf(mapId, icon).plateColor,
      )
      expect((panel.get('#inspector-icon-glyph').element as HTMLInputElement).value).toBe(
        iconOf(mapId, icon).glyphColor,
      )
    })

    it('recolours one fill without disturbing the other', async () => {
      const { panel, mapId, icon } = await mountWithIcon()
      const glyphBefore = iconOf(mapId, icon).glyphColor
      const field = panel.get('#inspector-icon-plate')

      ;(field.element as HTMLInputElement).value = '#abcdef'
      await field.trigger('change')

      expect(iconOf(mapId, icon).plateColor).toBe('#abcdef')
      expect(iconOf(mapId, icon).glyphColor).toBe(glyphBefore)
      expect(useModelStore().status.undoLabel).toBe('Change Icon Colors')
    })

    // The same rule ColorField exists for, asserted on the icon's swatches too:
    // dragging through the gamut must not fill the undo stack.
    it('ignores `input` from either swatch', async () => {
      const { panel, mapId, icon } = await mountWithIcon()
      const before = iconOf(mapId, icon).glyphColor
      const field = panel.get('#inspector-icon-glyph')

      ;(field.element as HTMLInputElement).value = '#654321'
      await field.trigger('input')

      expect(iconOf(mapId, icon).glyphColor).toBe(before)
    })

    it('shows a recolour made anywhere else', async () => {
      const { panel, mapId, icon } = await mountWithIcon()
      const model = useModelStore()

      model.run('Elsewhere', mapScope(mapId), (tx) =>
        setIconColors(tx, model.project.mapsById.get(mapId)!, icon, {
          plateColor: '#0f0f0f',
          glyphColor: '#f0f0f0',
        }),
      )
      await nextTick()

      expect((panel.get('#inspector-icon-plate').element as HTMLInputElement).value).toBe('#0f0f0f')
      expect((panel.get('#inspector-icon-glyph').element as HTMLInputElement).value).toBe('#f0f0f0')
    })

    it('writes a label, and clears one', async () => {
      const { panel, mapId, icon } = await mountWithIcon()
      const field = panel.get('#inspector-icon-label')

      await field.setValue('Missile')
      await field.trigger('blur')
      expect(iconOf(mapId, icon).label).toBe('Missile')

      await field.setValue('')
      await field.trigger('blur')
      expect(iconOf(mapId, icon).label).toBe('')
    })

    it('shows a label written anywhere else', async () => {
      const { panel, mapId, icon } = await mountWithIcon()
      const model = useModelStore()

      model.run('Elsewhere', mapScope(mapId), (tx) =>
        setIconLabel(tx, model.project.mapsById.get(mapId)!, icon, 'From elsewhere'),
      )
      await nextTick()

      expect((panel.get('#inspector-icon-label').element as HTMLInputElement).value).toBe(
        'From elsewhere',
      )
    })
  })

  describe('the Line panel', () => {
    async function mountWithLine() {
      const fixture = setup()
      const panel = mountPanel()
      useSelectionStore().set([{ kind: 'line', id: fixture.line }], fixture.mapId)
      await nextTick()
      return { ...fixture, panel }
    }

    it('shows the stored colour, arrows and label', async () => {
      const { panel, mapId, line } = await mountWithLine()
      expect((panel.get('#inspector-line-color').element as HTMLInputElement).value).toBe(
        lineOf(mapId, line).color,
      )
      expect((panel.get('#inspector-line-arrow-start').element as HTMLInputElement).checked).toBe(
        false,
      )
    })

    // The whole reason ColorField exists. A native picker fires `input` per
    // pixel of a drag through the gamut, and one undo entry per pixel is the
    // failure mode this rules out.
    it('ignores `input` from the colour picker and commits only on `change`', async () => {
      const { panel, mapId, line } = await mountWithLine()
      const model = useModelStore()
      const before = model.status.undoLabel
      const field = panel.get('#inspector-line-color')

      ;(field.element as HTMLInputElement).value = '#123456'
      await field.trigger('input')
      expect(lineOf(mapId, line).color).toBe('#ffcc00')
      expect(model.status.undoLabel).toBe(before)

      await field.trigger('change')
      expect(lineOf(mapId, line).color).toBe('#123456')
      expect(model.status.undoLabel).toBe('Change Line Color')
    })

    it('toggles each arrowhead independently', async () => {
      const { panel, mapId, line } = await mountWithLine()

      await panel.get('#inspector-line-arrow-end').setValue(true)
      expect(lineOf(mapId, line).arrowEnd).toBe(true)
      expect(lineOf(mapId, line).arrowStart).toBe(false)

      await panel.get('#inspector-line-arrow-start').setValue(true)
      expect(lineOf(mapId, line).arrowStart).toBe(true)
      expect(lineOf(mapId, line).arrowEnd).toBe(true)
    })

    it('writes a label and notes', async () => {
      const { panel, mapId, line } = await mountWithLine()

      const label = panel.get('#inspector-line-label')
      await label.setValue('Shortcut')
      await label.trigger('blur')
      expect(lineOf(mapId, line).label).toBe('Shortcut')

      const notes = panel.get('#inspector-line-notes')
      await notes.setValue('Needs the grapple')
      await notes.trigger('blur')
      expect(lineOf(mapId, line).notes).toBe('Needs the grapple')
    })

    it('shows a restyle made anywhere else', async () => {
      const { panel, mapId, line } = await mountWithLine()
      const model = useModelStore()

      model.run('Elsewhere', mapScope(mapId), (tx) =>
        setLineStyle(tx, model.project.mapsById.get(mapId)!, line, 'arrowEnd', true),
      )
      await nextTick()

      expect((panel.get('#inspector-line-arrow-end').element as HTMLInputElement).checked).toBe(
        true,
      )
    })
  })

  describe('the Transition panel', () => {
    function twoRooms() {
      const model = useModelStore()
      const mapId = useTabsStore().activeTabId
      model.run('Rooms', mapScope(mapId), (tx) => {
        const map = model.project.mapsById.get(mapId)!
        const paint = (cells: CellKey[], name: string) => {
          const room = paintCells(tx, model.project, map, cells, { areaId: WORLD_AREA_ID })
          renameRoom(tx, map, room.id, name)
          return room
        }
        paint(['0,0', '0,1'], 'West')
        paint(['1,0', '1,1'], 'East')
      })
      return mapId
    }

    function select(mapId: MapId, id: TransitionId) {
      useSelectionStore().set([{ kind: 'transition', id }], mapId)
    }

    async function mountWithDoor() {
      const mapId = twoRooms()
      const model = useModelStore()
      let door!: TransitionId
      model.run('Door', mapScope(mapId), (tx) => {
        const map = model.project.mapsById.get(mapId)!
        door = ok(createFromBox(tx, model.project, map, '0,0', '1,0'))[0].id
      })
      const panel = mountPanel()
      select(mapId, door)
      await nextTick()
      return { mapId, door, panel }
    }

    function transitionOf(mapId: MapId, id: TransitionId) {
      return useModelStore().project.mapsById.get(mapId)!.transitions.get(id)!
    }

    it('names the kind read-only, with no control to change it', async () => {
      const { panel } = await mountWithDoor()
      expect(panel.get('[data-testid="transition-kind"]').text()).toBe('Door')
      expect(panel.find('#inspector-transition-kind').exists()).toBe(false)
    })

    it('names both rooms, A first', async () => {
      const { panel } = await mountWithDoor()
      // A is the room the box drag started in.
      expect(panel.get('[data-testid="transition-end-a"]').text()).toBe('West')
      expect(panel.get('[data-testid="transition-end-b"]').text()).toBe('East')
    })

    it('carries no label field, unlike an icon or a line', async () => {
      const { panel } = await mountWithDoor()
      expect(panel.find('#inspector-transition-label').exists()).toBe(false)
    })

    it('starts synced, and sets both ends from one dropdown', async () => {
      const { panel, mapId, door } = await mountWithDoor()
      expect(
        (panel.get('#inspector-transition-lock-sync').element as HTMLInputElement).checked,
      ).toBe(true)

      await panel.get('#inspector-transition-lock').setValue(LOCKED_LOCK_ID)

      expect(transitionOf(mapId, door).locks).toEqual({ a: LOCKED_LOCK_ID, b: LOCKED_LOCK_ID })
      expect(useModelStore().status.undoLabel).toBe('Change Lock')
    })

    it('unsyncing offers a dropdown per end, and each sets only its own', async () => {
      const { panel, mapId, door } = await mountWithDoor()
      await panel.get('#inspector-transition-lock-sync').setValue(false)

      expect(panel.find('#inspector-transition-lock').exists()).toBe(false)
      await panel.get('#inspector-transition-lock-a').setValue(LOCKED_LOCK_ID)

      expect(transitionOf(mapId, door).locks).toEqual({ a: LOCKED_LOCK_ID, b: OPEN_LOCK_ID })
    })

    // The toggle makes its claim true rather than displaying it: one dropdown
    // over two different locks would show a value neither end has.
    it('re-syncing copies A onto B', async () => {
      const { panel, mapId, door } = await mountWithDoor()
      await panel.get('#inspector-transition-lock-sync').setValue(false)
      await panel.get('#inspector-transition-lock-b').setValue(LOCKED_LOCK_ID)
      expect(transitionOf(mapId, door).locks).toEqual({ a: OPEN_LOCK_ID, b: LOCKED_LOCK_ID })

      await panel.get('#inspector-transition-lock-sync').setValue(true)

      expect(transitionOf(mapId, door).locks).toEqual({ a: OPEN_LOCK_ID, b: OPEN_LOCK_ID })
    })

    it('opens unsynced when the two ends already differ', async () => {
      const { mapId, door } = await mountWithDoor()
      const model = useModelStore()
      model.run('Asymmetric', mapScope(mapId), (tx) =>
        setLock(tx, model.project, model.project.mapsById.get(mapId)!, door, 'b', LOCKED_LOCK_ID),
      )

      // A fresh mount, which is what selecting it again produces.
      wrapper?.unmount()
      const panel = mountPanel()
      select(mapId, door)
      await nextTick()

      expect(
        (panel.get('#inspector-transition-lock-sync').element as HTMLInputElement).checked,
      ).toBe(false)
      expect(panel.find('#inspector-transition-lock-a').exists()).toBe(true)
    })

    // The whole point of chunk 3's stored direction: picking B to A leaves A
    // and B exactly where they were.
    it('offers all three directions, and reversing moves nothing else', async () => {
      const { panel, mapId, door } = await mountWithDoor()
      const before = panel.get('[data-testid="transition-end-a"]').text()
      const field = panel.get('#inspector-transition-direction')
      expect(field.findAll('option').map((option) => option.element.value)).toEqual([
        'both',
        'aToB',
        'bToA',
      ])

      await field.setValue('bToA')

      expect(transitionOf(mapId, door).direction).toBe('bToA')
      expect((field.element as HTMLSelectElement).value).toBe('bToA')
      expect(panel.get('[data-testid="transition-end-a"]').text()).toBe(before)
      expect(useModelStore().status.undoLabel).toBe('Change Direction')
    })

    it('commits notes on blur', async () => {
      const { panel, mapId, door } = await mountWithDoor()
      const notes = panel.get('#inspector-transition-notes')
      await notes.setValue('Needs the ice beam')
      await notes.trigger('blur')
      expect(transitionOf(mapId, door).notes).toBe('Needs the ice beam')
    })

    it('falls back to a positional label for an unnamed room', async () => {
      const mapId = useTabsStore().activeTabId
      const model = useModelStore()
      let door!: TransitionId
      model.run('Rooms', mapScope(mapId), (tx) => {
        const map = model.project.mapsById.get(mapId)!
        paintCells(tx, model.project, map, ['0,0'], { areaId: WORLD_AREA_ID })
        paintCells(tx, model.project, map, ['1,0'], { areaId: WORLD_AREA_ID })
        door = ok(createFromBox(tx, model.project, map, '0,0', '1,0'))[0].id
      })
      const panel = mountPanel()
      select(mapId, door)
      await nextTick()

      expect(panel.get('[data-testid="transition-end-a"]').text()).toBe('Room at 0,0')
      expect(panel.get('[data-testid="transition-end-b"]').text()).toBe('Room at 1,0')
    })

    describe('a cross-tab teleport', () => {
      async function mountWithTeleport(from: 'origin' | 'destination') {
        const model = useModelStore()
        const tabs = useTabsStore()
        const originId = tabs.activeTabId
        tabs.addTab()
        const farId = tabs.activeTabId
        tabs.activate(originId)

        let teleport!: TransitionId
        model.run('Setup', mapScope(originId), (tx) => {
          const origin = model.project.mapsById.get(originId)!
          const far = model.project.mapsById.get(farId)!
          const here = paintCells(tx, model.project, origin, ['0,0'], { areaId: WORLD_AREA_ID })
          const there = paintCells(tx, model.project, far, ['5,5'], { areaId: WORLD_AREA_ID })
          renameRoom(tx, origin, here.id, 'Elevator Room')
          renameRoom(tx, far, there.id, 'Deep Cave')
          teleport = ok(
            createTeleport(
              tx,
              model.project,
              { mapId: originId, cell: '0,0' },
              { mapId: farId, cell: '5,5' },
            ),
          ).id
        })

        const viewing = from === 'origin' ? originId : farId
        tabs.activate(viewing)
        const panel = mountPanel()
        select(viewing, teleport)
        await nextTick()
        return { originId, farId, teleport, panel }
      }

      it('names the far end with the map it is on', async () => {
        const { panel } = await mountWithTeleport('origin')
        expect(panel.get('[data-testid="transition-end-a"]').text()).toBe('Elevator Room')
        expect(panel.get('[data-testid="transition-end-b"]').text()).toContain('Deep Cave')
        expect(panel.get('[data-testid="transition-end-b"]').text()).toContain('Map 2')
      })

      // The destination tab draws a marker rebuilt from the far-end index and
      // never holds the object, so every op here has to reach through
      // `resolveTransition` to the map that stores it.
      it('inspects and edits identically from the destination tab', async () => {
        const { panel, originId, teleport } = await mountWithTeleport('destination')

        expect(panel.get('[data-testid="transition-kind"]').text()).toBe('Teleport')
        // A stays A whichever tab is looking.
        expect(panel.get('[data-testid="transition-end-a"]').text()).toContain('Elevator Room')

        await panel.get('#inspector-transition-direction').setValue('bToA')

        const stored = useModelStore().project.mapsById.get(originId)!.transitions.get(teleport)!
        expect(stored.direction).toBe('bToA')
        expect(stored.kind === 'teleport' && stored.a.mapId).toBe(originId)
      })
    })
  })

  describe('the Area panel', () => {
    function areaOf(areaId: AreaId) {
      return useModelStore().project.areas.get(areaId)!
    }

    // `which` names the area to select rather than taking an id, because the
    // fixture has to be built before either id exists.
    async function mountWithArea(which: 'brinstar' | 'world') {
      const fixture = setup()
      const areaId = which === 'world' ? WORLD_AREA_ID : fixture.brinstar
      const panel = mountPanel()
      useSelectionStore().set([{ kind: 'area', id: areaId }], fixture.mapId)
      await nextTick()
      return { ...fixture, areaId, panel }
    }

    it('shows the name, both colours and the notes', async () => {
      const { panel } = await mountWithArea('brinstar')
      expect(panel.find('#inspector-area-name').exists()).toBe(true)
      expect(panel.find('#inspector-area-cell').exists()).toBe(true)
      expect(panel.find('#inspector-area-wall').exists()).toBe(true)
      expect(panel.find('#inspector-area-notes').exists()).toBe(true)
    })

    it('renames on Enter', async () => {
      const { panel, areaId } = await mountWithArea('brinstar')

      const name = panel.get('#inspector-area-name')
      await name.setValue('Norfair')
      await name.trigger('keydown.enter')

      expect(areaOf(areaId).name).toBe('Norfair')
      expect(useModelStore().status.undoLabel).toBe('Rename Area')
    })

    it('recolours one fill without disturbing the other', async () => {
      const { panel, areaId } = await mountWithArea('brinstar')
      const wallBefore = areaOf(areaId).wallColor

      const field = panel.get('#inspector-area-cell')
      ;(field.element as HTMLInputElement).value = '#abcdef'
      await field.trigger('change')

      expect(areaOf(areaId).cellColor).toBe('#abcdef')
      expect(areaOf(areaId).wallColor).toBe(wallBefore)
      expect(useModelStore().status.undoLabel).toBe('Recolor Area')
    })

    it('commits notes on blur', async () => {
      const { panel, areaId } = await mountWithArea('brinstar')
      const notes = panel.get('#inspector-area-notes')
      await notes.setValue('The green one')
      await notes.trigger('blur')
      expect(areaOf(areaId).notes).toBe('The green one')
    })

    // World is the guaranteed fallback for every room, so it is unchangeable by
    // construction rather than by the panel choosing to refuse.
    it('locks every World field, and says why', async () => {
      const { panel } = await mountWithArea('world')

      for (const id of [
        '#inspector-area-name',
        '#inspector-area-cell',
        '#inspector-area-wall',
        '#inspector-area-notes',
      ]) {
        const field = panel.get(id).element as HTMLInputElement
        expect(field.disabled).toBe(true)
        expect(field.title).toContain('World')
      }
      expect(panel.get('.inspector-note').text()).toContain('World')
    })

    // The disabled control and the op's own guard have to be one question. This
    // reaches past the control to check the second half is really there.
    it('refuses a World rename even when the control is bypassed', async () => {
      const { panel } = await mountWithArea('world')
      const before = areaOf(WORLD_AREA_ID).name

      const name = panel.get('#inspector-area-name')
      await name.setValue('Overworld')
      await name.trigger('keydown.enter')

      expect(areaOf(WORLD_AREA_ID).name).toBe(before)
    })

    it('shows a rename made anywhere else', async () => {
      const { panel, areaId } = await mountWithArea('brinstar')
      const model = useModelStore()

      model.run('Elsewhere', PROJECT_SCOPE, (tx) =>
        renameArea(tx, model.project, areaId, 'From elsewhere'),
      )
      await nextTick()

      expect((panel.get('#inspector-area-name').element as HTMLInputElement).value).toBe(
        'From elsewhere',
      )
    })
  })
})
