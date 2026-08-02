import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { useDrawAreaStore } from './drawArea'
import { PROJECT_SCOPE, useModelStore } from './model'
import { createNewArea, deleteArea } from '@/core/ops/project'
import { createProject } from '@/core/factory'
import { WORLD_AREA_ID } from '@/core/ids'
import type { AreaId } from '@/core/ids'

describe('drawArea store', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function addArea(name: string): AreaId {
    const model = useModelStore()
    return model.run('Add area', PROJECT_SCOPE, (tx) =>
      createNewArea(tx, model.project, name, '#336699', '#112233'),
    ).id
  }

  it('starts on World', () => {
    expect(useDrawAreaStore().areaId).toBe(WORLD_AREA_ID)
  })

  it('selects an area that exists', () => {
    const drawArea = useDrawAreaStore()
    const caves = addArea('Caves')

    drawArea.select(caves)
    expect(drawArea.areaId).toBe(caves)
  })

  // Two mechanisms deliver this between them: the watcher below and the guard
  // on `areaId`. Most of these pass with either one removed, which is
  // deliberate belt-and-braces on the behaviour the user sees; the two tests
  // that isolate each mechanism are called out where they sit.
  describe('pruning', () => {
    // Same argument as the active room's prune: having every op that can
    // destroy an area also clear this is the version that eventually misses
    // one.
    it('falls back to World when the selected area is deleted', () => {
      const model = useModelStore()
      const drawArea = useDrawAreaStore()
      const caves = addArea('Caves')
      drawArea.select(caves)

      model.run('Delete area', PROJECT_SCOPE, (tx) => deleteArea(tx, model.project, caves))

      expect(drawArea.areaId).toBe(WORLD_AREA_ID)
    })

    it('falls back when undo removes the area it was pointing at', () => {
      const model = useModelStore()
      const drawArea = useDrawAreaStore()
      const caves = addArea('Caves')
      drawArea.select(caves)

      model.undo()

      expect(drawArea.areaId).toBe(WORLD_AREA_ID)
    })

    // Opening a file replaces the whole project, and area ids do not carry
    // across: the previous selection names nothing in the new one.
    it('falls back when the project is replaced', () => {
      const model = useModelStore()
      const drawArea = useDrawAreaStore()
      drawArea.select(addArea('Caves'))

      model.replaceProject(
        createProject({
          projectName: 'Other',
          firstMapName: 'Map 1',
          worldAreaName: 'World',
          openLockName: 'Open',
          lockedLockName: 'Locked',
        }),
      )

      expect(drawArea.areaId).toBe(WORLD_AREA_ID)
    })

    it('keeps a selection through changes that do not touch it', () => {
      const model = useModelStore()
      const drawArea = useDrawAreaStore()
      const caves = addArea('Caves')
      drawArea.select(caves)

      // Another area comes and goes; the selection is not the one affected.
      const surface = addArea('Surface')
      model.run('Delete area', PROJECT_SCOPE, (tx) => deleteArea(tx, model.project, surface))

      expect(drawArea.areaId).toBe(caves)
    })

    // This is the prune watcher's test, and the only one of these that fails
    // without it: the guard on `areaId` already covers every case above, so
    // the watcher's unique contribution is that pruning is one-way.
    // Resurrecting a selection the user watched disappear is a surprise they
    // did not ask for.
    it('does not re-select an area that redo brings back', () => {
      const model = useModelStore()
      const drawArea = useDrawAreaStore()
      const caves = addArea('Caves')
      drawArea.select(caves)
      model.undo()
      expect(drawArea.areaId).toBe(WORLD_AREA_ID)

      model.redo()

      expect(model.project.areas.has(caves)).toBe(true)
      expect(drawArea.areaId).toBe(WORLD_AREA_ID)
    })
  })

  // The getter resolves on read, so a selection that was never valid cannot
  // reach `paintCells` and mint a room pointing at nothing. The prune watcher
  // cannot cover this on its own: it fires on structure changes, and selecting
  // an unknown id is not one.
  it('never reports an area the project does not have', () => {
    const drawArea = useDrawAreaStore()

    drawArea.select('area_gone' as AreaId)

    expect(drawArea.areaId).toBe(WORLD_AREA_ID)
  })

  // World is immutable (`deleteArea` refuses it), which is what makes it safe
  // as both the default and the fallback: there is always something to fall
  // back to.
  it('cannot be left pointing at nothing, because World cannot be deleted', () => {
    const model = useModelStore()
    const drawArea = useDrawAreaStore()

    const outcome = model.run('Delete World', PROJECT_SCOPE, (tx) =>
      deleteArea(tx, model.project, WORLD_AREA_ID),
    )

    expect(outcome).toBeDefined()
    expect(model.project.areas.has(WORLD_AREA_ID)).toBe(true)
    expect(drawArea.areaId).toBe(WORLD_AREA_ID)
  })
})
