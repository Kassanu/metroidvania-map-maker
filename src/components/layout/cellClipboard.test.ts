import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import CanvasRegion from './CanvasRegion.vue'
import { runAction } from '@/hotkeys/actions'
import { mapScope, useModelStore } from '@/stores/model'
import { useClipboardStore } from '@/stores/clipboard'
import { useModeStore } from '@/stores/mode'
import { useSelectionStore } from '@/stores/selection'
import { useTabsStore } from '@/stores/tabs'
import { useToolsStore } from '@/stores/tools'
import { drawInnerWall, paintCells, renameRoom } from '@/core/ops/rooms'
import { placeIcon } from '@/core/ops/markup'
import { createNewArea } from '@/core/ops/project'
import { createFromBox } from '@/core/ops/doors'
import { WORLD_AREA_ID } from '@/core/ids'
import { TEST_ICON_COLORS, checkInvariants, ok, sorted } from '@/core/testUtils'
import type { CellKey } from '@/core/cell'
import type { AreaId, IconId, MapId, RoomId, TransitionId } from '@/core/ids'
import type { MapModel, ObjectRef, Room } from '@/core/types'

// Select mode at the Cells granularity: what `Delete` means there, and the four
// clipboard verbs, driven through their action ids against a mounted canvas.
//
// Cells and Rooms are two granularities on one set of keys, so every test states
// which one is live. Where a paste lands depends on the pointer, so a test that
// means "aimed at this cell" moves it and one that means "unaimed" leaves the
// canvas first.

