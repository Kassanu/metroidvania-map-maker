import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { createTestPinia } from '@/test-setup'
import { useTabsStore } from './tabs'
import { mapScope, useModelStore } from './model'
import { MAX_ZOOM, MIN_ZOOM } from '@/canvas/camera'
import { pageBounds } from '@/canvas/page'
import { paintCells } from '@/core/ops/rooms'
import { renameMap } from '@/core/ops/maps'
import { checkInvariants } from '@/core/testUtils'
import { createProject } from '@/core/factory'
import { fromJSON, toJSON } from '@/core/serialize'
import { WORLD_AREA_ID } from '@/core/ids'
import type { MapId } from '@/core/ids'
import type { CellKey } from '@/core/cell'

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
      // No canvas has been measured, so nothing has been centred: the tab
      // reads as unseen, which puts world (0,0) at the canvas origin.
      expect(store.activeTab!.pan).toEqual({ x: 0, y: 0 })
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
      expect(store.cameraOf(first.id).pan).toEqual({ x: 0, y: 0 })
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

// One describe per row of the camera's default table. Every row is about the
// same question: has this tab been looked at, and if not, where does it open?
describe('the default camera', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  const VIEW = { width: 800, height: 600 }

  // Where centring puts the pan for a given world middle, from the same
  // convention `centerOn` uses: pan is the world point at the top-left corner.
  function panFor(middleX: number, middleY: number) {
    const scale = useModelStore().tileSize
    return { x: middleX - VIEW.width / 2 / scale, y: middleY - VIEW.height / 2 / scale }
  }

  function paint(mapId: MapId, cells: string[]) {
    const model = useModelStore()
    model.run('Paint', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, model.project.mapsById.get(mapId)!, cells as CellKey[], {
        areaId: WORLD_AREA_ID,
      }),
    )
  }

  it('centres a blank map on world (0,0)', () => {
    const store = useTabsStore()
    store.setViewport(VIEW)
    store.centerIfUnseen(store.activeTabId)

    // Home is 21x21 about the origin, so its middle is the middle of cell 0.
    expect(store.cameraOf(store.activeTabId).pan).toEqual(panFor(0.5, 0.5))
    expect(store.cameraOf(store.activeTabId).zoom).toBe(1)
  })

  it('centres a map with content on the content, not on the page', () => {
    const store = useTabsStore()
    // Far enough from home that the page spans the gap and the two answers
    // differ: centring the page here would look at the empty middle.
    paint(store.activeTabId, ['100,100', '101,100', '102,100'])
    store.setViewport(VIEW)
    store.centerIfUnseen(store.activeTabId)

    // Padded content is 98..104 by 98..102, so its middle is (101.5, 100.5).
    expect(store.cameraOf(store.activeTabId).pan).toEqual(panFor(101.5, 100.5))
  })

  it('shows the content it centred on, which is what a far map needs', () => {
    const store = useTabsStore()
    paint(store.activeTabId, ['100,100', '101,100', '102,100'])
    store.setViewport(VIEW)
    store.centerIfUnseen(store.activeTabId)

    const { pan, zoom } = store.cameraOf(store.activeTabId)
    const scale = useModelStore().tileSize * zoom
    const right = pan.x + VIEW.width / scale
    expect(pan.x).toBeLessThan(100)
    expect(right).toBeGreaterThan(103)
  })

  it('does nothing until the canvas has a size', () => {
    const store = useTabsStore()
    store.centerIfUnseen(store.activeTabId)
    expect(store.hasBeenSeen(store.activeTabId)).toBe(false)

    store.setViewport({ width: 0, height: 0 })
    store.centerIfUnseen(store.activeTabId)
    expect(store.hasBeenSeen(store.activeTabId)).toBe(false)
  })

  it('centres a newly added tab on its own blank page', () => {
    const store = useTabsStore()
    store.setViewport(VIEW)
    store.addTab()
    store.centerIfUnseen(store.activeTabId)

    expect(store.cameraOf(store.activeTabId).pan).toEqual(panFor(0.5, 0.5))
  })

  it('leaves a duplicated tab with its source camera rather than centring it', () => {
    const store = useTabsStore()
    store.setViewport(VIEW)
    const source = store.activeTabId
    store.setPan(source, { x: 40, y: 40 })

    store.duplicateTab(source)
    const copy = store.activeTabId
    store.centerIfUnseen(copy)

    expect(copy).not.toBe(source)
    expect(store.cameraOf(copy).pan).toEqual({ x: 40, y: 40 })
  })

  it('leaves a tab that has been looked at alone when it is switched back to', () => {
    const store = useTabsStore()
    store.setViewport(VIEW)
    const first = store.activeTabId
    store.setPan(first, { x: 7, y: -3 })
    store.addTab()

    store.activate(first)
    store.centerIfUnseen(first)

    expect(store.cameraOf(first).pan).toEqual({ x: 7, y: -3 })
  })

  it('keeps a camera through the undo that brings its tab back', () => {
    const store = useTabsStore()
    const model = useModelStore()
    store.setViewport(VIEW)
    store.addTab()
    const added = store.activeTabId
    store.setPan(added, { x: 12, y: 9 })

    store.deleteTab(added)
    model.undo()
    store.centerIfUnseen(added)

    expect(store.cameraOf(added).pan).toEqual({ x: 12, y: 9 })
  })

  it('does not recentre when the canvas is measured again', () => {
    const store = useTabsStore()
    store.setViewport(VIEW)
    store.centerIfUnseen(store.activeTabId)
    const opened = store.cameraOf(store.activeTabId).pan

    // A window resize, or a sidebar being collapsed: a new measurement, and
    // the camera belongs to the user by now whatever it says.
    store.setViewport({ width: 1200, height: 900 })
    store.centerIfUnseen(store.activeTabId)

    expect(store.cameraOf(store.activeTabId).pan).toEqual(opened)
  })

  // Reopening the same file, which is the case that needs this: a saved project
  // carries its own map ids, so the incoming tabs have the ids the outgoing
  // cameras are filed under. A swap to a freshly created project would pass
  // whether or not anything was forgotten, because its ids are new.
  it('forgets every camera when a project is opened over this one', async () => {
    const store = useTabsStore()
    const model = useModelStore()
    store.setViewport(VIEW)
    const mapId = store.activeTabId
    paint(mapId, ['100,100', '101,100'])
    store.setPan(mapId, { x: 99, y: 99 })

    // The round trip is what a reopen is: same ids, different objects.
    const reopened = fromJSON(toJSON(model.project))
    model.replaceProject(reopened.project)
    await nextTick()

    expect(store.activeTabId).toBe(mapId)
    expect(store.hasBeenSeen(mapId)).toBe(false)
    store.centerIfUnseen(mapId)
    // Two cells at 100..101 by 100, padded to 98..103 by 98..102.
    expect(store.cameraOf(mapId).pan).toEqual(panFor(101, 100.5))
  })
})

