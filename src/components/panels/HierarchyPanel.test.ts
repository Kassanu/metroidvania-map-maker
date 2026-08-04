import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import HierarchyPanel from './HierarchyPanel.vue'
import { useTabsStore } from '@/stores/tabs'
import { useSelectionStore } from '@/stores/selection'
import { useModeStore } from '@/stores/mode'
import { mapScope, useModelStore, PROJECT_SCOPE } from '@/stores/model'
import { assignRoomArea, paintCells, renameRoom, reorderRoom } from '@/core/ops/rooms'
import { createNewArea, deleteArea, renameArea } from '@/core/ops/project'
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

  // The label comes off `aria-label` rather than the rendered span, because a
  // row being renamed shows an input in its place and the row is still a row.
  function rows(panel: VueWrapper) {
    return panel.findAll('[role="treeitem"]').map((row) => ({
      kind: row.attributes('data-row-kind'),
      id: row.attributes('data-row-id'),
      label: row.attributes('aria-label'),
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

  describe('selecting from the tree', () => {
    function treeitems(panel: VueWrapper) {
      return panel.findAll('[role="treeitem"]')
    }

    it('clicking a room selects it in the one store', async () => {
      const { mapId, landing } = setup()
      const panel = mountTree()

      await treeitems(panel)[3].trigger('click')

      expect(useSelectionStore().roomsOn(mapId)).toEqual([landing])
      expect(rows(panel)[3].selected).toBe(true)
    })

    // Areas reach the selection from here and from nowhere else: they have no
    // canvas body beyond their bbox border.
    it('clicking an area selects it, which no other surface can do', async () => {
      const { mapId, crateria } = setup()
      const panel = mountTree()

      await treeitems(panel)[2].trigger('click')

      const selection = useSelectionStore()
      expect(selection.selected).toEqual([{ kind: 'area', id: crateria }])
      expect(selection.mapId).toBe(mapId)
    })

    it('replaces on click and toggles on shift-click', async () => {
      const { mapId, landing, corridor } = setup()
      const panel = mountTree()

      await treeitems(panel)[3].trigger('click')
      await treeitems(panel)[4].trigger('click')
      expect(useSelectionStore().roomsOn(mapId)).toEqual([corridor])

      await treeitems(panel)[3].trigger('click', { shiftKey: true })
      expect(useSelectionStore().roomsOn(mapId)).toEqual([corridor, landing])

      await treeitems(panel)[3].trigger('click', { shiftKey: true })
      expect(useSelectionStore().roomsOn(mapId)).toEqual([corridor])
    })

    it('mixes an area and a room in one selection', async () => {
      const { crateria, landing } = setup()
      const panel = mountTree()

      await treeitems(panel)[2].trigger('click')
      await treeitems(panel)[3].trigger('click', { shiftKey: true })

      expect(useSelectionStore().selected).toEqual([
        { kind: 'area', id: crateria },
        { kind: 'room', id: landing },
      ])
    })

    it('does not change the mode', async () => {
      setup()
      const mode = useModeStore()
      mode.setMode('draw')
      const panel = mountTree()

      await treeitems(panel)[3].trigger('click')

      expect(mode.active).toBe('draw')
    })

    it('leaves no undo entry: selecting is never an edit', async () => {
      setup()
      const model = useModelStore()
      const panel = mountTree()
      const before = model.status.undoLabel

      await treeitems(panel)[3].trigger('click')

      expect(model.status.undoLabel).toBe(before)
    })

    it('clicking the twisty toggles without selecting', async () => {
      setup()
      const panel = mountTree()

      await treeitems(panel)[2].get('.hierarchy-twisty').trigger('click')

      expect(useSelectionStore().isEmpty).toBe(true)
      expect(rows(panel)).toHaveLength(3)
    })

    it('selects the focused row from the keyboard', async () => {
      const { mapId, landing } = setup()
      const panel = mountTree()

      await treeitems(panel)[3].trigger('keydown', { key: 'Enter' })

      expect(useSelectionStore().roomsOn(mapId)).toEqual([landing])
    })
  })

  describe('an area in the selection', () => {
    it('drops out when the area is deleted', async () => {
      const { mapId, crateria } = setup()
      const model = useModelStore()
      const selection = useSelectionStore()
      mountTree()
      selection.set([{ kind: 'area', id: crateria }], mapId)
      expect(selection.isEmpty).toBe(false)

      model.run('Delete', PROJECT_SCOPE, (tx) => deleteArea(tx, model.project, crateria))
      await nextTick()

      expect(selection.isEmpty).toBe(true)
    })

    // Adding an area bumps `structureRev` and nothing else, so undoing it is
    // the case a prune watching `rev` alone would sleep through.
    it('drops out when the step that added the area is undone', async () => {
      const { mapId } = setup()
      const model = useModelStore()
      const selection = useSelectionStore()
      const panel = mountTree()

      await panel.get('.hierarchy-add').trigger('click')
      const added = [...model.project.areas.values()].at(-1)!
      selection.set([{ kind: 'area', id: added.id }], mapId)
      expect(selection.isEmpty).toBe(false)

      model.undo()
      await nextTick()

      expect(selection.isEmpty).toBe(true)
    })

    it('leaves a room in the same selection alone', async () => {
      const { mapId, crateria, landing } = setup()
      const model = useModelStore()
      const selection = useSelectionStore()
      mountTree()
      selection.set(
        [
          { kind: 'area', id: crateria },
          { kind: 'room', id: landing },
        ],
        mapId,
      )

      model.run('Delete', PROJECT_SCOPE, (tx) => deleteArea(tx, model.project, crateria))
      await nextTick()

      expect(selection.roomsOn(mapId)).toEqual([landing])
    })
  })

  describe('inline rename', () => {
    function treeitems(panel: VueWrapper) {
      return panel.findAll('[role="treeitem"]')
    }

    function rename(panel: VueWrapper) {
      return panel.get('.hierarchy-rename')
    }

    it('renames a room on double-click, committing on Enter', async () => {
      const { mapId, landing } = setup()
      const panel = mountTree()

      await treeitems(panel)[3].trigger('dblclick')
      await rename(panel).setValue('Ship')
      await rename(panel).trigger('keydown.enter')

      expect(useModelStore().project.mapsById.get(mapId)!.rooms.get(landing)!.name).toBe('Ship')
      expect(useModelStore().status.undoLabel).toBe('Rename Room')
      expect(panel.find('.hierarchy-rename').exists()).toBe(false)
    })

    it('renames an area, through the project scope', async () => {
      const { crateria } = setup()
      const panel = mountTree()

      await treeitems(panel)[2].trigger('dblclick')
      await rename(panel).setValue('Norfair')
      await rename(panel).trigger('keydown.enter')

      expect(useModelStore().project.areas.get(crateria)!.name).toBe('Norfair')
      expect(useModelStore().status.undoLabel).toBe('Rename Area')
    })

    it('commits on blur too', async () => {
      const { crateria } = setup()
      const panel = mountTree()

      await treeitems(panel)[2].trigger('dblclick')
      await rename(panel).setValue('Maridia')
      await rename(panel).trigger('blur')

      expect(useModelStore().project.areas.get(crateria)!.name).toBe('Maridia')
    })

    it('abandons on Escape, leaving the name alone', async () => {
      const { crateria } = setup()
      const panel = mountTree()

      await treeitems(panel)[2].trigger('dblclick')
      await rename(panel).setValue('Discarded')
      await rename(panel).trigger('keydown.esc')

      expect(useModelStore().project.areas.get(crateria)!.name).toBe('Crateria')
      expect(panel.find('.hierarchy-rename').exists()).toBe(false)
    })

    it('refuses a blank name', async () => {
      const { crateria } = setup()
      const panel = mountTree()

      await treeitems(panel)[2].trigger('dblclick')
      await rename(panel).setValue('   ')
      await rename(panel).trigger('keydown.enter')

      expect(useModelStore().project.areas.get(crateria)!.name).toBe('Crateria')
    })

    // The row shows a positional fallback for an unnamed room, and seeding the
    // editor with it would turn the display text into the room's actual name.
    it('starts an unnamed room’s editor empty, not from its fallback label', async () => {
      const model = useModelStore()
      const mapId = useTabsStore().activeTabId
      model.run('Rooms', mapScope(mapId), (tx) => {
        paintCells(tx, model.project, model.project.mapsById.get(mapId)!, ['4,2'], {
          areaId: WORLD_AREA_ID,
        })
      })
      const panel = mountTree()
      expect(rows(panel)[1].label).toBe('Room at 4,2')

      await treeitems(panel)[1].trigger('dblclick')

      expect((rename(panel).element as HTMLInputElement).value).toBe('')
    })

    it('World offers no editor at all', async () => {
      setup()
      const panel = mountTree()

      await treeitems(panel)[0].trigger('dblclick')

      expect(panel.find('.hierarchy-rename').exists()).toBe(false)
      expect(useModelStore().project.areas.get(WORLD_AREA_ID)!.name).toBe('World')
    })

    it('opens from F2 as well as the pointer', async () => {
      setup()
      const panel = mountTree()

      await treeitems(panel)[3].trigger('keydown', { key: 'F2' })

      expect(panel.find('.hierarchy-rename').exists()).toBe(true)
    })

    // The row's own arrow keys would otherwise move focus out from under the
    // caret while typing.
    it('keeps the arrow keys inside the editor', async () => {
      setup()
      const panel = mountTree()
      await treeitems(panel)[3].trigger('dblclick')

      await rename(panel).trigger('keydown', { key: 'ArrowDown' })

      expect(panel.find('.hierarchy-rename').exists()).toBe(true)
      expect(rows(panel)).toHaveLength(5)
    })

    it('clicking in the editor does not re-select the row', async () => {
      const { mapId, landing } = setup()
      const panel = mountTree()
      await treeitems(panel)[3].trigger('click')
      expect(useSelectionStore().roomsOn(mapId)).toEqual([landing])

      await treeitems(panel)[3].trigger('dblclick')
      await rename(panel).trigger('click')

      expect(useSelectionStore().roomsOn(mapId)).toEqual([landing])
    })

    it('the + button creates an area and opens its editor', async () => {
      setup()
      const panel = mountTree()

      await panel.get('.hierarchy-add').trigger('click')
      await nextTick()

      const editor = rename(panel)
      expect(editor.attributes('data-row-id')).toBe(
        [...useModelStore().project.areas.values()].at(-1)!.id,
      )
      expect((editor.element as HTMLInputElement).value).toBe('Area 1')

      await editor.setValue('Tourian')
      await editor.trigger('keydown.enter')
      expect([...useModelStore().project.areas.values()].at(-1)!.name).toBe('Tourian')
    })
  })

  describe('the row menu', () => {
    function treeitems(panel: VueWrapper) {
      return panel.findAll('[role="treeitem"]')
    }

    async function openMenuOn(panel: VueWrapper, index: number) {
      await treeitems(panel)[index].trigger('contextmenu')
      await nextTick()
      return document.querySelectorAll('[role="menuitem"]')
    }

    function itemNamed(items: NodeListOf<Element>, label: string) {
      return Array.from(items).find((item) => item.textContent?.trim() === label)!
    }

    it('offers all four verbs on a room', async () => {
      setup()
      const panel = mountTree()
      const items = await openMenuOn(panel, 3)

      expect(Array.from(items).map((item) => item.textContent?.trim())).toEqual([
        'Rename',
        'Duplicate',
        'New area from this room',
        'Delete',
      ])
      for (const item of items) {
        expect(item.getAttribute('aria-disabled')).not.toBe('true')
      }
    })

    // An area is not a room: it cannot be duplicated and it is not the subject
    // of "new area from this room".
    it('disables the room-only verbs on an area', async () => {
      setup()
      const panel = mountTree()
      const items = await openMenuOn(panel, 2)

      expect(itemNamed(items, 'Rename').getAttribute('aria-disabled')).not.toBe('true')
      expect(itemNamed(items, 'Delete').getAttribute('aria-disabled')).not.toBe('true')
      expect(itemNamed(items, 'Duplicate').getAttribute('aria-disabled')).toBe('true')
      expect(itemNamed(items, 'New area from this room').getAttribute('aria-disabled')).toBe('true')
    })

    it('offers World neither of its two', async () => {
      setup()
      const panel = mountTree()
      const items = await openMenuOn(panel, 0)

      expect(itemNamed(items, 'Rename').getAttribute('aria-disabled')).toBe('true')
      expect(itemNamed(items, 'Delete').getAttribute('aria-disabled')).toBe('true')
    })

    // Pass 6's canvas rule, and the tree has no reason to differ.
    it('right-clicking an unselected row selects it alone first', async () => {
      const { mapId, landing, vault } = setup()
      const panel = mountTree()
      useSelectionStore().set([{ kind: 'room', id: vault }], mapId)
      await nextTick()

      await treeitems(panel)[3].trigger('contextmenu')

      expect(useSelectionStore().roomsOn(mapId)).toEqual([landing])
    })

    it('right-clicking inside a multi-selection leaves it whole', async () => {
      const { mapId, landing, vault } = setup()
      const panel = mountTree()
      useSelectionStore().set(
        [
          { kind: 'room', id: vault },
          { kind: 'room', id: landing },
        ],
        mapId,
      )
      await nextTick()

      await treeitems(panel)[3].trigger('contextmenu')

      expect(useSelectionStore().roomsOn(mapId)).toEqual([vault, landing])
    })
  })

  describe('the menu verbs', () => {
    function treeitems(panel: VueWrapper) {
      return panel.findAll('[role="treeitem"]')
    }

    async function run(panel: VueWrapper, index: number, label: string) {
      await treeitems(panel)[index].trigger('contextmenu')
      await nextTick()
      const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
        (each) => each.textContent?.trim() === label,
      )!
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await nextTick()
    }

    // Deferred until the menu has closed: Reka returns focus to the trigger on
    // the way out, and an editor opened before that is blurred straight back
    // shut, committing an edit nobody typed.
    it('Rename opens the editor, and it stays open', async () => {
      setup()
      const panel = mountTree()
      await run(panel, 3, 'Rename')
      await nextTick()
      await nextTick()
      expect(panel.find('.hierarchy-rename').exists()).toBe(true)
      expect((panel.get('.hierarchy-rename').element as HTMLInputElement).value).toBe(
        'Landing Site',
      )
    })

    it('Duplicate copies the room with the locked suffix, and selects the copy', async () => {
      const { mapId } = setup()
      const panel = mountTree()

      await run(panel, 3, 'Duplicate')

      const model = useModelStore()
      const names = [...model.project.mapsById.get(mapId)!.rooms.values()].map((room) => room.name)
      expect(names).toContain('Landing Site copy')
      expect(model.status.undoLabel).toBe('Duplicate')

      const copy = [...model.project.mapsById.get(mapId)!.rooms.values()].find(
        (room) => room.name === 'Landing Site copy',
      )!
      expect(useSelectionStore().roomsOn(mapId)).toEqual([copy.id])
    })

    // Works in every mode, unlike the canvas clipboard verbs: the tree is
    // mode-independent, so it owns the op rather than routing through the
    // Select-only action.
    it('Duplicate works outside Select mode', async () => {
      const { mapId } = setup()
      useModeStore().setMode('draw')
      const panel = mountTree()

      await run(panel, 3, 'Duplicate')

      const names = [...useModelStore().project.mapsById.get(mapId)!.rooms.values()].map(
        (room) => room.name,
      )
      expect(names).toContain('Landing Site copy')
    })

    it('Delete removes a room with no confirmation', async () => {
      const { mapId, landing } = setup()
      const panel = mountTree()

      await run(panel, 3, 'Delete')

      expect(useModelStore().project.mapsById.get(mapId)!.rooms.has(landing)).toBe(false)
      expect(useModelStore().status.undoLabel).toBe('Delete Room')
    })

    it('New area from this room creates one, moves the room in, and names it', async () => {
      const { mapId, landing } = setup()
      const panel = mountTree()

      await run(panel, 3, 'New area from this room')
      await nextTick()

      const model = useModelStore()
      const area = [...model.project.areas.values()].at(-1)!
      expect(model.project.mapsById.get(mapId)!.rooms.get(landing)!.areaId).toBe(area.id)
      expect(model.status.undoLabel).toBe('New Area From Room')
      // Fresh and unnamed is the state nobody wants, so its editor is already open.
      expect(panel.find('.hierarchy-rename').exists()).toBe(true)
    })

    it('is one undo step, area and room together', async () => {
      const { mapId, landing } = setup()
      const panel = mountTree()
      const before = useModelStore().project.mapsById.get(mapId)!.rooms.get(landing)!.areaId

      await run(panel, 3, 'New area from this room')
      const model = useModelStore()
      const created = model.project.areas.size

      model.undo()

      expect(model.project.areas.size).toBe(created - 1)
      expect(model.project.mapsById.get(mapId)!.rooms.get(landing)!.areaId).toBe(before)
    })
  })

  describe('deleting an area', () => {
    function treeitems(panel: VueWrapper) {
      return panel.findAll('[role="treeitem"]')
    }

    async function openDeleteDialog(panel: VueWrapper, index: number) {
      await treeitems(panel)[index].trigger('contextmenu')
      await nextTick()
      const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
        (each) => each.textContent?.trim() === 'Delete',
      )!
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await nextTick()
      await nextTick()
    }

    // A pre-action query, never something the op returns: the confirmation is
    // asked ahead of the action.
    it('asks first, counting the rooms that move to World', async () => {
      setup()
      const panel = mountTree()

      await openDeleteDialog(panel, 2)

      const dialog = document.querySelector('[role="alertdialog"]')!
      expect(dialog.textContent).toContain('Crateria')
      expect(dialog.textContent).toContain('2')
    })

    it('reassigns its rooms to World on confirm, as one undo step', async () => {
      const { mapId, crateria, landing } = setup()
      const panel = mountTree()
      await openDeleteDialog(panel, 2)

      const confirm = document.querySelector('.hierarchy-delete-confirm') as HTMLElement
      confirm.click()
      await nextTick()

      const model = useModelStore()
      expect(model.project.areas.has(crateria)).toBe(false)
      expect(model.project.mapsById.get(mapId)!.rooms.get(landing)!.areaId).toBe(WORLD_AREA_ID)
      expect(model.status.undoLabel).toBe('Delete Area')

      model.undo()
      expect(model.project.areas.has(crateria)).toBe(true)
      expect(model.project.mapsById.get(mapId)!.rooms.get(landing)!.areaId).toBe(crateria)
    })

    it('leaves the selection empty afterwards', async () => {
      const { mapId, crateria } = setup()
      const panel = mountTree()
      useSelectionStore().set([{ kind: 'area', id: crateria }], mapId)
      await openDeleteDialog(panel, 2)

      const confirm = document.querySelector('.hierarchy-delete-confirm') as HTMLElement
      confirm.click()
      await nextTick()

      expect(useSelectionStore().isEmpty).toBe(true)
    })

    it('changes nothing on cancel', async () => {
      const { crateria } = setup()
      const panel = mountTree()
      await openDeleteDialog(panel, 2)

      const cancel = document.querySelector('.hierarchy-delete-cancel') as HTMLElement
      cancel.click()
      await nextTick()

      expect(useModelStore().project.areas.has(crateria)).toBe(true)
    })
  })
})