describe('Select mode, Cells granularity: Delete and the clipboard verbs', () => {
  let mounted: ReturnType<typeof mount> | null = null

  beforeEach(() => {
    setActivePinia(createTestPinia())
    useModeStore().setMode('select')
  })

  afterEach(() => {
    mounted?.unmount()
    mounted = null
  })

  // Handler registration is module-global and last-wins, so exactly one mount
  // per test.
  async function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    mounted = wrapper
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    viewport.setPointerCapture = () => {}
    await nextTick()
    return { wrapper, viewport }
  }

  // World coordinates. Integers land on cell boundaries, so (1.5, 0.5) is the
  // centre of cell (1, 0).
  async function movePointerTo(viewport: HTMLElement, x: number, y: number) {
    const tabs = useTabsStore()
    const tile = useModelStore().tileSize
    const camera = tabs.cameraOf(tabs.activeTabId)
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

  function activeMap(): MapModel {
    const model = useModelStore()
    return model.project.mapsById.get(useTabsStore().activeTabId)!
  }

  function undoLabel(): string | null {
    return useModelStore().status.undoLabel
  }

  // Cell to owning room, sorted, for the "changed nothing" comparisons.
  function ownership(): [CellKey, RoomId][] {
    return [...activeMap().cellOwner.entries()].sort()
  }

  function roomAt(cell: CellKey): Room | undefined {
    const map = activeMap()
    const roomId = map.cellOwner.get(cell)
    return roomId === undefined ? undefined : map.rooms.get(roomId)
  }

  function roomIds(): RoomId[] {
    return [...activeMap().rooms.keys()].sort()
  }

  function roomsAddedSince(before: RoomId[]): Room[] {
    const map = activeMap()
    const known = new Set(before)
    return [...map.rooms.values()].filter((room) => !known.has(room.id))
  }

  function granularity(mode: 'rooms' | 'cells'): void {
    useToolsStore().setSelectSubMode(mode)
  }

  function selectRefs(refs: ObjectRef[]): void {
    useSelectionStore().set(refs, useTabsStore().activeTabId)
  }

  function selectCells(cells: CellKey[]): void {
    selectRefs(cells.map((id) => ({ kind: 'cell' as const, id })))
  }

  function selectedCells(): CellKey[] {
    return sorted(useSelectionStore().cellsOn(useTabsStore().activeTabId))
  }

  interface Fixture {
    mapId: MapId
    strip: RoomId
    single: RoomId
    cave: AreaId
    caveRoom: RoomId
    vault: RoomId
    occupied: RoomId
    icon: IconId
  }

  // One map holding every shape the rules need. Rows 6 and below are bare grid,
  // which is where the aimed pastes land.
  //
  //   row 0  "Room 1"  (0,0)(1,0)(2,0)   erasing (1,0) splits it in two
  //   row 0  "Vault"   (3,0)(4,0)(5,0)   icon on (3,0); inner walls at 4,0,V
  //                                      (inside a two-cell copy) and 5,0,V
  //                                      (straddling that copy's boundary)
  //   row 0  occupied  (10,0)(11,0)      a landing site already in use
  //   row 2  single    (0,2)             erasing it destroys the room
  //   row 4  caveRoom  (0,4)(1,4)        in an area other than World
  function fixture(): Fixture {
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    return model.run('Setup', mapScope(mapId), (tx) => {
      const project = model.project
      const map = project.mapsById.get(mapId)!
      const paint = (cells: CellKey[], areaId: AreaId = WORLD_AREA_ID) =>
        paintCells(tx, project, map, cells, { areaId })

      const strip = paint(['0,0', '1,0', '2,0'])
      renameRoom(tx, map, strip.id, 'Room 1')

      const vault = paint(['3,0', '4,0', '5,0'])
      renameRoom(tx, map, vault.id, 'Vault')
      ok(drawInnerWall(tx, map, vault.id, '4,0,V', 'solid'))
      ok(drawInnerWall(tx, map, vault.id, '5,0,V', 'solid'))
      const icon = ok(placeIcon(tx, map, '3,0', 'save', TEST_ICON_COLORS))

      const occupied = paint(['10,0', '11,0'])
      const single = paint(['0,2'])
      const cave = createNewArea(tx, project, 'Cave', '#20303a', '#88a0b0')
      const caveRoom = paint(['0,4', '1,4'], cave.id)

      return {
        mapId,
        strip: strip.id,
        single: single.id,
        cave: cave.id,
        caveRoom: caveRoom.id,
        vault: vault.id,
        occupied: occupied.id,
        icon: icon.id,
      }
    })
  }

  // An edge door between "Room 1" and "Vault", for the rule that a transition
  // never travels. Created per test rather than in the fixture, so the tests
  // that erase cells are not also exercising the door cascade.
  function addDoor(): TransitionId {
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    return model.run('Add Transition', mapScope(mapId), (tx) => {
      const map = model.project.mapsById.get(mapId)!
      return ok(createFromBox(tx, model.project, map, '2,0', '3,0'))[0].id
    })
  }

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  describe('Delete', () => {
    it('erases the selected cells back to bare grid and keeps the room', async () => {
      await mountCanvas()
      const { strip } = fixture()
      granularity('cells')
      selectCells(['0,0'])

      runAction('deleteSelection')

      const map = activeMap()
      expect(map.rooms.has(strip)).toBe(true)
      expect(sorted(map.rooms.get(strip)!.cells)).toEqual(['1,0', '2,0'])
      expect(map.cellOwner.has('0,0')).toBe(false)
      expect(undoLabel()).toBe('Erase Cells')
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    it('splits a room in two when the erase disconnects it', async () => {
      await mountCanvas()
      fixture()
      granularity('cells')
      selectCells(['1,0'])

      runAction('deleteSelection')

      const map = activeMap()
      expect(map.cellOwner.has('1,0')).toBe(false)
      expect(map.rooms.size).toBe(6)
      expect(roomAt('0,0')).toBeDefined()
      expect(roomAt('2,0')).toBeDefined()
      expect(roomAt('0,0')!.id).not.toBe(roomAt('2,0')!.id)
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    it('destroys a room whose last cell is erased', async () => {
      await mountCanvas()
      const { single } = fixture()
      granularity('cells')
      selectCells(['0,2'])

      runAction('deleteSelection')

      const map = activeMap()
      expect(map.rooms.has(single)).toBe(false)
      expect(map.rooms.size).toBe(4)
      expect(map.cellOwner.has('0,2')).toBe(false)
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    it('deletes the objects the selection holds at the Rooms granularity', async () => {
      await mountCanvas()
      const { strip } = fixture()
      granularity('rooms')
      selectRefs([{ kind: 'room', id: strip }])

      runAction('deleteSelection')

      const map = activeMap()
      expect(map.rooms.has(strip)).toBe(false)
      expect(map.cellOwner.has('0,0')).toBe(false)
      expect(map.cellOwner.has('1,0')).toBe(false)
      expect(map.cellOwner.has('2,0')).toBe(false)
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    it('does nothing with an empty selection, in either granularity', async () => {
      await mountCanvas()
      fixture()
      const before = ownership()
      granularity('cells')
      useSelectionStore().clear()

      runAction('deleteSelection')

      expect(ownership()).toEqual(before)
      expect(undoLabel()).toBe('Setup')

      // Switching granularity clears the selection, so this half starts empty too.
      granularity('rooms')
      runAction('deleteSelection')

      expect(ownership()).toEqual(before)
      expect(undoLabel()).toBe('Setup')
    })
  })

  // -------------------------------------------------------------------------
  // Copy
  // -------------------------------------------------------------------------

  describe('Copy', () => {
    it('puts the selected cells on the clipboard, offset from their origin', async () => {
      await mountCanvas()
      fixture()
      granularity('cells')
      selectCells(['3,0', '4,0'])

      runAction('copy')

      const payload = useClipboardStore().payload
      expect(sorted(payload.cells)).toEqual(['0,0', '1,0'])
      expect(payload.sourceOrigin).toEqual({ x: 3, y: 0 })
      expect(useClipboardStore().isEmpty).toBe(false)
    })

    it('carries an icon standing on a copied cell', async () => {
      await mountCanvas()
      fixture()
      granularity('cells')
      selectCells(['3,0', '4,0'])

      runAction('copy')

      expect(useClipboardStore().payload.icons).toEqual([
        {
          cell: '0,0',
          iconType: 'save',
          plateColor: TEST_ICON_COLORS.plateColor,
          glyphColor: TEST_ICON_COLORS.glyphColor,
          label: '',
          notes: '',
        },
      ])
    })

    it('carries an inner wall inside the region but not one straddling its boundary', async () => {
      await mountCanvas()
      fixture()
      granularity('cells')
      selectCells(['3,0', '4,0'])

      runAction('copy')

      // 4,0,V sits between the two copied cells; 5,0,V has only one of its cells
      // in the copy, so it is a boundary of the fragment rather than content.
      expect(useClipboardStore().payload.innerWalls).toEqual([{ edge: '1,0,V', style: 'solid' }])
    })

    it('carries no room identity', async () => {
      await mountCanvas()
      fixture()
      granularity('cells')
      selectCells(['3,0', '4,0'])

      runAction('copy')

      const payload = useClipboardStore().payload
      expect(payload.fromRooms).toBe(false)
      expect(payload.rooms.some((room) => room.name === 'Vault')).toBe(false)
    })

    it('changes no model and leaves no undo step', async () => {
      await mountCanvas()
      fixture()
      const before = ownership()
      granularity('cells')
      selectCells(['3,0', '4,0'])

      runAction('copy')

      expect(ownership()).toEqual(before)
      expect(activeMap().icons.size).toBe(1)
      expect(undoLabel()).toBe('Setup')
    })

    it('leaves the clipboard alone for a selection holding nothing copyable', async () => {
      await mountCanvas()
      const { icon } = fixture()
      const door = addDoor()
      granularity('cells')
      selectCells(['3,0', '4,0'])
      runAction('copy')
      const held = useClipboardStore().payload

      // A transition is never copied, and an icon travels as content on a cell
      // rather than on its own, so this selection has no payload at all.
      selectRefs([
        { kind: 'icon', id: icon },
        { kind: 'transition', id: door },
      ])
      runAction('copy')

      expect(useClipboardStore().payload).toBe(held)
    })
  })

  // -------------------------------------------------------------------------
  // Cut
  // -------------------------------------------------------------------------

  describe('Cut', () => {
    it('copies the cells and erases them in one step', async () => {
      await mountCanvas()
      const { vault } = fixture()
      granularity('cells')
      selectCells(['5,0'])

      runAction('cut')

      const map = activeMap()
      expect(map.cellOwner.has('5,0')).toBe(false)
      expect(sorted(map.rooms.get(vault)!.cells)).toEqual(['3,0', '4,0'])
      expect(sorted(useClipboardStore().payload.cells)).toEqual(['0,0'])
      expect(undoLabel()).toBe('Cut')
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    it('restores the cells to the room they left on one undo', async () => {
      await mountCanvas()
      const { vault } = fixture()
      granularity('cells')
      selectCells(['5,0'])
      runAction('cut')

      useModelStore().undo()

      const map = activeMap()
      expect(map.cellOwner.get('5,0')).toBe(vault)
      expect(sorted(map.rooms.get(vault)!.cells)).toEqual(['3,0', '4,0', '5,0'])
      expect(undoLabel()).toBe('Setup')
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // Paste
  // -------------------------------------------------------------------------

  describe('Paste', () => {
    it('makes a whole new room from the fragment, with its icon and inner wall', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      granularity('cells')
      selectCells(['3,0', '4,0'])
      runAction('copy')
      const before = roomIds()

      await movePointerTo(viewport, 0.5, 8.5)
      runAction('paste')

      const map = activeMap()
      const added = roomsAddedSince(before)
      expect(added).toHaveLength(1)
      expect(sorted(added[0].cells)).toEqual(['0,8', '1,8'])
      expect([...added[0].innerWalls.keys()]).toEqual(['1,8,V'])
      expect(map.icons.get(map.iconAtCell.get('0,8')!)?.iconType).toBe('save')
      expect(undoLabel()).toBe('Paste')
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    it('makes one room per connected group, named from the lowest free numbers', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      granularity('cells')
      // Two cells of one room that are not adjacent to each other: the payload
      // carries no identity, so connectivity alone decides how many rooms land.
      selectCells(['0,0', '2,0'])
      runAction('copy')
      const before = roomIds()

      await movePointerTo(viewport, 0.5, 8.5)
      runAction('paste')

      const added = roomsAddedSince(before)
      expect(added).toHaveLength(2)
      expect(sorted(added.flatMap((room) => [...room.cells]))).toEqual(['0,8', '2,8'])
      // "Room 1" is taken by the fixture, so numbering starts at 2.
      expect(added.map((room) => room.name).sort()).toEqual(['Room 2', 'Room 3'])
    })

    it('fills the lowest free number rather than counting past the highest', async () => {
      const { viewport } = await mountCanvas()
      const { mapId, occupied } = fixture()
      const model = useModelStore()
      model.run('Rename Room', mapScope(mapId), (tx) => {
        renameRoom(tx, activeMap(), occupied, 'Room 3')
      })
      granularity('cells')
      selectCells(['3,0', '4,0'])
      runAction('copy')
      const before = roomIds()

      await movePointerTo(viewport, 0.5, 8.5)
      runAction('paste')

      const added = roomsAddedSince(before)
      expect(added).toHaveLength(1)
      expect(added[0].name).toBe('Room 2')
    })

    it('keeps the fragment naming convention after switching to Rooms', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      granularity('cells')
      selectCells(['3,0', '4,0'])
      runAction('copy')
      const before = roomIds()

      // The convention follows what was copied. A fragment has no identity to
      // derive a name from, whatever granularity is live when it lands.
      granularity('rooms')
      await movePointerTo(viewport, 0.5, 8.5)
      runAction('paste')

      const added = roomsAddedSince(before)
      expect(added).toHaveLength(1)
      expect(added[0].name).toBe('Room 2')
    })

    it('keeps a whole-room payload named after its source, in Cells', async () => {
      const { viewport } = await mountCanvas()
      const { strip } = fixture()
      granularity('rooms')
      selectRefs([{ kind: 'room', id: strip }])
      runAction('copy')
      const before = roomIds()

      granularity('cells')
      await movePointerTo(viewport, 0.5, 8.5)
      runAction('paste')
      await movePointerTo(viewport, 0.5, 10.5)
      runAction('paste')

      const added = roomsAddedSince(before)
      expect(added.map((room) => room.name).sort()).toEqual(['Room 1 copy', 'Room 1 copy 2'])
    })

    it('lands the pasted cells in the area they were copied from', async () => {
      const { viewport } = await mountCanvas()
      const { cave } = fixture()
      granularity('cells')
      selectCells(['0,4', '1,4'])
      runAction('copy')
      const before = roomIds()

      await movePointerTo(viewport, 0.5, 8.5)
      runAction('paste')

      const added = roomsAddedSince(before)
      expect(added).toHaveLength(1)
      expect(added[0].areaId).toBe(cave)
    })

    it('lands the payload origin on the cell under the pointer', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      granularity('cells')
      selectCells(['3,0', '4,0'])
      runAction('copy')
      const before = roomIds()

      await movePointerTo(viewport, 6.5, 8.5)
      runAction('paste')

      const added = roomsAddedSince(before)
      expect(added).toHaveLength(1)
      expect(sorted(added[0].cells)).toEqual(['6,8', '7,8'])
    })

    it('lands clear of the source when the pointer is off the canvas', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      granularity('cells')
      selectCells(['3,0', '4,0'])
      runAction('copy')
      const before = roomIds()

      await movePointerTo(viewport, 6.5, 8.5)
      await leaveCanvas(viewport)
      runAction('paste')

      // The payload's own width plus a one-cell gap, to the right of where it
      // was copied from: origin x 3, width 2, so x 6.
      const added = roomsAddedSince(before)
      expect(added).toHaveLength(1)
      expect(sorted(added[0].cells)).toEqual(['6,0', '7,0'])
    })

    it('overwrites whatever it lands on', async () => {
      const { viewport } = await mountCanvas()
      const { occupied } = fixture()
      granularity('cells')
      selectCells(['3,0', '4,0'])
      runAction('copy')
      const before = roomIds()

      await movePointerTo(viewport, 11.5, 0.5)
      runAction('paste')

      const map = activeMap()
      const added = roomsAddedSince(before)
      expect(added).toHaveLength(1)
      expect(map.cellOwner.get('11,0')).toBe(added[0].id)
      expect(map.cellOwner.get('12,0')).toBe(added[0].id)
      expect(sorted(map.rooms.get(occupied)!.cells)).toEqual(['10,0'])
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    it('selects the pasted cells rather than the rooms holding them', async () => {
      const { viewport } = await mountCanvas()
      const { mapId } = fixture()
      granularity('cells')
      selectCells(['3,0', '4,0'])
      runAction('copy')

      await movePointerTo(viewport, 6.5, 8.5)
      runAction('paste')
      await nextTick()

      expect(selectedCells()).toEqual(['6,8', '7,8'])
      expect(useSelectionStore().roomsOn(mapId)).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // Duplicate
  // -------------------------------------------------------------------------

  describe('Duplicate', () => {
    it('lands a copy of the cells clear of the source, without using the clipboard', async () => {
      await mountCanvas()
      fixture()
      granularity('cells')
      // Something already on the clipboard, so "does not touch it" is the
      // payload surviving rather than merely never being written.
      selectCells(['0,0'])
      runAction('copy')
      const held = useClipboardStore().payload
      selectCells(['3,0', '4,0'])
      const before = roomIds()

      runAction('duplicate')
      await nextTick()

      const added = roomsAddedSince(before)
      expect(added).toHaveLength(1)
      expect(sorted(added[0].cells)).toEqual(['6,0', '7,0'])
      expect(useClipboardStore().payload).toBe(held)
      expect(undoLabel()).toBe('Duplicate')
      expect(selectedCells()).toEqual(['6,0', '7,0'])
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    it('lands clear of the source wherever the pointer is', async () => {
      const { viewport } = await mountCanvas()
      fixture()
      granularity('cells')
      selectCells(['3,0', '4,0'])
      const before = roomIds()

      await movePointerTo(viewport, 0.5, 8.5)
      runAction('duplicate')

      const added = roomsAddedSince(before)
      expect(added).toHaveLength(1)
      expect(sorted(added[0].cells)).toEqual(['6,0', '7,0'])
    })
  })

  // -------------------------------------------------------------------------
  // Mode
  // -------------------------------------------------------------------------

  it('runs none of the four verbs outside Select mode', async () => {
    await mountCanvas()
    fixture()
    granularity('cells')
    selectCells(['3,0', '4,0'])
    runAction('copy')
    const held = useClipboardStore().payload
    const before = ownership()

    for (const mode of ['draw', 'door', 'markup'] as const) {
      useModeStore().setMode(mode)
      // A selection other than the one on the clipboard, so a copy that ran
      // anyway would be visible rather than idempotent.
      selectCells(['0,0'])
      runAction('copy')
      runAction('cut')
      runAction('paste')
      runAction('duplicate')
    }

    expect(useClipboardStore().payload).toBe(held)
    expect(ownership()).toEqual(before)
    expect(undoLabel()).toBe('Setup')
  })
})