describe('Reset View', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  const VIEW = { width: 800, height: 600 }

  it('returns the tab to the view it opened with', () => {
    const store = useTabsStore()
    store.setViewport(VIEW)
    const mapId = store.activeTabId
    store.centerIfUnseen(mapId)
    const opened = store.cameraOf(mapId)

    store.setCamera(mapId, { pan: { x: 400, y: -250 }, zoom: 3 })
    store.resetView(mapId)

    expect(store.cameraOf(mapId)).toEqual(opened)
  })

  it('centres on the content, so it follows the map rather than the origin', () => {
    const store = useTabsStore()
    const model = useModelStore()
    const mapId = store.activeTabId
    model.run('Paint', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, model.project.mapsById.get(mapId)!, ['60,60'] as CellKey[], {
        areaId: WORLD_AREA_ID,
      }),
    )
    store.setViewport(VIEW)
    store.setCamera(mapId, { pan: { x: 0, y: 0 }, zoom: 4 })

    store.resetView(mapId)

    const scale = useModelStore().tileSize
    // One cell at 60,60 pads to 58..62, whose middle is 60.5 on both axes.
    expect(store.cameraOf(mapId).zoom).toBe(1)
    expect(store.cameraOf(mapId).pan).toEqual({
      x: 60.5 - VIEW.width / 2 / scale,
      y: 60.5 - VIEW.height / 2 / scale,
    })
  })

  it('still returns zoom to 1 when there is no canvas to centre against', () => {
    const store = useTabsStore()
    const mapId = store.activeTabId
    store.setCamera(mapId, { pan: { x: 5, y: 5 }, zoom: 4 })

    store.resetView(mapId)

    expect(store.cameraOf(mapId).zoom).toBe(1)
    expect(store.cameraOf(mapId).pan).toEqual({ x: 5, y: 5 })
  })

  // mod+0 is the browser's convention for "back to 100%", and keeping your
  // place while doing it is the point of having both commands.
  it('is not what the zoom-reset hotkey does', () => {
    const store = useTabsStore()
    store.setViewport(VIEW)
    const mapId = store.activeTabId
    store.setCamera(mapId, { pan: { x: 5, y: 5 }, zoom: 4 })

    store.resetZoom(mapId)

    expect(store.cameraOf(mapId).zoom).toBe(1)
    expect(store.cameraOf(mapId).pan).toEqual({ x: 5, y: 5 })
  })
})
