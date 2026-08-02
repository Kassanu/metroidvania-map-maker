import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { useActiveRoomStore } from './activeRoom'
import { useSelectionStore } from './selection'
import { mapScope, useModelStore } from './model'
import { paintCells, eraseCells } from '@/core/ops/rooms'
import { addMap } from '@/core/ops/maps'
import { WORLD_AREA_ID } from '@/core/ids'
import type { MapId, RoomId } from '@/core/ids'

describe('activeRoom store', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function firstMapId(): MapId {
    return useModelStore().project.maps[0]
  }

  function paint(mapId: MapId, cells: string[]): RoomId {
    const model = useModelStore()
    return model.run('Setup', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, model.project.mapsById.get(mapId)!, cells, {
        areaId: WORLD_AREA_ID,
      }),
    ).id
  }

  it('starts with nothing armed', () => {
    const active = useActiveRoomStore()
    expect(active.isArmed).toBe(false)
    expect(active.roomIdOn(firstMapId())).toBeNull()
  })

  it('arms and clears', () => {
    const active = useActiveRoomStore()
    const mapId = firstMapId()
    const roomId = paint(mapId, ['0,0'])

    active.arm(mapId, roomId)
    expect(active.isArmed).toBe(true)
    expect(active.roomIdOn(mapId)).toBe(roomId)

    active.clear()
    expect(active.isArmed).toBe(false)
    expect(active.roomIdOn(mapId)).toBeNull()
  })

  // Tagged with its map so handles for a room on another tab never draw on
  // this one.
  it('answers only for the map the room is on', () => {
    const model = useModelStore()
    const active = useActiveRoomStore()
    const mapId = firstMapId()
    const roomId = paint(mapId, ['0,0'])
    const otherId = model.run('Add', mapScope(mapId), (tx) => addMap(tx, model.project, 'Other')).id

    active.arm(mapId, roomId)

    expect(active.roomIdOn(mapId)).toBe(roomId)
    expect(active.roomIdOn(otherId)).toBeNull()
    // Still armed: it is just not armed here.
    expect(active.isArmed).toBe(true)
  })

  describe('pruning', () => {
    // Same argument as the selection's prune: having every op that can destroy
    // a room also clear this is the version that eventually misses one.
    it('drops a room that was erased away', () => {
      const model = useModelStore()
      const active = useActiveRoomStore()
      const mapId = firstMapId()
      const roomId = paint(mapId, ['0,0'])
      active.arm(mapId, roomId)

      model.run('Erase', mapScope(mapId), (tx) =>
        eraseCells(tx, model.project, model.project.mapsById.get(mapId)!, ['0,0']),
      )

      expect(active.isArmed).toBe(false)
    })

    it('drops a room that was absorbed by a merge', () => {
      const model = useModelStore()
      const active = useActiveRoomStore()
      const mapId = firstMapId()
      paint(mapId, ['0,0'])
      const victim = paint(mapId, ['2,0'])
      active.arm(mapId, victim)

      // Painting from the first room across the second absorbs it whole.
      model.run('Merge', mapScope(mapId), (tx) =>
        paintCells(tx, model.project, model.project.mapsById.get(mapId)!, ['0,0', '1,0', '2,0'], {
          intoRoomId: model.project.mapsById.get(mapId)!.cellOwner.get('0,0'),
          areaId: WORLD_AREA_ID,
        }),
      )

      expect(active.isArmed).toBe(false)
    })

    it('drops a room that undo removed', () => {
      const model = useModelStore()
      const active = useActiveRoomStore()
      const mapId = firstMapId()
      const roomId = paint(mapId, ['0,0'])
      active.arm(mapId, roomId)
      expect(active.isArmed).toBe(true)

      model.undo()

      expect(active.isArmed).toBe(false)
    })

    it('keeps a room that merely changed shape', () => {
      const model = useModelStore()
      const active = useActiveRoomStore()
      const mapId = firstMapId()
      const roomId = paint(mapId, ['0,0'])
      active.arm(mapId, roomId)

      model.run('Grow', mapScope(mapId), (tx) =>
        paintCells(tx, model.project, model.project.mapsById.get(mapId)!, ['1,0'], {
          intoRoomId: roomId,
          areaId: WORLD_AREA_ID,
        }),
      )

      expect(active.roomIdOn(mapId)).toBe(roomId)
    })
  })

  it('is independent of the selection', () => {
    const active = useActiveRoomStore()
    const selection = useSelectionStore()
    const mapId = firstMapId()
    const roomId = paint(mapId, ['0,0'])

    active.arm(mapId, roomId)
    expect(selection.isEmpty).toBe(true)

    selection.set([{ kind: 'room', id: roomId }], mapId)
    selection.clear()
    expect(active.roomIdOn(mapId)).toBe(roomId)
  })
})
