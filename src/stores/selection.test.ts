import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { useSelectionStore } from './selection'
import { mapScope, useModelStore, PROJECT_SCOPE } from './model'
import { useTabsStore } from './tabs'
import { paintCells, deleteRooms, eraseCells } from '@/core/ops/rooms'
import { addMap } from '@/core/ops/maps'
import { createFromBox } from '@/core/ops/doors'
import { placeIcon, createLine } from '@/core/ops/markup'
import { ok } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { ObjectRef } from '@/core/types'
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

  // Two rooms side by side with a door between them, an icon in one and a line
  // over both: one of every selectable kind, all real, so pruning judges them
  // the way it will in the app.
  //
  //   A A | B B      icon at 1,0      door on the 1,0 | 2,0 edge
  //   A A | B B      line 0,1 -> 3,1
  function populate() {
    const model = useModelStore()
    const mapId = model.project.maps[0]
    const map = model.project.mapsById.get(mapId)!
    return model.run('Populate', mapScope(mapId), (tx) => {
      const roomA = paintCells(tx, model.project, map, ['0,0', '1,0', '0,1', '1,1'], {
        areaId: WORLD_AREA_ID,
      })
      const roomB = paintCells(tx, model.project, map, ['2,0', '3,0', '2,1', '3,1'], {
        areaId: WORLD_AREA_ID,
      })
      const icon = ok(placeIcon(tx, map, '1,0', 'save', { plateColor: '#fff', glyphColor: '#000' }))
      const line = ok(
        createLine(tx, map, ['0,1', '1,1', '2,1', '3,1'], {
          color: '#f00',
          arrowStart: false,
          arrowEnd: false,
        }),
      )
      const [door] = ok(createFromBox(tx, model.project, map, '1,0', '2,0'))
      return { mapId, map, roomA, roomB, icon, line, door }
    })
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

  describe('addAll', () => {
    // Union, not toggle, which is the difference between a sweep and a click:
    // sweeping over something already selected leaves it selected.
    it('adds what is missing and leaves what is already there', () => {
      const selection = useSelectionStore()
      const { mapId, roomA, roomB } = populate()
      selection.set([{ kind: 'room', id: roomA.id }], mapId)

      selection.addAll(
        [
          { kind: 'room', id: roomA.id },
          { kind: 'room', id: roomB.id },
        ],
        mapId,
      )

      expect(selection.selected).toEqual([
        { kind: 'room', id: roomA.id },
        { kind: 'room', id: roomB.id },
      ])
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

      selection.addAll([{ kind: 'room', id: elsewhere.id }], other.id)

      expect(selection.selected).toEqual([{ kind: 'room', id: elsewhere.id }])
      expect(selection.mapId).toBe(other.id)
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

  // Per kind, per tab. The kind split is what lets a caller hand the answer
  // straight to an op; the tab split is what stops one tab's selection being
  // drawn on another's.
  describe('selectors', () => {
    it('splits a mixed selection by kind, in selection order', () => {
      const selection = useSelectionStore()
      const { mapId, roomA, roomB, icon, line, door } = populate()

      selection.set(
        [
          { kind: 'room', id: roomB.id },
          { kind: 'cell', id: '0,0' },
          { kind: 'icon', id: icon.id },
          { kind: 'room', id: roomA.id },
          { kind: 'line', id: line.id },
          { kind: 'transition', id: door.id },
          { kind: 'cell', id: '3,1' },
        ],
        mapId,
      )

      // Selection order, not id order: the list is what carries order and the
      // selectors only filter it.
      expect(selection.roomsOn(mapId)).toEqual([roomB.id, roomA.id])
      expect(selection.cellsOn(mapId)).toEqual(['0,0', '3,1'])
      expect(selection.iconsOn(mapId)).toEqual([icon.id])
      expect(selection.linesOn(mapId)).toEqual([line.id])
      expect(selection.transitionsOn(mapId)).toEqual([door.id])
    })

    it('survives a commit that touched none of it', () => {
      const selection = useSelectionStore()
      const model = useModelStore()
      const { mapId, map, roomA, icon, line, door } = populate()
      const all: ObjectRef[] = [
        { kind: 'room', id: roomA.id },
        { kind: 'cell', id: '0,0' },
        { kind: 'icon', id: icon.id },
        { kind: 'line', id: line.id },
        { kind: 'transition', id: door.id },
      ]
      selection.set([...all], mapId)

      model.run('Paint', mapScope(mapId), (tx) =>
        paintCells(tx, model.project, map, ['9,9'], { areaId: WORLD_AREA_ID }),
      )

      // Every kind resolved through `exists`, including the cell, which is the
      // one whose predicate is ownership rather than a lookup by id.
      expect(selection.selected).toEqual(all)
    })

    it('answers nothing for a map the selection is not on', () => {
      const selection = useSelectionStore()
      const model = useModelStore()
      const { mapId, roomA } = populate()
      selection.set(
        [
          { kind: 'room', id: roomA.id },
          { kind: 'cell', id: '0,0' },
        ],
        mapId,
      )

      // A second map that owns a cell of the same name. This is why the
      // selectors take a map at all: `0,0` is a valid cell on every map, so an
      // unguarded cell selector would report it selected here too.
      const other = model.run('Add map', PROJECT_SCOPE, (tx) => addMap(tx, model.project, 'Caves'))
      model.run('Paint', mapScope(other.id), (tx) =>
        paintCells(tx, model.project, other, ['0,0'], { areaId: WORLD_AREA_ID }),
      )

      expect(selection.cellsOn(other.id)).toEqual([])
      expect(selection.roomsOn(other.id)).toEqual([])
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

    // A cell's predicate is ownership, not existence: the coordinate is always
    // there, so what makes a selected cell stale is being erased back to bare
    // grid, where it can no longer be moved, cut or erased any further.
    it('drops a selected cell erased back to bare grid, and keeps the rest', () => {
      const selection = useSelectionStore()
      const model = useModelStore()
      const { mapId, map, roomA } = populate()
      selection.set(
        [
          { kind: 'cell', id: '0,0' },
          { kind: 'cell', id: '1,1' },
          { kind: 'room', id: roomA.id },
        ],
        mapId,
      )

      model.run('Erase', mapScope(mapId), (tx) => eraseCells(tx, model.project, map, ['0,0']))

      // The room lost a cell but not its life, so it stays selected.
      expect(selection.cellsOn(mapId)).toEqual(['1,1'])
      expect(selection.roomsOn(mapId)).toEqual([roomA.id])
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

  // `isSelected` reads an index rather than scanning the list, because it is
  // called per cell per draw and a marquee re-runs it on every pointer move.
  // The index is the same fact stored twice, so it is only safe while every
  // path that writes the list writes it too. Checked after each path rather
  // than once at the end: a path that drifts is invisible from any other one.
  it('answers isSelected exactly as a scan of the list would, on every path', () => {
    const selection = useSelectionStore()
    const model = useModelStore()
    const { mapId, map, roomA, roomB, icon } = populate()
    const probes: ObjectRef[] = [
      { kind: 'room', id: roomA.id },
      { kind: 'room', id: roomB.id },
      { kind: 'icon', id: icon.id },
      { kind: 'cell', id: '0,0' },
    ]

    function agrees() {
      for (const probe of probes) {
        const scanned = selection.selected.some(
          (item) => item.kind === probe.kind && item.id === probe.id,
        )
        expect(selection.isSelected(probe)).toBe(scanned)
      }
    }

    selection.set([{ kind: 'room', id: roomA.id }], mapId)
    agrees()
    selection.toggle({ kind: 'room', id: roomB.id }, mapId)
    agrees()
    selection.toggle({ kind: 'room', id: roomA.id }, mapId)
    agrees()
    selection.clickSelect({ kind: 'icon', id: icon.id }, mapId, true)
    agrees()
    selection.clickSelect({ kind: 'cell', id: '0,0' }, mapId, false)
    agrees()
    selection.addAll([{ kind: 'room', id: roomA.id }], mapId)
    agrees()

    // Pruning writes the list without anyone asking it to, which makes it the
    // path most likely to leave a stale index behind.
    model.run('Erase', mapScope(mapId), (tx) => eraseCells(tx, model.project, map, ['0,0']))
    agrees()
    expect(selection.isSelected({ kind: 'cell', id: '0,0' })).toBe(false)

    selection.clear()
    agrees()
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
