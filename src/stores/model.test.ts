import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { isReactive, nextTick, watch } from 'vue'
import { createTestPinia } from '@/test-setup'
import { PROJECT_SCOPE, mapScope, useModelStore } from './model'
import { addMap, renameMap } from '@/core/ops/maps'
import { renameProject } from '@/core/ops/project'
import { paintCells } from '@/core/ops/rooms'
import { createProject } from '@/core/factory'
import { checkInvariants } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import { ModelError } from '@/core/outcome'
import type { MapId } from '@/core/ids'

function firstMapId(project: { maps: MapId[] }): MapId {
  return project.maps[0]
}

// Stands in for what `openProject(raw).accept()` hands back.
function blankProject(name: string) {
  return createProject({
    projectName: name,
    firstMapName: 'Loaded',
    worldAreaName: 'World',
    openLockName: 'Open',
    lockedLockName: 'Locked',
  })
}

describe('useModelStore', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  it('starts with a project core built, named from the catalogue', () => {
    const store = useModelStore()
    expect(store.projectName).toBe('Untitled Project')
    expect(store.project.maps).toHaveLength(1)
    expect(store.project.mapsById.get(firstMapId(store.project))!.name).toBe('Map 1')
    expect(checkInvariants(store.project)).toEqual([])
  })

  // The whole reason core is plain TypeScript. If Pinia's `reactive()` ever
  // reaches the model, every cell, wall and index entry gets a proxy: the cost
  // arrives silently, as a slow render loop nobody can attribute, months later.
  //
  // Identity is the assertion that matters. `isReactive` is checked too, but a
  // proxy is only one way to lose the raw object; `toBe` catches every way.
  it('hands back the raw model, never a reactive proxy', () => {
    const store = useModelStore()
    const opened = blankProject('Identity Check')
    store.replaceProject(opened)

    expect(store.project).toBe(opened)
    expect(isReactive(store.project)).toBe(false)
    expect(isReactive(store.history)).toBe(false)

    store.run('Add map', PROJECT_SCOPE, (tx) => addMap(tx, store.project, 'Two'))
    const map = store.project.mapsById.get(store.project.maps[1])!
    expect(store.project.mapsById.get(map.id)).toBe(map)
    expect(isReactive(map)).toBe(false)
    expect(isReactive(map.cellOwner)).toBe(false)
  })

  describe('run', () => {
    it('returns what the body returned, not the history effect', () => {
      const store = useModelStore()
      const map = store.run('Add map', PROJECT_SCOPE, (tx) => addMap(tx, store.project, 'Caves'))
      expect(map.name).toBe('Caves')
      expect(store.project.mapsById.get(map.id)).toBe(map)
    })

    it('publishes the revision counters a commit moved', () => {
      const store = useModelStore()
      const mapId = firstMapId(store.project)
      const before = { rev: store.rev, structureRev: store.structureRev }

      store.run('Paint', mapScope(mapId), (tx) =>
        paintCells(tx, store.project, store.project.mapsById.get(mapId)!, ['0,0', '1,0'], {
          areaId: WORLD_AREA_ID,
        }),
      )

      expect(store.rev).toBeGreaterThan(before.rev)
      expect(store.mapRev(mapId)).toBeGreaterThan(0)
      // Painting is map content, not project structure.
      expect(store.structureRev).toBe(before.structureRev)
    })

    it("leaves a map another map's edit did not touch at its old revision", () => {
      const store = useModelStore()
      const first = firstMapId(store.project)
      const second = store.run('Add map', PROJECT_SCOPE, (tx) =>
        addMap(tx, store.project, 'Caves'),
      ).id
      const untouched = store.mapRev(first)

      store.run('Paint', mapScope(second), (tx) =>
        paintCells(tx, store.project, store.project.mapsById.get(second)!, ['0,0'], {
          areaId: WORLD_AREA_ID,
        }),
      )

      expect(store.mapRev(first)).toBe(untouched)
      expect(store.mapRev(second)).toBeGreaterThan(0)
    })

    it('triggers Vue reactivity through the published counters', async () => {
      const store = useModelStore()
      const seen: number[] = []
      watch(
        () => store.structureRev,
        (value) => seen.push(value),
      )

      store.run('Rename', PROJECT_SCOPE, (tx) => renameProject(tx, store.project, 'Zebes'))
      await nextTick()

      expect(seen).toHaveLength(1)
      expect(store.projectName).toBe('Zebes')
    })

    // An empty transaction is dropped by History.commit, which is what makes a
    // drag back to its origin a true no-op instead of a wasted undo step.
    it('records nothing when the body changed nothing', () => {
      const store = useModelStore()
      store.run('Rename', PROJECT_SCOPE, (tx) =>
        renameProject(tx, store.project, store.project.name),
      )
      expect(store.status.canUndo).toBe(false)
      expect(store.status.isDirty).toBe(false)
    })

    // A half-applied, never-journaled change is the one state the model cannot
    // recover from, so the transaction must come apart before the throw does.
    it('rolls the transaction back when the body throws', () => {
      const store = useModelStore()
      const before = store.project.name

      expect(() =>
        store.run('Broken', PROJECT_SCOPE, (tx) => {
          renameProject(tx, store.project, 'Half-applied')
          throw new ModelError('boom')
        }),
      ).toThrow('boom')

      expect(store.project.name).toBe(before)
      expect(store.status.canUndo).toBe(false)
      expect(checkInvariants(store.project)).toEqual([])
    })
  })

  describe('beginGesture', () => {
    function paint(store: ReturnType<typeof useModelStore>, cells: string[]) {
      const mapId = firstMapId(store.project)
      const map = store.project.mapsById.get(mapId)!
      return (tx: Parameters<Parameters<typeof store.run>[2]>[0]) =>
        paintCells(tx, store.project, map, cells, { areaId: WORLD_AREA_ID })
    }

    // The canvas shows the pending state because the model is the pending
    // state; nothing else in the app is allowed to notice, or a half-finished
    // drag would dirty the file and light up the save prompt.
    it('moves the model but publishes nothing until it commits', () => {
      const store = useModelStore()
      const rev = store.rev
      const gesture = store.beginGesture('Paint', mapScope(firstMapId(store.project)))

      gesture.reapply(paint(store, ['0,0']))
      expect(store.project.mapsById.get(firstMapId(store.project))!.rooms.size).toBe(1)
      expect(store.rev).toBe(rev)
      expect(store.status.canUndo).toBe(false)
      expect(store.status.isDirty).toBe(false)

      gesture.commit()
      expect(store.rev).not.toBe(rev)
      expect(store.status.undoLabel).toBe('Paint')
      expect(store.status.isDirty).toBe(true)
    })

    it('rewinds the previous apply rather than stacking them', () => {
      const store = useModelStore()
      const map = store.project.mapsById.get(firstMapId(store.project))!
      const gesture = store.beginGesture('Paint', mapScope(map.id))

      gesture.reapply(paint(store, ['0,0', '1,0']))
      gesture.reapply(paint(store, ['0,0', '1,0', '2,0']))
      gesture.commit()

      expect(map.rooms.size).toBe(1)
      expect([...map.rooms.values()][0].cells.size).toBe(3)
    })

    it('leaves no undo step when nothing changed', () => {
      const store = useModelStore()
      const gesture = store.beginGesture('Paint', mapScope(firstMapId(store.project)))

      gesture.reapply(() => {})
      gesture.commit()

      expect(store.status.canUndo).toBe(false)
      expect(store.status.isDirty).toBe(false)
    })

    it('restores the model on cancel and leaves the stack alone', () => {
      const store = useModelStore()
      const map = store.project.mapsById.get(firstMapId(store.project))!
      store.run('Setup', mapScope(map.id), paint(store, ['9,9']))
      const rev = store.rev

      const gesture = store.beginGesture('Paint', mapScope(map.id))
      gesture.reapply(paint(store, ['0,0', '1,0']))
      gesture.cancel()

      expect(map.rooms.size).toBe(1)
      expect(store.status.undoLabel).toBe('Setup')
      // Deliberately not republished: a rollback restores exactly the state the
      // counters already describe.
      expect(store.rev).toBe(rev)
      expect(checkInvariants(store.project)).toEqual([])
    })

    // `Esc` mid-drag followed by the pointerup that was always coming is the
    // normal abort sequence, not a caller bug.
    it('is settled once, whichever call gets there first', () => {
      const store = useModelStore()
      const map = store.project.mapsById.get(firstMapId(store.project))!
      const gesture = store.beginGesture('Paint', mapScope(map.id))

      gesture.reapply(paint(store, ['0,0']))
      gesture.cancel()
      gesture.reapply(paint(store, ['5,5']))
      gesture.commit()

      expect(map.rooms.size).toBe(0)
      expect(store.status.canUndo).toBe(false)
    })

    it('rolls back and closes when the body throws', () => {
      const store = useModelStore()
      const map = store.project.mapsById.get(firstMapId(store.project))!
      const gesture = store.beginGesture('Paint', mapScope(map.id))

      expect(() =>
        gesture.reapply((tx) => {
          paintCells(tx, store.project, map, ['0,0'], { areaId: WORLD_AREA_ID })
          throw new ModelError('boom')
        }),
      ).toThrow('boom')

      expect(map.rooms.size).toBe(0)
      expect(checkInvariants(store.project)).toEqual([])
      gesture.commit()
      expect(store.status.canUndo).toBe(false)
    })
  })

  describe('undo and redo', () => {
    it('moves the model and republishes', () => {
      const store = useModelStore()
      store.run('Rename', PROJECT_SCOPE, (tx) => renameProject(tx, store.project, 'Zebes'))
      expect(store.status.canUndo).toBe(true)
      expect(store.status.undoLabel).toBe('Rename')

      store.undo()
      expect(store.projectName).toBe('Untitled Project')
      expect(store.status.canRedo).toBe(true)

      store.redo()
      expect(store.projectName).toBe('Zebes')
    })

    // Undo must never revert a change on a tab the user cannot see, so a
    // map-scoped step takes them back to it first.
    it('routes a map-scoped step through the registered activator', () => {
      const store = useModelStore()
      const activate = vi.fn()
      store.onActivateMap(activate)
      const mapId = firstMapId(store.project)

      store.run('Paint', mapScope(mapId), (tx) =>
        paintCells(tx, store.project, store.project.mapsById.get(mapId)!, ['0,0'], {
          areaId: WORLD_AREA_ID,
        }),
      )
      // Not on the way in: the user was already on this tab, and for the ops
      // where they were not (renaming an inactive tab from the tab bar) jumping
      // there is a bug. See `run`.
      expect(activate).not.toHaveBeenCalled()

      store.undo()
      expect(activate).toHaveBeenCalledWith(mapId)

      activate.mockClear()
      store.redo()
      expect(activate).toHaveBeenCalledWith(mapId)
    })

    it('does not move the user for a project-scoped step', () => {
      const store = useModelStore()
      const activate = vi.fn()
      store.onActivateMap(activate)

      store.run('Rename', PROJECT_SCOPE, (tx) => renameProject(tx, store.project, 'Zebes'))
      store.undo()

      expect(activate).not.toHaveBeenCalled()
    })

    it('reports the touched set so a caller can repaint just that', () => {
      const store = useModelStore()
      const mapId = firstMapId(store.project)
      store.run('Rename map', PROJECT_SCOPE, (tx) => renameMap(tx, store.project, mapId, 'Surface'))

      const effect = store.undo()
      expect(effect!.touched.maps.has(mapId)).toBe(true)
      expect(store.redo()!.label).toBe('Rename map')
    })

    it('returns null at either end of the stack', () => {
      const store = useModelStore()
      expect(store.undo()).toBeNull()
      expect(store.redo()).toBeNull()
    })
  })

  describe('the dirty flag', () => {
    it("is core's, not a copy, and markSaved clears it", () => {
      const store = useModelStore()
      expect(store.status.isDirty).toBe(false)

      store.run('Rename', PROJECT_SCOPE, (tx) => renameProject(tx, store.project, 'Zebes'))
      expect(store.status.isDirty).toBe(true)

      store.markSaved()
      expect(store.status.isDirty).toBe(false)

      // Undoing back past the save point is a change from what is on disk.
      store.undo()
      expect(store.status.isDirty).toBe(true)
    })
  })

  describe('replaceProject', () => {
    it('swaps the model and starts a fresh history', () => {
      const store = useModelStore()
      store.run('Rename', PROJECT_SCOPE, (tx) => renameProject(tx, store.project, 'Zebes'))

      const opened = blankProject('From Disk')
      store.replaceProject(opened)

      expect(store.project).toBe(opened)
      expect(store.projectName).toBe('From Disk')
      // The old stack's entries close over the old project's objects; replaying
      // one into the new model would corrupt it.
      expect(store.status.canUndo).toBe(false)
      expect(store.status.canRedo).toBe(false)
      expect(store.status.isDirty).toBe(false)
    })

    it('keeps publishing from the new project', () => {
      const store = useModelStore()
      store.replaceProject(blankProject('From Disk'))

      store.run('Add map', PROJECT_SCOPE, (tx) => addMap(tx, store.project, 'Second'))
      expect(store.project.maps).toHaveLength(2)
      expect(store.structureRev).toBeGreaterThan(0)
      expect(checkInvariants(store.project)).toEqual([])
    })
  })
})
