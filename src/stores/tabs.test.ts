import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { useTabsStore } from './tabs'
import { mapScope, useModelStore } from './model'
import { MAX_ZOOM, MIN_ZOOM } from '@/canvas/camera'
import { DEFAULT_PAN } from '@/canvas/viewport'
import { pageBounds } from '@/canvas/page'
import { paintCells } from '@/core/ops/rooms'
import { renameMap } from '@/core/ops/maps'
import { checkInvariants } from '@/core/testUtils'
import { createProject } from '@/core/factory'
import { WORLD_AREA_ID } from '@/core/ids'
import type { MapId } from '@/core/ids'

describe('useTabsStore', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  it('starts with one tab, "Map 1", active', () => {
    const store = useTabsStore()
    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0].name).toBe('Map 1')
    expect(store.activeTabId).toBe(store.tabs[0].id)
  })

  it('every tab id is a live core MapId', () => {
    const store = useTabsStore()
    const model = useModelStore()
    store.addTab()
    store.addTab()

    expect(store.tabs.map((tab) => tab.id)).toEqual(model.project.maps)
    for (const tab of store.tabs) {
      expect(model.project.mapsById.get(tab.id)!.name).toBe(tab.name)
    }
  })

  it('reads names back out of the model rather than holding its own', () => {
    const store = useTabsStore()
    const model = useModelStore()
    const mapId = store.tabs[0].id

    // Renamed behind the store's back, straight through the core op.
    model.run('Rename', mapScope(mapId), (tx) => renameMap(tx, model.project, mapId, 'Brinstar'))

    expect(store.tabs[0].name).toBe('Brinstar')
  })

  // Opening a file swaps the whole ProjectModel out. The tab bar has to follow
  // it, and cannot do so by watching a revision counter: the incoming project
  // brings its own counters, which for a freshly loaded file are the same
  // zeroes the outgoing one may have been sitting on.
  it('follows a project swap', () => {
    const store = useTabsStore()
    const model = useModelStore()
    const stale = store.activeTabId

    model.replaceProject(
      createProject({
        projectName: 'From Disk',
        firstMapName: 'Loaded',
        worldAreaName: 'World',
        openLockName: 'Open',
        lockedLockName: 'Locked',
      }),
    )

    expect(store.tabs.map((tab) => tab.name)).toEqual(['Loaded'])
    expect(store.activeTabId).not.toBe(stale)
    expect(store.activeTabId).toBe(model.project.maps[0])
    expect(store.activeTab).toBeDefined()
  })

  describe('the active tab', () => {
    it('carries the camera and the derived page bounds', () => {
      const store = useTabsStore()
      expect(store.activeTab!.pan).toEqual(DEFAULT_PAN)
      expect(store.activeTab!.zoom).toBe(1)
      // An empty map gets the minimum sheet.
      expect(store.activeTab!.bounds).toEqual(pageBounds(null))
    })

    it('grows its bounds with the content, rather than holding a placeholder', () => {
      const store = useTabsStore()
      const model = useModelStore()
      const mapId = store.tabs[0].id

      model.run('Paint', mapScope(mapId), (tx) =>
        paintCells(tx, model.project, model.project.mapsById.get(mapId)!, ['40,40'], {
          areaId: WORLD_AREA_ID,
        }),
      )

      expect(store.activeTab!.bounds).not.toEqual(pageBounds(null))
      expect(store.activeTab!.bounds.maxCol).toBeGreaterThanOrEqual(40)
    })
  })

  describe('cameras', () => {
    it('sets pan on the correct tab only', () => {
      const store = useTabsStore()
      store.addTab()
      const [first, second] = store.tabs
      store.setPan(second.id, { x: 3, y: -1 })
      expect(store.cameraOf(first.id).pan).toEqual(DEFAULT_PAN)
      expect(store.cameraOf(second.id).pan).toEqual({ x: 3, y: -1 })
    })

    it('sets zoom on the correct tab only', () => {
      const store = useTabsStore()
      store.addTab()
      const [first, second] = store.tabs
      store.setZoom(second.id, 2)
      expect(store.cameraOf(first.id).zoom).toBe(1)
      expect(store.cameraOf(second.id).zoom).toBe(2)
    })

    it('steps zoom in and out', () => {
      const store = useTabsStore()
      const tabId = store.tabs[0].id
      store.zoomIn(tabId)
      expect(store.cameraOf(tabId).zoom).toBe(1.25)
      store.resetZoom(tabId)
      store.zoomOut(tabId)
      expect(store.cameraOf(tabId).zoom).toBe(0.8)
    })

    it('clamps to the min/max bounds', () => {
      const store = useTabsStore()
      const tabId = store.tabs[0].id
      store.setZoom(tabId, 99)
      expect(store.cameraOf(tabId).zoom).toBe(MAX_ZOOM)
      store.setZoom(tabId, -5)
      expect(store.cameraOf(tabId).zoom).toBe(MIN_ZOOM)

      for (let i = 0; i < 50; i++) store.zoomIn(tabId)
      expect(store.cameraOf(tabId).zoom).toBe(MAX_ZOOM)
      for (let i = 0; i < 50; i++) store.zoomOut(tabId)
      expect(store.cameraOf(tabId).zoom).toBe(MIN_ZOOM)
    })

    // Session view state, explicitly not undoable.
    it('does not put a camera change on the undo stack', () => {
      const store = useTabsStore()
      const model = useModelStore()
      store.setZoom(store.tabs[0].id, 2)
      expect(model.status.canUndo).toBe(false)
      expect(model.status.isDirty).toBe(false)
    })
  })

  describe('addTab', () => {
    it('uses the lowest unused "Map N" name and activates it', () => {
      const store = useTabsStore()
      store.addTab()
      expect(store.tabs.map((tab) => tab.name)).toEqual(['Map 1', 'Map 2'])
      expect(store.activeTabId).toBe(store.tabs[1].id)
    })

    // Activating the tab you just made is part of making it, not a separate
    // navigation: otherwise undo costs two presses to get past.
    it('is a single undo step that takes the tab away again', () => {
      const store = useTabsStore()
      const model = useModelStore()
      const original = store.activeTabId
      store.addTab()

      model.undo()
      expect(store.tabs).toHaveLength(1)
      expect(store.activeTabId).toBe(original)
      expect(checkInvariants(model.project)).toEqual([])
    })

    it('redo brings the tab back and returns the user to it', () => {
      const store = useTabsStore()
      const model = useModelStore()
      store.addTab()
      const added = store.activeTabId

      model.undo()
      model.redo()
      expect(store.tabs).toHaveLength(2)
      expect(store.activeTabId).toBe(added)
    })
  })

  describe('activate', () => {
    it('switches the active tab', () => {
      const store = useTabsStore()
      store.addTab()
      const first = store.tabs[0].id
      store.activate(first)
      expect(store.activeTabId).toBe(first)
    })

    // A tab switch is a history entry of its own, so undo retraces your path
    // and never reverts an edit on a tab you cannot see.
    it('is undoable, and undo returns to the tab you came from', () => {
      const store = useTabsStore()
      const model = useModelStore()
      store.addTab()
      const [first, second] = store.tabs.map((tab) => tab.id)
      store.activate(first)

      expect(model.status.canUndo).toBe(true)
      model.undo()
      expect(store.activeTabId).toBe(second)
    })

    it('selecting the tab you are already on records nothing', () => {
      const store = useTabsStore()
      const model = useModelStore()
      store.activate(store.activeTabId)
      expect(model.status.canUndo).toBe(false)
    })

    // Navigation is not an edit, so browsing tabs must not make the file dirty.
    it('does not make the project dirty', () => {
      const store = useTabsStore()
      const model = useModelStore()
      store.addTab()
      model.markSaved()
      store.activate(store.tabs[0].id)
      expect(model.status.isDirty).toBe(false)
    })
  })

  describe('renameTab', () => {
    it('renames the tab, trimming whitespace', () => {
      const store = useTabsStore()
      store.renameTab(store.tabs[0].id, '  Brinstar  ')
      expect(store.tabs[0].name).toBe('Brinstar')
    })

    it('ignores an empty/whitespace-only name', () => {
      const store = useTabsStore()
      store.renameTab(store.tabs[0].id, '   ')
      expect(store.tabs[0].name).toBe('Map 1')
    })

    it('is undoable', () => {
      const store = useTabsStore()
      const model = useModelStore()
      store.renameTab(store.tabs[0].id, 'Brinstar')
      model.undo()
      expect(store.tabs[0].name).toBe('Map 1')
    })
  })

  describe('duplicateTab', () => {
    it('inserts a copy right after the original, named "<name> copy", and activates it', () => {
      const store = useTabsStore()
      store.addTab()
      store.duplicateTab(store.tabs[0].id)

      expect(store.tabs.map((tab) => tab.name)).toEqual(['Map 1', 'Map 1 copy', 'Map 2'])
      expect(store.activeTabId).toBe(store.tabs[1].id)
    })

    it('carries over the original camera', () => {
      const store = useTabsStore()
      const tabId = store.tabs[0].id
      store.setZoom(tabId, 2)
      store.setPan(tabId, { x: 5, y: 5 })
      store.duplicateTab(tabId)

      const copy = store.tabs[1].id
      expect(store.cameraOf(copy).zoom).toBe(2)
      expect(store.cameraOf(copy).pan).toEqual({ x: 5, y: 5 })
    })

    it('copies the content, not just the name', () => {
      const store = useTabsStore()
      const model = useModelStore()
      const tabId = store.tabs[0].id
      model.run('Paint', mapScope(tabId), (tx) =>
        paintCells(tx, model.project, model.project.mapsById.get(tabId)!, ['0,0', '1,0'], {
          areaId: WORLD_AREA_ID,
        }),
      )

      store.duplicateTab(tabId)
      const copy = model.project.mapsById.get(store.tabs[1].id)!
      expect(copy.rooms.size).toBe(1)
      expect(copy.cellOwner.size).toBe(2)
      expect(checkInvariants(model.project)).toEqual([])
    })

    it('continues the copy sequence (copy, copy 2, copy 3, ...)', () => {
      const store = useTabsStore()
      const tabId = store.tabs[0].id
      store.duplicateTab(tabId)
      store.duplicateTab(tabId)
      store.duplicateTab(tabId)
      expect(store.tabs.map((tab) => tab.name)).toEqual([
        'Map 1',
        'Map 1 copy 3',
        'Map 1 copy 2',
        'Map 1 copy',
      ])
    })

    it('duplicating a copy continues the same base sequence instead of nesting', () => {
      const store = useTabsStore()
      store.duplicateTab(store.tabs[0].id)
      store.duplicateTab(store.tabs[1].id)
      expect(store.tabs.map((tab) => tab.name)).toEqual(['Map 1', 'Map 1 copy', 'Map 1 copy 2'])
    })

    it('is a single undo step', () => {
      const store = useTabsStore()
      const model = useModelStore()
      store.duplicateTab(store.tabs[0].id)
      model.undo()
      expect(store.tabs.map((tab) => tab.name)).toEqual(['Map 1'])
    })
  })

  describe('deleteTab', () => {
    it('removes the tab', () => {
      const store = useTabsStore()
      store.addTab()
      store.deleteTab(store.tabs[0].id)
      expect(store.tabs.map((tab) => tab.name)).toEqual(['Map 2'])
    })

    it('falls back to the neighbouring tab when deleting the active tab', () => {
      const store = useTabsStore()
      store.addTab()
      store.addTab()
      const second = store.tabs[1].id
      store.activate(second)
      store.deleteTab(second)
      // Whatever slid into index 1.
      expect(store.activeTabId).toBe(store.tabs[1].id)
    })

    it('does not change the active tab when deleting an inactive tab', () => {
      const store = useTabsStore()
      store.addTab()
      const active = store.activeTabId
      store.deleteTab(store.tabs[0].id)
      expect(store.activeTabId).toBe(active)
    })

    it('deleting the last remaining tab replaces it with a fresh "Map 1"', () => {
      const store = useTabsStore()
      const onlyTabId = store.tabs[0].id
      store.renameTab(onlyTabId, 'Renamed')
      store.deleteTab(onlyTabId)

      expect(store.tabs).toHaveLength(1)
      expect(store.tabs[0].name).toBe('Map 1')
      expect(store.tabs[0].id).not.toBe(onlyTabId)
      expect(store.activeTabId).toBe(store.tabs[0].id)
    })

    // The journal closes over the whole detached MapModel, so undo restores the
    // content too, not just an empty tab in the right place.
    it('undo restores the tab with its content and returns the user to it', () => {
      const store = useTabsStore()
      const model = useModelStore()
      store.addTab()
      const target = store.tabs[0].id
      model.run('Paint', mapScope(target), (tx) =>
        paintCells(tx, model.project, model.project.mapsById.get(target)!, ['0,0'], {
          areaId: WORLD_AREA_ID,
        }),
      )

      store.deleteTab(target)
      expect(store.tabs).toHaveLength(1)

      model.undo()
      expect(store.tabs.map((tab) => tab.id)).toContain(target)
      expect(model.project.mapsById.get(target)!.rooms.size).toBe(1)
      expect(store.activeTabId).toBe(target)
      expect(checkInvariants(model.project)).toEqual([])
    })

    it('is a no-op for an unknown id', () => {
      const store = useTabsStore()
      const model = useModelStore()
      store.deleteTab('nope' as MapId)
      expect(store.tabs).toHaveLength(1)
      expect(model.status.canUndo).toBe(false)
    })
  })

  describe('reorderTab', () => {
    it('moves a tab forward, landing after the target (its pre-removal index)', () => {
      const store = useTabsStore()
      store.addTab()
      store.addTab()
      store.addTab()
      expect(store.tabs.map((tab) => tab.name)).toEqual(['Map 1', 'Map 2', 'Map 3', 'Map 4'])

      store.reorderTab(store.tabs[0].id, 2)
      expect(store.tabs.map((tab) => tab.name)).toEqual(['Map 2', 'Map 3', 'Map 1', 'Map 4'])
    })

    it('moves a tab backward, landing before the target (its pre-removal index)', () => {
      const store = useTabsStore()
      store.addTab()
      store.addTab()
      store.addTab()

      store.reorderTab(store.tabs[3].id, 1)
      expect(store.tabs.map((tab) => tab.name)).toEqual(['Map 1', 'Map 4', 'Map 2', 'Map 3'])
    })

    it('is a no-op for an unknown tab id or the same index', () => {
      const store = useTabsStore()
      const model = useModelStore()
      store.addTab()
      const before = store.tabs.map((tab) => tab.name)

      store.reorderTab('does-not-exist' as MapId, 0)
      expect(store.tabs.map((tab) => tab.name)).toEqual(before)

      const undoDepth = model.status.canUndo
      store.reorderTab(store.tabs[0].id, 0)
      expect(store.tabs.map((tab) => tab.name)).toEqual(before)
      expect(model.status.canUndo).toBe(undoDepth)
    })

    it('is undoable', () => {
      const store = useTabsStore()
      const model = useModelStore()
      store.addTab()
      const before = store.tabs.map((tab) => tab.name)

      store.reorderTab(store.tabs[0].id, 1)
      expect(store.tabs.map((tab) => tab.name)).not.toEqual(before)

      model.undo()
      expect(store.tabs.map((tab) => tab.name)).toEqual(before)
    })
  })
})
