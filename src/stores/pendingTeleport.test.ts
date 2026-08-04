import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { usePendingTeleportStore } from './pendingTeleport'
import { useModeStore } from './mode'
import { mapScope, useModelStore, PROJECT_SCOPE } from './model'
import { paintCells, eraseCells } from '@/core/ops/rooms'
import { addMap, deleteMap } from '@/core/ops/maps'
import { createTeleport } from '@/core/ops/doors'
import { createNewLockType } from '@/core/ops/project'
import { useDoorDefaultsStore } from './doorDefaults'
import { checkInvariants } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { MapId } from '@/core/ids'
import type { Transition } from '@/core/types'

// The pending-teleport state machine, which is the whole of this file: pending
// is a UI state that commits nothing, a valid second click commits everything
// at once, an invalid one changes nothing at all, and three things cancel it.

describe('pendingTeleport store', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
    // Every route below is a Door-mode one, and the store cancels itself
    // anywhere else, so the mode has to be set or half these tests would be
    // asserting against a slot the mode watch had already emptied.
    useModeStore().setMode('door')
  })

  function firstMapId(): MapId {
    return useModelStore().project.maps[0]
  }

  function paint(mapId: MapId, cells: string[]) {
    const model = useModelStore()
    return model.run('Setup', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, model.project.mapsById.get(mapId)!, cells, {
        areaId: WORLD_AREA_ID,
      }),
    ).id
  }

  function addTab(name: string): MapId {
    const model = useModelStore()
    return model.run('Add Map', PROJECT_SCOPE, (tx) => addMap(tx, model.project, name)).id
  }

  function transitionsOn(mapId: MapId): Transition[] {
    return [...useModelStore().project.mapsById.get(mapId)!.transitions.values()]
  }

  // Two rooms on the first map, a cell apart.
  function twoRooms(): MapId {
    const mapId = firstMapId()
    paint(mapId, ['0,0'])
    paint(mapId, ['2,0'])
    return mapId
  }

  it('starts with nothing pending', () => {
    const pending = usePendingTeleportStore()
    expect(pending.isPending).toBe(false)
    expect(pending.originOn(firstMapId())).toBeNull()
  })

  it('commits nothing and adds no undo step on the first click', () => {
    const model = useModelStore()
    const pending = usePendingTeleportStore()
    const mapId = twoRooms()

    pending.start(mapId, '0,0')

    expect(pending.isPending).toBe(true)
    expect(pending.originOn(mapId)).toBe('0,0')
    expect(transitionsOn(mapId)).toEqual([])
    expect(model.status.undoLabel).toBe('Setup')
  })

  // Tagged with its map, so a pending origin on another tab draws nothing here.
  it('answers only for the map the origin is on', () => {
    const pending = usePendingTeleportStore()
    const mapId = twoRooms()
    const otherId = addTab('Other')

    pending.start(mapId, '0,0')

    expect(pending.originOn(mapId)).toBe('0,0')
    expect(pending.originOn(otherId)).toBeNull()
    // Still pending: it is just not pending here.
    expect(pending.isPending).toBe(true)
  })

  describe('completing', () => {
    it('makes a teleport between the two cells and clears the pending state', () => {
      const pending = usePendingTeleportStore()
      const mapId = twoRooms()

      pending.start(mapId, '0,0')
      pending.complete(mapId, '2,0')

      expect(pending.isPending).toBe(false)
      const [teleport] = transitionsOn(mapId)
      expect(teleport.kind).toBe('teleport')
      if (teleport.kind !== 'teleport') throw new Error('expected a teleport')
      expect([teleport.a.cell, teleport.b.cell]).toEqual(['0,0', '2,0'])
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    // A valid completion can land on the same tab or another; a cross-tab one
    // stores the teleport once, under its origin map.
    it('spans two tabs, storing the teleport under the origin map', () => {
      const model = useModelStore()
      const pending = usePendingTeleportStore()
      const mapId = firstMapId()
      paint(mapId, ['0,0'])
      const otherId = addTab('Caves')
      paint(otherId, ['4,3'])

      pending.start(mapId, '0,0')
      pending.complete(otherId, '4,3')

      expect(transitionsOn(mapId)).toHaveLength(1)
      // Nothing is duplicated on the destination map: its marker is rebuilt
      // from the project-scope far-end index.
      expect(transitionsOn(otherId)).toEqual([])
      expect(model.project.teleportFarEnds.size).toBe(1)
      expect(checkInvariants(model.project)).toEqual([])
    })

    it('lands as one undo step that removes the whole cross-tab teleport', () => {
      const model = useModelStore()
      const pending = usePendingTeleportStore()
      const mapId = firstMapId()
      paint(mapId, ['0,0'])
      const otherId = addTab('Caves')
      paint(otherId, ['4,3'])

      pending.start(mapId, '0,0')
      pending.complete(otherId, '4,3')
      expect(model.status.undoLabel).toBe('Add Teleport')

      model.undo()

      expect(transitionsOn(mapId)).toEqual([])
      expect(model.project.teleportFarEnds.size).toBe(0)
      expect(checkInvariants(model.project)).toEqual([])
    })

    // The toolbar strip reaches this gesture too: one setting, several
    // teleports, without touching any of them afterwards.
    it('gives the teleport the lock and direction the strip says', () => {
      const model = useModelStore()
      const missile = model.run('Add Lock', PROJECT_SCOPE, (tx) =>
        createNewLockType(tx, model.project, 'Missile Door', '#e23b3b'),
      )
      const defaults = useDoorDefaultsStore()
      defaults.selectLock(missile.id)
      defaults.setOneWay(true)
      const pending = usePendingTeleportStore()
      const mapId = twoRooms()

      pending.start(mapId, '0,0')
      pending.complete(mapId, '2,0')

      const teleport = transitionsOn(mapId)[0]
      expect(teleport.locks).toEqual({ a: missile.id, b: missile.id })
      expect(teleport.direction).toBe('aToB')
    })

    it('does nothing at all when nothing is pending', () => {
      const model = useModelStore()
      const pending = usePendingTeleportStore()
      const mapId = twoRooms()

      pending.complete(mapId, '2,0')

      expect(transitionsOn(mapId)).toEqual([])
      expect(model.status.undoLabel).toBe('Setup')
    })
  })

  // An invalid second click is ignored: the gesture stays pending, whether on
  // the origin tab or any other, and a misclick never forces a restart. Each of
  // these leaves both the model and the origin untouched.
  describe('an invalid second click', () => {
    function expectIgnored(mapId: MapId, cell: string) {
      const model = useModelStore()
      const pending = usePendingTeleportStore()
      const before = model.status.undoLabel

      pending.complete(mapId, cell)

      expect(pending.isPending).toBe(true)
      expect(pending.originOn(firstMapId())).toBe('0,0')
      expect(model.status.undoLabel).toBe(before)
    }

    it('is ignored on bare grid', () => {
      const mapId = twoRooms()
      usePendingTeleportStore().start(mapId, '0,0')
      expectIgnored(mapId, '9,9')
    })

    it('is ignored in the origin room, including the origin cell itself', () => {
      const mapId = firstMapId()
      paint(mapId, ['0,0', '1,0'])
      usePendingTeleportStore().start(mapId, '0,0')

      expectIgnored(mapId, '1,0')
      expectIgnored(mapId, '0,0')
    })

    // A cell that already holds a teleport is invalid too, since a cell holds at
    // most one; a misclick there must behave like every other misclick.
    it('is ignored on a cell that already holds a teleport', () => {
      const model = useModelStore()
      const mapId = firstMapId()
      paint(mapId, ['0,0'])
      paint(mapId, ['2,0'])
      paint(mapId, ['4,0'])
      model.run('Existing', mapScope(mapId), (tx) =>
        createTeleport(tx, model.project, { mapId, cell: '2,0' }, { mapId, cell: '4,0' }),
      )

      usePendingTeleportStore().start(mapId, '0,0')
      expectIgnored(mapId, '2,0')
      expect(transitionsOn(mapId)).toHaveLength(1)
    })

    // The empty cell on another map is the case a same-tab-only implementation
    // would get wrong.
    it('is ignored on another tab too', () => {
      const mapId = twoRooms()
      const otherId = addTab('Caves')
      usePendingTeleportStore().start(mapId, '0,0')

      expectIgnored(otherId, '0,0')
    })
  })

  // Cancelling happens via `Esc`, switching modes (leaving Door mode), or
  // deleting the origin's tab or room. `Esc` is the component's, being input;
  // the other two are here.
  describe('cancelling', () => {
    it('cancels on leaving Door mode', () => {
      const pending = usePendingTeleportStore()
      const mapId = twoRooms()
      pending.start(mapId, '0,0')

      useModeStore().setMode('draw')

      expect(pending.isPending).toBe(false)
    })

    // Coming back must not resurrect it: a pending state the user watched
    // disappear reappearing on a mode key would be the worst kind of surprise.
    it('does not come back when Door mode does', () => {
      const pending = usePendingTeleportStore()
      const mapId = twoRooms()
      pending.start(mapId, '0,0')

      const mode = useModeStore()
      mode.setMode('draw')
      mode.setMode('door')

      expect(pending.isPending).toBe(false)
    })

    it('cancels when the origin room is erased', () => {
      const model = useModelStore()
      const pending = usePendingTeleportStore()
      const mapId = twoRooms()
      pending.start(mapId, '0,0')

      model.run('Erase', mapScope(mapId), (tx) =>
        eraseCells(tx, model.project, model.project.mapsById.get(mapId)!, ['0,0']),
      )

      expect(pending.isPending).toBe(false)
    })

    it('cancels when the origin tab is deleted', () => {
      const model = useModelStore()
      const pending = usePendingTeleportStore()
      const mapId = firstMapId()
      paint(mapId, ['0,0'])
      addTab('Caves')
      pending.start(mapId, '0,0')

      model.run('Delete Map', PROJECT_SCOPE, (tx) => deleteMap(tx, model.project, mapId, 'Map 1'))

      expect(pending.isPending).toBe(false)
    })

    it('cancels when undo removes the origin room', () => {
      const model = useModelStore()
      const pending = usePendingTeleportStore()
      const mapId = firstMapId()
      paint(mapId, ['0,0'])
      pending.start(mapId, '0,0')

      model.undo()

      expect(pending.isPending).toBe(false)
    })

    // The prune is about the cell keeping a room, not about the room keeping
    // its id: a merge that absorbs the origin's room leaves the cell perfectly
    // good, and the teleport it is going to make anchors to cells anyway.
    it('survives a merge that absorbs the origin room', () => {
      const model = useModelStore()
      const pending = usePendingTeleportStore()
      const mapId = firstMapId()
      const keeper = paint(mapId, ['0,0'])
      paint(mapId, ['2,0'])
      pending.start(mapId, '2,0')

      model.run('Merge', mapScope(mapId), (tx) =>
        paintCells(tx, model.project, model.project.mapsById.get(mapId)!, ['0,0', '1,0', '2,0'], {
          intoRoomId: keeper,
          areaId: WORLD_AREA_ID,
        }),
      )

      expect(pending.originOn(mapId)).toBe('2,0')
    })

    it('cancels on demand', () => {
      const pending = usePendingTeleportStore()
      const mapId = twoRooms()
      pending.start(mapId, '0,0')

      pending.cancel()

      expect(pending.isPending).toBe(false)
    })
  })

  // The cursor's question. Every answer here has to agree with what `complete`
  // would actually do, or the crosshair promises a destination the model
  // refuses.
  describe('canCompleteAt', () => {
    it('is false while nothing is pending', () => {
      const mapId = twoRooms()
      expect(usePendingTeleportStore().canCompleteAt(mapId, '2,0')).toBe(false)
    })

    it('is true exactly where a click would complete', () => {
      const model = useModelStore()
      const pending = usePendingTeleportStore()
      const mapId = firstMapId()
      paint(mapId, ['0,0', '1,0'])
      paint(mapId, ['3,0'])
      paint(mapId, ['5,0'])
      paint(mapId, ['7,0'])
      model.run('Existing', mapScope(mapId), (tx) =>
        createTeleport(tx, model.project, { mapId, cell: '5,0' }, { mapId, cell: '7,0' }),
      )
      pending.start(mapId, '0,0')

      expect(pending.canCompleteAt(mapId, '3,0')).toBe(true)
      // Bare grid, the origin's own room, and an occupied cell: the three
      // refusals, which must read as false and not merely commit nothing.
      expect(pending.canCompleteAt(mapId, '9,9')).toBe(false)
      expect(pending.canCompleteAt(mapId, '1,0')).toBe(false)
      expect(pending.canCompleteAt(mapId, '5,0')).toBe(false)
    })

    it('is true on another tab, which is what makes a cross-tab teleport findable', () => {
      const pending = usePendingTeleportStore()
      const mapId = firstMapId()
      paint(mapId, ['0,0'])
      const otherId = addTab('Caves')
      paint(otherId, ['4,3'])
      pending.start(mapId, '0,0')

      expect(pending.canCompleteAt(otherId, '4,3')).toBe(true)
      expect(pending.canCompleteAt(otherId, '0,0')).toBe(false)
    })
  })
})
