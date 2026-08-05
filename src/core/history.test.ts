import { describe, it, expect } from 'vitest'
import { History } from './history'
import { emptyTouchSet } from './journal'
import { WORLD_AREA_ID } from './ids'
import type { MapId } from './ids'
import type { CellKey } from './cell'
import { addMap, deleteMap } from './ops/maps'
import { eraseCells, paintCells } from './ops/rooms'
import type { MapModel, ProjectModel } from './types'
import { TEST_NAV_LABEL as NAVIGATION_LABEL, rect, setup, sorted } from './testUtils'

describe('History', () => {
  it('drops an empty transaction rather than costing a Ctrl+Z', () => {
    const { project, map, history } = setup()
    const transaction = history.begin('Move room', { kind: 'map', mapId: map.id })
    expect(history.commit(transaction)).toBeNull()
    expect(history.canUndo).toBe(false)
    expect(project.rev).toBe(0)
  })

  it('hands back the step it recorded, not a bare true', () => {
    // The return convention: the caller gets what it can act on: the label to
    // show, the tab to repaint, and what changed.
    const { project, map, history } = setup()
    const transaction = history.begin('Paint room', { kind: 'map', mapId: map.id })
    paintCells(transaction, project, map, rect(0, 0, 2, 2), { areaId: WORLD_AREA_ID })

    const effect = history.commit(transaction)!
    expect(effect.label).toBe('Paint room')
    expect(effect.activateMapId).toBe(map.id)
    expect(effect.touched.rooms.size).toBe(1)
  })

  it('reports what an undo touched, so the UI need not assume everything', () => {
    const { project, map, history } = setup()
    const first = history.begin('Paint room', { kind: 'map', mapId: map.id })
    const room = paintCells(first, project, map, rect(0, 0, 2, 2), { areaId: WORLD_AREA_ID })
    history.commit(first)

    const second = history.begin('Paint room', { kind: 'map', mapId: map.id })
    paintCells(second, project, map, ['9,9'], { areaId: WORLD_AREA_ID })
    history.commit(second)

    // Undoing the *second* paint must not name the first paint's room.
    const effect = history.undo()!
    expect(effect.touched.rooms.has(room.id)).toBe(false)
    expect(effect.touched.cells.has('9,9')).toBe(true)
  })

  it('undoes and redoes a paint', () => {
    const { project, map, history } = setup()
    const transaction = history.begin('Paint room', { kind: 'map', mapId: map.id })
    paintCells(transaction, project, map, rect(0, 0, 2, 2), { areaId: WORLD_AREA_ID })
    history.commit(transaction)

    expect(map.rooms.size).toBe(1)
    expect(history.undoLabel).toBe('Paint room')

    history.undo()
    expect(map.rooms.size).toBe(0)
    expect(map.cellOwner.size).toBe(0)

    history.redo()
    expect(map.rooms.size).toBe(1)
    expect(sorted(map.cellOwner.keys())).toEqual(sorted(rect(0, 0, 2, 2)))
  })

  it('reverts a cascade as one step', () => {
    const { project, map, history } = setup()
    const paint = history.begin('Paint room', { kind: 'map', mapId: map.id })
    paintCells(paint, project, map, rect(0, 0, 5, 1), { areaId: WORLD_AREA_ID })
    history.commit(paint)

    const erase = history.begin('Erase cells', { kind: 'map', mapId: map.id })
    eraseCells(erase, project, map, ['1,0', '3,0'])
    history.commit(erase)
    expect(map.rooms.size).toBe(3)

    // One Ctrl+Z reverts the erase *and* both splits it caused.
    history.undo()
    expect(map.rooms.size).toBe(1)
  })

  it('tells the caller which tab to activate for a map-scoped step', () => {
    const { project, map, history } = setup()
    const transaction = history.begin('Paint room', { kind: 'map', mapId: map.id })
    paintCells(transaction, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
    history.commit(transaction)

    expect(history.undo()!.activateMapId).toBe(map.id)
  })

  it('does not move the user for a project-scoped step', () => {
    const { project, history } = setup()
    const transaction = history.begin('Rename project', { kind: 'project' })
    transaction.record({
      redo: () => {
        project.name = 'Holovania'
      },
      undo: () => {
        project.name = 'Untitled Project'
      },
    })
    history.commit(transaction)

    expect(history.undo()!.activateMapId).toBeNull()
    expect(project.name).toBe('Untitled Project')
  })

  it('records tab switches so undo retraces navigation', () => {
    const { project, map, history } = setup()
    const seed = history.begin('Add map', { kind: 'project' })
    const second = addMap(seed, project, 'Map 2')
    history.commit(seed)

    history.pushNavigation(map.id, second.id, NAVIGATION_LABEL)
    expect(history.undoLabel).toBe(NAVIGATION_LABEL)

    const effect = history.undo()!
    expect(effect.activateMapId).toBe(map.id)
    expect(history.redo()!.activateMapId).toBe(second.id)
  })

  it('coalesces a run of consecutive switches into one step', () => {
    const { project, map, history } = setup()
    const seed = history.begin('Add maps', { kind: 'project' })
    const b = addMap(seed, project, 'Map 2')
    const c = addMap(seed, project, 'Map 3')
    history.commit(seed)

    history.pushNavigation(map.id, b.id, NAVIGATION_LABEL)
    history.pushNavigation(b.id, c.id, NAVIGATION_LABEL)

    // Browsing A -> B -> C is one undo back to A, not two.
    expect(history.undo()!.activateMapId).toBe(map.id)
    expect(history.undoLabel).toBe('Add maps')
  })

  it('does not coalesce switches that have an edit between them', () => {
    const { project, map, history } = setup()
    const seed = history.begin('Add map', { kind: 'project' })
    const second = addMap(seed, project, 'Map 2')
    history.commit(seed)

    history.pushNavigation(map.id, second.id, NAVIGATION_LABEL)
    const edit = history.begin('Paint room', { kind: 'map', mapId: second.id })
    paintCells(edit, project, second, ['0,0'], { areaId: WORLD_AREA_ID })
    history.commit(edit)
    history.pushNavigation(second.id, map.id, NAVIGATION_LABEL)

    expect(history.undoLabel).toBe(NAVIGATION_LABEL)
    history.undo()
    expect(history.undoLabel).toBe('Paint room')
  })

  it('a new edit clears the redo branch', () => {
    const { project, map, history } = setup()
    const first = history.begin('Paint room', { kind: 'map', mapId: map.id })
    paintCells(first, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
    history.commit(first)
    history.undo()
    expect(history.canRedo).toBe(true)

    const second = history.begin('Paint room', { kind: 'map', mapId: map.id })
    paintCells(second, project, map, ['5,5'], { areaId: WORLD_AREA_ID })
    history.commit(second)
    expect(history.canRedo).toBe(false)
  })

  it('tracks dirty state against the last save', () => {
    const { project, map, history } = setup()
    expect(history.isDirty).toBe(false)

    const transaction = history.begin('Paint room', { kind: 'map', mapId: map.id })
    paintCells(transaction, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
    history.commit(transaction)
    expect(history.isDirty).toBe(true)

    history.markSaved()
    expect(history.isDirty).toBe(false)

    // Undoing after a save is still a change away from what is on disk.
    history.undo()
    expect(history.isDirty).toBe(true)
  })

  // A project whose contents were never written anywhere: a recovered crash
  // snapshot is the case. A fresh history reads clean, which is right for a
  // new project and wrong for this one.
  describe('markNeverSaved', () => {
    it('makes a project with no history dirty', () => {
      const { history } = setup()
      expect(history.isDirty).toBe(false)

      history.markNeverSaved()
      expect(history.isDirty).toBe(true)
    })

    // The state `null` cannot express: undoing every edit gets back to an
    // empty stack, which still matches no file.
    it('stays dirty after undoing everything', () => {
      const { project, map, history } = setup()
      history.markNeverSaved()

      const transaction = history.begin('Paint room', { kind: 'map', mapId: map.id })
      paintCells(transaction, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
      history.commit(transaction)
      history.undo()

      expect(history.canUndo).toBe(false)
      expect(history.isDirty).toBe(true)
    })

    it('is undone by saving', () => {
      const { history } = setup()
      history.markNeverSaved()
      history.markSaved()
      expect(history.isDirty).toBe(false)
    })
  })

  // `clear()` is the new-project / open / revert path. It had no callers yet,
  // which is exactly why it was worth fixing before one exists.
  describe('clear', () => {
    function withOneEdit() {
      const { project, map, history } = setup()
      const transaction = history.begin('Paint room', { kind: 'map', mapId: map.id })
      paintCells(transaction, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
      history.commit(transaction)
      return { project, map, history }
    }

    it('leaves a saved project clean rather than permanently dirty', () => {
      const { history } = withOneEdit()
      history.markSaved()
      expect(history.isDirty).toBe(false)

      history.clear()

      // The saved marker pointed at an entry no longer on the stack, so this
      // would have reported dirty for ever after on a file with nothing to write.
      expect(history.isDirty).toBe(false)
    })

    it('starts a fresh project clean', () => {
      const { history } = withOneEdit()
      expect(history.isDirty).toBe(true)

      history.clear()

      // Clearing means "this is a new document". Prompting about the work
      // being discarded is the caller's job, before it gets here.
      expect(history.isDirty).toBe(false)
    })

    it('drops both stacks', () => {
      const { history } = withOneEdit()
      history.undo()
      expect(history.canRedo).toBe(true)

      history.clear()
      expect(history.canUndo).toBe(false)
      expect(history.canRedo).toBe(false)
    })

    it('tracks dirty again from the cleared point', () => {
      const { project, map, history } = withOneEdit()
      history.clear()

      const next = history.begin('Paint room', { kind: 'map', mapId: map.id })
      paintCells(next, project, map, ['7,7'], { areaId: WORLD_AREA_ID })
      history.commit(next)
      expect(history.isDirty).toBe(true)

      history.markSaved()
      expect(history.isDirty).toBe(false)
    })
  })
})

describe('History and the tab store', () => {
  // A minimal stand-in for the store: `activate` is undoable, so it records a
  // navigation entry exactly as the real one will.
  function withTabs() {
    const { project, map, history } = setup()
    const seed = history.begin('Add map', { kind: 'project' })
    const second = addMap(seed, project, 'Map 2')
    history.commit(seed)

    let active = map.id
    const activate = (to: MapId) => {
      history.pushNavigation(active, to, NAVIGATION_LABEL)
      active = to
    }
    return { project, map, second, history, activate, current: () => active }
  }

  function edit(history: History, project: ProjectModel, map: MapModel, cell: CellKey) {
    const transaction = history.begin('Paint', { kind: 'map', mapId: map.id })
    paintCells(transaction, project, map, [cell], { areaId: WORLD_AREA_ID })
    history.commit(transaction)
  }

  describe('2.3 applying an effect does not record new history', () => {
    it('keeps redo alive when undo moves the user between tabs', () => {
      const { map, second, history, activate, current } = withTabs()
      activate(second.id)
      expect(current()).toBe(second.id)

      history.applyEffect(history.undo(), activate)

      // Routed through `applyEffect`, the tab change undo asked for does not
      // count as a new switch, so the redo branch survives.
      expect(current()).toBe(map.id)
      expect(history.canRedo).toBe(true)
    })

    it('and redo then goes back to the tab that was left', () => {
      const { map, second, history, activate, current } = withTabs()
      activate(second.id)
      history.applyEffect(history.undo(), activate)
      history.applyEffect(history.redo(), activate)

      expect(current()).toBe(second.id)
      expect(history.canUndo).toBe(true)
      // One step each way: the replayed switches added nothing to the stack,
      // so a single undo is back past the navigation to the edit beneath it.
      history.applyEffect(history.undo(), activate)
      expect(current()).toBe(map.id)
      expect(history.undoLabel).toBe('Add map')
    })

    it('still records a switch the user makes after a history move', () => {
      // The suppression is scoped to the effect, not sticky.
      const { second, history, activate } = withTabs()
      activate(second.id)
      history.applyEffect(history.undo(), activate)

      activate(second.id)
      expect(history.canUndo).toBe(true)
      expect(history.undoLabel).toBe(NAVIGATION_LABEL)
    })

    it('does nothing for an effect with no tab to activate', () => {
      const { history, activate } = withTabs()
      let called = 0
      history.applyEffect(null, () => called++)
      history.applyEffect(
        { activateMapId: null, label: 'x', touched: emptyTouchSet() },
        () => called++,
      )
      expect(called).toBe(0)
      expect(activate).toBeDefined()
    })
  })

  describe('2.4 browsing tabs does not dirty a saved project', () => {
    it('stays clean across a tab switch', () => {
      const { project, map, second, history, activate } = withTabs()
      edit(history, project, map, '0,0')
      history.markSaved()
      expect(history.isDirty).toBe(false)

      activate(second.id)
      // Nothing about the file changed, so the close prompt must not fire.
      expect(history.isDirty).toBe(false)
    })

    it('still reports dirty for a real edit after the switch', () => {
      const { project, map, second, history, activate } = withTabs()
      edit(history, project, map, '0,0')
      history.markSaved()

      activate(second.id)
      edit(history, project, second, '3,3')
      expect(history.isDirty).toBe(true)
    })

    it('is clean again after undoing back to the saved point', () => {
      const { project, map, second, history, activate } = withTabs()
      edit(history, project, map, '0,0')
      history.markSaved()
      activate(second.id)
      edit(history, project, second, '3,3')

      history.applyEffect(history.undo(), activate)
      expect(history.isDirty).toBe(false)
    })

    it('saving while a switch is on top still pins the right entry', () => {
      const { project, map, second, history, activate } = withTabs()
      edit(history, project, map, '0,0')
      activate(second.id)
      history.markSaved()
      expect(history.isDirty).toBe(false)

      edit(history, project, second, '3,3')
      expect(history.isDirty).toBe(true)
      history.applyEffect(history.undo(), activate)
      expect(history.isDirty).toBe(false)
    })
  })

  describe('2.5 an effect never names a map that is gone', () => {
    it('returns null rather than the tab a redo just deleted', () => {
      const { project, second, history } = withTabs()
      const kill = history.begin('Delete map', { kind: 'map', mapId: second.id })
      deleteMap(kill, project, second.id, 'Map 1')
      history.commit(kill)

      history.undo()
      expect(project.mapsById.has(second.id)).toBe(true)

      const effect = history.redo()
      expect(project.mapsById.has(second.id)).toBe(false)
      // The entry's scope still names the deleted map; handing it to the UI
      // would activate a tab that no longer exists.
      expect(effect?.activateMapId).toBeNull()
    })

    it('still names a map that does exist', () => {
      const { project, map, history } = withTabs()
      edit(history, project, map, '0,0')
      expect(history.undo()?.activateMapId).toBe(map.id)
    })
  })
})
