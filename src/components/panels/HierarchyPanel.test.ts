import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import HierarchyPanel from './HierarchyPanel.vue'
import { useTabsStore } from '@/stores/tabs'
import { useSelectionStore } from '@/stores/selection'
import { mapScope, useModelStore, PROJECT_SCOPE } from '@/stores/model'
import { assignRoomArea, paintCells, renameRoom, reorderRoom } from '@/core/ops/rooms'
import { createNewArea, renameArea } from '@/core/ops/project'
import { WORLD_AREA_ID } from '@/core/ids'
import type { AreaId, MapId, RoomId } from '@/core/ids'
import type { CellKey } from '@/core/cell'

// The tree, read-only: what it lists, in what order, and what it marks.
//
// Clicking a row selects nothing yet, so every selection here is made through
// the store, which is also the only source the tree is allowed to read.

describe('HierarchyPanel', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createTestPinia())
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  interface Fixture {
    mapId: MapId
    crateria: AreaId
    landing: RoomId
    corridor: RoomId
    vault: RoomId
  }

  // Two areas, three rooms: two in Crateria and one left in World, so every
  // assertion about grouping has both a positive and a negative case.
  function setup(): Fixture {
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    let crateria!: AreaId
    let landing!: RoomId
    let corridor!: RoomId
    let vault!: RoomId

    model.run('Area', PROJECT_SCOPE, (tx) => {
      crateria = createNewArea(tx, model.project, 'Crateria', '#3a5f7d', '#7fb2d9').id
    })
    model.run('Rooms', mapScope(mapId), (tx) => {
      const map = model.project.mapsById.get(mapId)!
      const paint = (cells: CellKey[], name: string, areaId: AreaId) => {
        const room = paintCells(tx, model.project, map, cells, { areaId })
        renameRoom(tx, map, room.id, name)
        return room.id
      }
      landing = paint(['0,0', '1,0'], 'Landing Site', crateria)
      corridor = paint(['3,0', '4,0'], 'Corridor', crateria)
      vault = paint(['0,5', '1,5'], 'Vault', WORLD_AREA_ID)
    })

    return { mapId, crateria, landing, corridor, vault }
  }

  function mountTree() {
    wrapper = mount(HierarchyPanel, { attachTo: document.body })
    return wrapper
  }

  function rows(panel: VueWrapper) {
    return panel.findAll('[role="treeitem"]').map((row) => ({
      kind: row.attributes('data-row-kind'),
      id: row.attributes('data-row-id'),
      label: row.get('.hierarchy-label').text(),
      selected: row.attributes('aria-selected') === 'true',
      level: row.attributes('aria-level'),
    }))
  }

  describe('what it lists', () => {
    it('groups rooms under their area, in project then room order', () => {
      const fixture = setup()
      const panel = mountTree()

      expect(rows(panel).map((row) => row.label)).toEqual([
        'World',
        'Vault',
        'Crateria',
        'Landing Site',
        'Corridor',
      ])
      expect(rows(panel).map((row) => row.kind)).toEqual(['area', 'room', 'area', 'room', 'room'])
      expect(rows(panel)[3].id).toBe(fixture.landing)
    })

    it('nests rooms one level below their area', () => {
      setup()
      const panel = mountTree()
      const levels = rows(panel).map((row) => row.level)
      expect(levels).toEqual(['1', '2', '1', '2', '2'])
    })

    it('follows roomOrder within an area, not creation order', () => {
      const { mapId, corridor } = setup()
      const model = useModelStore()

      model.run('Reorder', mapScope(mapId), (tx) =>
        reorderRoom(tx, model.project.mapsById.get(mapId)!, corridor, 0),
      )
      const panel = mountTree()

      expect(rows(panel).map((row) => row.label)).toEqual([
        'World',
        'Vault',
        'Crateria',
        'Corridor',
        'Landing Site',
      ])
    })

    // Areas are project-wide and rooms are per-tab, so an area with nothing
    // under it here is still the only way to reach it from this tab.
    it('shows an area with no rooms on this tab', () => {
      const { mapId } = setup()
      const tabs = useTabsStore()
      tabs.addTab()
      expect(tabs.activeTabId).not.toBe(mapId)

      const panel = mountTree()
      expect(rows(panel).map((row) => row.label)).toEqual(['World', 'Crateria'])
    })

    it('re-scopes its rooms when the tab changes', async () => {
      const { mapId } = setup()
      const tabs = useTabsStore()
      const panel = mountTree()
      expect(rows(panel)).toHaveLength(5)

      tabs.addTab()
      await nextTick()
      expect(rows(panel)).toHaveLength(2)

      tabs.activate(mapId)
      await nextTick()
      expect(rows(panel)).toHaveLength(5)
    })

    it('names an unnamed room by its first cell', () => {
      const model = useModelStore()
      const mapId = useTabsStore().activeTabId
      model.run('Rooms', mapScope(mapId), (tx) => {
        paintCells(tx, model.project, model.project.mapsById.get(mapId)!, ['4,2'], {
          areaId: WORLD_AREA_ID,
        })
      })

      const panel = mountTree()
      expect(rows(panel)[1].label).toBe('Room at 4,2')
    })

    it('follows a rename of a room and of an area', async () => {
      const { mapId, landing, crateria } = setup()
      const model = useModelStore()
      const panel = mountTree()

      model.run('Rename', mapScope(mapId), (tx) =>
        renameRoom(tx, model.project.mapsById.get(mapId)!, landing, 'Ship'),
      )
      model.run('Rename area', PROJECT_SCOPE, (tx) =>
        renameArea(tx, model.project, crateria, 'Norfair'),
      )
      await nextTick()

      const labels = rows(panel).map((row) => row.label)
      expect(labels).toContain('Ship')
      expect(labels).toContain('Norfair')
    })

    it('moves a room when its area is reassigned', async () => {
      const { mapId, landing } = setup()
      const model = useModelStore()
      const panel = mountTree()

      model.run('Reassign', mapScope(mapId), (tx) =>
        assignRoomArea(tx, model.project.mapsById.get(mapId)!, landing, WORLD_AREA_ID),
      )
      await nextTick()

      // `roomOrder` is map-wide, so the reassigned room takes its existing
      // place among World's rooms rather than landing at the end of them.
      expect(rows(panel).map((row) => row.label)).toEqual([
        'World',
        'Landing Site',
        'Vault',
        'Crateria',
        'Corridor',
      ])
    })
  })

  describe('what it marks', () => {
    it('marks a selected room, and only it', async () => {
      const { mapId, landing } = setup()
      const panel = mountTree()
      useSelectionStore().set([{ kind: 'room', id: landing }], mapId)
      await nextTick()

      const marked = rows(panel).filter((row) => row.selected)
      expect(marked.map((row) => row.id)).toEqual([landing])
    })

    it('marks a selected area', async () => {
      const { mapId, crateria } = setup()
      const panel = mountTree()
      useSelectionStore().set([{ kind: 'area', id: crateria }], mapId)
      await nextTick()

      expect(
        rows(panel)
          .filter((row) => row.selected)
          .map((row) => row.id),
      ).toEqual([crateria])
    })

    it('marks every room of a multi-selection', async () => {
      const { mapId, landing, vault } = setup()
      const panel = mountTree()
      useSelectionStore().set(
        [
          { kind: 'room', id: landing },
          { kind: 'room', id: vault },
        ],
        mapId,
      )
      await nextTick()

      expect(
        rows(panel)
          .filter((row) => row.selected)
          .map((row) => row.id)
          .sort(),
      ).toEqual([landing, vault].sort())
    })

    // A cell selection has no row: the room that owns it is not what is
    // selected, and marking it would say otherwise.
    it('marks nothing for a cell selection', async () => {
      const { mapId } = setup()
      const panel = mountTree()
      useSelectionStore().set([{ kind: 'cell', id: '0,0' }], mapId)
      await nextTick()

      expect(rows(panel).some((row) => row.selected)).toBe(false)
    })

    // Areas are project-wide, so an area row exists on every tab and the
    // per-tab gate is the only thing stopping one selected elsewhere from
    // lighting up here. A room selection is gated by `roomsOn` for free, which
    // is why this case needs its own test.
    it('marks nothing for an area selected on another tab', async () => {
      const { mapId, crateria } = setup()
      const tabs = useTabsStore()
      const panel = mountTree()
      useSelectionStore().set([{ kind: 'area', id: crateria }], mapId)
      await nextTick()
      expect(rows(panel).some((row) => row.selected)).toBe(true)

      tabs.addTab()
      await nextTick()
      expect(rows(panel).some((row) => row.selected)).toBe(false)
    })

    it('marks nothing for a selection left on another tab', async () => {
      const { mapId, landing } = setup()
      const tabs = useTabsStore()
      const panel = mountTree()
      useSelectionStore().set([{ kind: 'room', id: landing }], mapId)
      await nextTick()
      expect(rows(panel).some((row) => row.selected)).toBe(true)

      tabs.addTab()
      await nextTick()
      expect(rows(panel).some((row) => row.selected)).toBe(false)
    })
  })

  describe('expanding and collapsing', () => {
    it('hides an area’s rooms when collapsed, and brings them back', async () => {
      setup()
      const panel = mountTree()
      const crateriaRow = panel.findAll('[role="treeitem"]')[2]
      expect(crateriaRow.attributes('aria-expanded')).toBe('true')

      await crateriaRow.get('.hierarchy-twisty').trigger('click')

      expect(rows(panel).map((row) => row.label)).toEqual(['World', 'Vault', 'Crateria'])
      expect(panel.findAll('[role="treeitem"]')[2].attributes('aria-expanded')).toBe('false')

      await panel.findAll('[role="treeitem"]')[2].get('.hierarchy-twisty').trigger('click')
      expect(rows(panel)).toHaveLength(5)
    })

    // ARIA wants `aria-expanded` only where there is something to expand.
    it('gives an empty area no twisty and no expanded state', () => {
      const model = useModelStore()
      model.run('Area', PROJECT_SCOPE, (tx) =>
        createNewArea(tx, model.project, 'Empty', '#111111', '#222222'),
      )
      const panel = mountTree()

      const empty = panel.findAll('[role="treeitem"]').at(-1)!
      expect(empty.get('.hierarchy-label').text()).toBe('Empty')
      expect(empty.attributes('aria-expanded')).toBeUndefined()
      expect(empty.find('.hierarchy-twisty').exists()).toBe(false)
    })
  })

  describe('the keyboard', () => {
    function treeitems(panel: VueWrapper) {
      return panel.findAll('[role="treeitem"]')
    }

    it('is one tab stop, with the arrows moving inside it', async () => {
      setup()
      const panel = mountTree()
      const items = treeitems(panel)
      expect(items.map((item) => item.attributes('tabindex'))).toEqual([
        '0',
        '-1',
        '-1',
        '-1',
        '-1',
      ])

      await items[0].trigger('keydown', { key: 'ArrowDown' })
      expect(treeitems(panel).map((item) => item.attributes('tabindex'))).toEqual([
        '-1',
        '0',
        '-1',
        '-1',
        '-1',
      ])
      expect(document.activeElement).toBe(treeitems(panel)[1].element)
    })

    it('stops at both ends rather than wrapping', async () => {
      setup()
      const panel = mountTree()
      await treeitems(panel)[0].trigger('keydown', { key: 'ArrowUp' })
      expect(document.activeElement).toBe(treeitems(panel)[0].element)

      await treeitems(panel)[0].trigger('keydown', { key: 'End' })
      expect(document.activeElement).toBe(treeitems(panel)[4].element)
      await treeitems(panel)[4].trigger('keydown', { key: 'ArrowDown' })
      expect(document.activeElement).toBe(treeitems(panel)[4].element)

      await treeitems(panel)[4].trigger('keydown', { key: 'Home' })
      expect(document.activeElement).toBe(treeitems(panel)[0].element)
    })

    it('closes an area with Left and opens it with Right', async () => {
      setup()
      const panel = mountTree()

      await treeitems(panel)[2].trigger('keydown', { key: 'ArrowLeft' })
      expect(rows(panel)).toHaveLength(3)

      await treeitems(panel)[2].trigger('keydown', { key: 'ArrowRight' })
      expect(rows(panel)).toHaveLength(5)
    })

    it('steps into an open area with Right, and back out of a room with Left', async () => {
      setup()
      const panel = mountTree()

      await treeitems(panel)[2].trigger('keydown', { key: 'ArrowRight' })
      expect(document.activeElement).toBe(treeitems(panel)[3].element)

      await treeitems(panel)[3].trigger('keydown', { key: 'ArrowLeft' })
      expect(document.activeElement).toBe(treeitems(panel)[2].element)
    })
  })

  describe('the filter', () => {
    async function filterFor(panel: VueWrapper, text: string) {
      await panel.get('.hierarchy-filter').setValue(text)
    }

    it('keeps a matching room and the area that holds it', async () => {
      setup()
      const panel = mountTree()
      await filterFor(panel, 'corr')

      expect(rows(panel).map((row) => row.label)).toEqual(['Crateria', 'Corridor'])
    })

    it('keeps every room of a matching area', async () => {
      setup()
      const panel = mountTree()
      await filterFor(panel, 'crateria')

      expect(rows(panel).map((row) => row.label)).toEqual(['Crateria', 'Landing Site', 'Corridor'])
    })

    it('is case-insensitive and matches anywhere in the name', async () => {
      setup()
      const panel = mountTree()
      await filterFor(panel, 'SITE')
      expect(rows(panel).map((row) => row.label)).toEqual(['Crateria', 'Landing Site'])
    })

    it('says so rather than showing an empty tree', async () => {
      setup()
      const panel = mountTree()
      await filterFor(panel, 'zzz')

      expect(rows(panel)).toHaveLength(0)
      expect(panel.get('.hierarchy-empty').text()).toContain('zzz')
    })

    // A match hidden under a closed area makes the filter look broken.
    it('reveals matches inside a collapsed area, and restores the collapse after', async () => {
      setup()
      const panel = mountTree()
      await panel.findAll('[role="treeitem"]')[2].get('.hierarchy-twisty').trigger('click')
      expect(rows(panel)).toHaveLength(3)

      await filterFor(panel, 'corr')
      expect(rows(panel).map((row) => row.label)).toEqual(['Crateria', 'Corridor'])

      await filterFor(panel, '')
      expect(rows(panel).map((row) => row.label)).toEqual(['World', 'Vault', 'Crateria'])
    })

    // Filtering narrows what is shown and nothing else.
    it('leaves a filtered-out row selected', async () => {
      const { mapId, vault } = setup()
      const panel = mountTree()
      useSelectionStore().set([{ kind: 'room', id: vault }], mapId)
      await nextTick()

      await filterFor(panel, 'corr')
      expect(rows(panel).some((row) => row.id === vault)).toBe(false)
      expect(useSelectionStore().roomsOn(mapId)).toEqual([vault])

      await filterFor(panel, '')
      expect(rows(panel).find((row) => row.id === vault)?.selected).toBe(true)
    })

    it('leaves no undo entry', async () => {
      setup()
      const model = useModelStore()
      const panel = mountTree()
      const before = model.status.undoLabel

      await filterFor(panel, 'corr')

      expect(model.status.undoLabel).toBe(before)
    })
  })

  describe('adding an area', () => {
    it('appends one with a fresh name, as one undo step', async () => {
      setup()
      const model = useModelStore()
      const panel = mountTree()

      await panel.get('.hierarchy-add').trigger('click')

      expect(rows(panel).map((row) => row.label)).toEqual([
        'World',
        'Vault',
        'Crateria',
        'Landing Site',
        'Corridor',
        'Area 1',
      ])
      expect(model.status.undoLabel).toBe('Add Area')
    })

    it('fills the lowest unused number', async () => {
      setup()
      const panel = mountTree()

      await panel.get('.hierarchy-add').trigger('click')
      await panel.get('.hierarchy-add').trigger('click')
      expect(rows(panel).map((row) => row.label)).toContain('Area 2')

      // Removing the first leaves its number free again.
      const model = useModelStore()
      model.undo()
      model.undo()
      await nextTick()
      await panel.get('.hierarchy-add').trigger('click')
      expect(rows(panel).map((row) => row.label)).toContain('Area 1')
    })

    it('gives consecutive areas different colours', async () => {
      const model = useModelStore()
      const panel = mountTree()
      await panel.get('.hierarchy-add').trigger('click')
      await panel.get('.hierarchy-add').trigger('click')

      const created = [...model.project.areas.values()].filter((area) => area.id !== WORLD_AREA_ID)
      expect(created).toHaveLength(2)
      expect(created[0].cellColor).not.toBe(created[1].cellColor)
    })

    it('arrives with no rooms and no twisty', async () => {
      setup()
      const panel = mountTree()
      await panel.get('.hierarchy-add').trigger('click')

      const added = panel.findAll('[role="treeitem"]').at(-1)!
      expect(added.attributes('aria-expanded')).toBeUndefined()
      expect(added.find('.hierarchy-twisty').exists()).toBe(false)
    })
  })

  describe('the row', () => {
    it('carries an icon per kind, in front of the name', () => {
      setup()
      const panel = mountTree()
      const area = panel.findAll('[role="treeitem"]')[0]
      const room = panel.findAll('[role="treeitem"]')[1]

      expect(area.find('.tree-icon').exists()).toBe(true)
      expect(room.find('.tree-icon').exists()).toBe(true)
      // The icon is decoration, and the row names itself: a name computed from
      // its contents would fold in the twisty's own label.
      expect(area.get('.tree-icon').attributes('aria-hidden')).toBe('true')
      expect(area.attributes('aria-label')).toBe('World')
      expect(room.attributes('aria-label')).toBe('Vault')
    })
  })
})
