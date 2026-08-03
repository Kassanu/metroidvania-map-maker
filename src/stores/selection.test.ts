import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { useSelectionStore } from './selection'
import { mapScope, useModelStore, PROJECT_SCOPE } from './model'
import { useTabsStore } from './tabs'
import { paintCells, deleteRooms } from '@/core/ops/rooms'
import { addMap } from '@/core/ops/maps'
import { WORLD_AREA_ID } from '@/core/ids'
import type { RoomId, TransitionId } from '@/core/ids'

describe('useSelectionStore', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function paintRoom(cells: string[]) {
    const model = useModelStore()
    const mapId = model.project.maps[0]
    const room = model.run('Paint', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, model.project.mapsById.get(mapId)!, cells, {
        areaId: WORLD_AREA_ID,
      }),
    )
    return { model, mapId, room }
  }

  it('starts empty', () => {
    const selection = useSelectionStore()
    expect(selection.isEmpty).toBe(true)
    expect(selection.selected).toEqual([])
  })

  it('holds typed refs, not bare ids', () => {
    const selection = useSelectionStore()
    const { mapId, room } = paintRoom(['0,0'])
    selection.set([{ kind: 'room', id: room.id }], mapId)

    expect(selection.selected).toEqual([{ kind: 'room', id: room.id }])
    expect(selection.isSelected({ kind: 'room', id: room.id })).toBe(true)
    // Same string, different kind: not the same object.
    expect(selection.isSelected({ kind: 'icon', id: room.id as unknown as never })).toBe(false)
  })

  describe('toggle', () => {
    it('adds when absent and removes when present', () => {
      const selection = useSelectionStore()
      const { mapId, room } = paintRoom(['0,0'])
      const ref = { kind: 'room', id: room.id } as const

      selection.toggle(ref, mapId)
      expect(selection.selected).toHaveLength(1)
      selection.toggle(ref, mapId)
      expect(selection.isEmpty).toBe(true)
    })

    it('replaces rather than accumulating when the tab changed', () => {
      const selection = useSelectionStore()
      const model = useModelStore()
      const { mapId, room } = paintRoom(['0,0'])
      selection.set([{ kind: 'room', id: room.id }], mapId)

      const other = model.run('Add map', PROJECT_SCOPE, (tx) => addMap(tx, model.project, 'Caves'))
      const elsewhere = model.run('Paint', mapScope(other.id), (tx) =>
        paintCells(tx, model.project, other, ['0,0'], { areaId: WORLD_AREA_ID }),
      )

      selection.toggle({ kind: 'room', id: elsewhere.id }, other.id)
      expect(selection.selected).toEqual([{ kind: 'room', id: elsewhere.id }])
    })
  })

  // The click policy every mode routes through, as its four cases. A mode
  // supplies only the ref, so these four are the whole of what a click means.
  describe('clickSelect', () => {
    it('replaces on a plain click and clears on a plain miss', () => {
      const selection = useSelectionStore()
      const { mapId, room } = paintRoom(['0,0'])
      const other = paintRoom(['5,5']).room

      selection.clickSelect({ kind: 'room', id: room.id }, mapId, false)
      selection.clickSelect({ kind: 'room', id: other.id }, mapId, false)
      expect(selection.selected).toEqual([{ kind: 'room', id: other.id }])

      selection.clickSelect(null, mapId, false)
      expect(selection.isEmpty).toBe(true)
    })

    it('toggles on a shift-click', () => {
      const selection = useSelectionStore()
      const { mapId, room } = paintRoom(['0,0'])
      const other = paintRoom(['5,5']).room

      selection.clickSelect({ kind: 'room', id: room.id }, mapId, false)
      selection.clickSelect({ kind: 'room', id: other.id }, mapId, true)
      expect(selection.selected).toHaveLength(2)

      selection.clickSelect({ kind: 'room', id: room.id }, mapId, true)
      expect(selection.selected).toEqual([{ kind: 'room', id: other.id }])
    })

    // The one case that is not simply "toggle instead of replace": a stray
    // shift-click on bare grid would otherwise destroy the multi-selection it
    // is being used to build.
    it('leaves the selection alone on a shift-click that found nothing', () => {
      const selection = useSelectionStore()
      const { mapId, room } = paintRoom(['0,0'])

      selection.clickSelect({ kind: 'room', id: room.id }, mapId, false)
      selection.clickSelect(null, mapId, true)
      expect(selection.selected).toEqual([{ kind: 'room', id: room.id }])
    })
  })

  // What Draw mode draws its resize handles on.
  describe('soleRoomOn', () => {
    it('answers only for exactly one room, on the map asked about', () => {
      const selection = useSelectionStore()
      const model = useModelStore()
      const { mapId, room } = paintRoom(['0,0'])
      const second = paintRoom(['5,5']).room

      selection.set([{ kind: 'room', id: room.id }], mapId)
      expect(selection.soleRoomOn(mapId)).toBe(room.id)

      // Two rooms: resizing three at once is not a thing, so this is null
      // rather than the first of the list.
      selection.set(
        [
          { kind: 'room', id: room.id },
          { kind: 'room', id: second.id },
        ],
        mapId,
      )
      expect(selection.soleRoomOn(mapId)).toBeNull()

      // One object, wrong kind.
      selection.set([{ kind: 'transition', id: 'tr_x' as TransitionId }], mapId)
      expect(selection.soleRoomOn(mapId)).toBeNull()

      // One room, wrong map: a selection on another tab draws no handles here.
      const other = model.run('Add map', PROJECT_SCOPE, (tx) => addMap(tx, model.project, 'Caves'))
      selection.set([{ kind: 'room', id: room.id }], mapId)
      expect(selection.soleRoomOn(other.id)).toBeNull()
    })
  })

  // A selection can outlive what it points at. Rather than have every op that
  // can destroy an object also remember to prune (the version that eventually
  // misses one), anything that stops resolving is dropped after any change.
  describe('pruning', () => {
    it('drops a room deleted underneath it', () => {
      const selection = useSelectionStore()
      const { model, mapId, room } = paintRoom(['0,0'])
      selection.set([{ kind: 'room', id: room.id }], mapId)

      model.run('Delete', mapScope(mapId), (tx) =>
        deleteRooms(tx, model.project, model.project.mapsById.get(mapId)!, [room.id]),
      )

      expect(selection.isEmpty).toBe(true)
    })

    it('drops a room an undo took away, and does not resurrect it on redo', () => {
      const selection = useSelectionStore()
      const { model, mapId, room } = paintRoom(['0,0'])
      selection.set([{ kind: 'room', id: room.id }], mapId)

      // Undo the paint that created it.
      model.undo()
      expect(selection.isEmpty).toBe(true)

      model.redo()
      // The room is back, but it is not selected again: pruning is one-way.
      expect(model.project.mapsById.get(mapId)!.rooms.size).toBe(1)
      expect(selection.isEmpty).toBe(true)
    })

    it('keeps a selection the change did not touch', () => {
      const selection = useSelectionStore()
      const { model, mapId, room } = paintRoom(['0,0'])
      selection.set([{ kind: 'room', id: room.id }], mapId)

      model.run('Paint', mapScope(mapId), (tx) =>
        paintCells(tx, model.project, model.project.mapsById.get(mapId)!, ['5,5'], {
          areaId: WORLD_AREA_ID,
        }),
      )

      expect(selection.selected).toEqual([{ kind: 'room', id: room.id }])
    })

    it('clears when the whole project is swapped out', () => {
      const selection = useSelectionStore()
      const model = useModelStore()
      const tabs = useTabsStore()
      const { mapId, room } = paintRoom(['0,0'])
      selection.set([{ kind: 'room', id: room.id }], mapId)

      tabs.deleteTab(mapId)
      expect(selection.isEmpty).toBe(true)
      expect(model.project.maps).toHaveLength(1)
    })

    it('survives a change that names a room that never existed', () => {
      const selection = useSelectionStore()
      const { model, mapId } = paintRoom(['0,0'])
      selection.set([{ kind: 'room', id: 'room_ghost' as RoomId }], mapId)

      model.run('Paint', mapScope(mapId), (tx) =>
        paintCells(tx, model.project, model.project.mapsById.get(mapId)!, ['9,9'], {
          areaId: WORLD_AREA_ID,
        }),
      )

      expect(selection.isEmpty).toBe(true)
    })
  })

  it('clear() empties it', () => {
    const selection = useSelectionStore()
    const { mapId, room } = paintRoom(['0,0'])
    selection.set([{ kind: 'room', id: room.id }], mapId)
    selection.clear()
    expect(selection.isEmpty).toBe(true)
  })

  // `mapId` names which tab the selection belongs to, so a reader can tell
  // "selected here" from "selected on another tab".
  it('reports the map the selection was set on, as soon as it is set', () => {
    const selection = useSelectionStore()
    const { mapId, room } = paintRoom(['0,0'])

    expect(selection.mapId).toBeNull()
    selection.set([{ kind: 'room', id: room.id }], mapId)
    expect(selection.mapId).toBe(mapId)

    selection.clear()
    // Cleared items, but the tab it belonged to is still the answer until
    // something is selected somewhere else: `clear` empties the list, not the
    // slot's identity.
    expect(selection.mapId).toBe(mapId)
  })
})
