import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from '@/App.vue'
import { useModeStore } from '@/stores/mode'
import { useUiStore } from '@/stores/ui'
import { runAction } from '@/hotkeys/actions'
import { useSelectionStore } from '@/stores/selection'
import { useTabsStore } from '@/stores/tabs'
import { PROJECT_SCOPE, mapScope, useModelStore } from '@/stores/model'
import { paintCells, renameRoom } from '@/core/ops/rooms'
import { createNewArea } from '@/core/ops/project'
import { createLine, placeIcon } from '@/core/ops/markup'
import { createTeleport } from '@/core/ops/doors'
import { createProject } from '@/core/factory'
import { TEST_SEED, ok } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { AreaId, IconId, LineId, MapId, RoomId, TransitionId } from '@/core/ids'
import type { ObjectRef } from '@/core/types'

// The seam between a panel's control and the op behind it, one case per row of
// the locked field table and one per locked Hierarchy behaviour.
//
// Mounted as the whole app rather than a panel at a time, which is the point:
// the per-panel suites prove a control calls its op, and this proves the two
// panels, the canvas and the shared selection agree once they are wired
// together. Where a case duplicates a per-panel test, the assertion is what
// differs: here every edit must land in the model *and* leave exactly one undo
// entry with the right name.

describe('panel sweep', () => {
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
    landing: RoomId
    corridor: RoomId
    icon: IconId
    line: LineId
    teleport: TransitionId
    crateria: AreaId
  }

  // One room per area so the tree has both levels populated, plus one of every
  // other inspectable kind.
  //
  // Built after the app is mounted, and on a project of its own: mounting seeds
  // the development fixture, which would both replace anything built earlier
  // and put its own rooms in the tree beside these.
  function setup(): Fixture {
    const model = useModelStore()
    model.replaceProject(createProject(TEST_SEED))
    const mapId = useTabsStore().activeTabId
    let crateria!: AreaId
    model.run('Area', PROJECT_SCOPE, (tx) => {
      crateria = createNewArea(tx, model.project, 'Crateria', '#3355aa', '#112244').id
    })

    let landing!: RoomId
    let corridor!: RoomId
    let icon!: IconId
    let line!: LineId
    let teleport!: TransitionId
    model.run('Setup', mapScope(mapId), (tx) => {
      const map = model.project.mapsById.get(mapId)!
      landing = paintCells(tx, model.project, map, ['0,0', '1,0'], { areaId: crateria })!.id
      corridor = paintCells(tx, model.project, map, ['0,4', '1,4'], { areaId: WORLD_AREA_ID })!.id
      renameRoom(tx, map, landing, 'Landing Site')
      renameRoom(tx, map, corridor, 'Corridor')
      icon = ok(
        placeIcon(tx, map, '0,0', 'save', { plateColor: '#111111', glyphColor: '#222222' }),
      ).id
      line = ok(
        createLine(tx, map, ['6,6', '7,6'], {
          color: '#ffcc00',
          arrowStart: false,
          arrowEnd: false,
        }),
      ).id
      teleport = ok(
        createTeleport(tx, model.project, { mapId, cell: '0,0' }, { mapId, cell: '0,4' }),
      ).id
    })

    return { mapId, landing, corridor, icon, line, teleport, crateria }
  }

  // Mount, then build: the order matters, so both halves live in one helper
  // rather than at every call site.
  async function start(): Promise<Fixture> {
    await mountApp()
    // The welcome dialog opens over a fresh profile and holds the keyboard
    // while it is up, so a key aimed at the tree does nothing until it goes.
    // Dismissed here for the reason a user dismisses it: nothing behind it can
    // be worked on otherwise.
    useUiStore().welcomeOpen = false
    const fixture = setup()
    fixtureArea = fixture.crateria
    await nextTick()
    return fixture
  }

  async function mountApp(): Promise<VueWrapper> {
    wrapper = mount(App, { attachTo: document.body })
    const viewport = wrapper.find('.canvas-viewport')
    if (viewport.exists()) {
      const el = viewport.element as HTMLElement
      // jsdom lays nothing out, so the canvas has no size until it is told one.
      el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
      el.setPointerCapture = () => {}
    }
    await nextTick()
    return wrapper
  }

  function select(refs: ObjectRef[], mapId: MapId) {
    useSelectionStore().set(refs, mapId)
  }

  function inspector(): HTMLElement {
    const panel = document.querySelector('[aria-label="Inspector"]')
    if (!panel) throw new Error('the Inspector is not mounted')
    return panel as HTMLElement
  }

  function tree(): HTMLElement {
    const found = document.querySelector('[role="tree"]')
    if (!found) throw new Error('the Hierarchy tree is not mounted')
    return found as HTMLElement
  }

  function rowNamed(name: string): HTMLElement {
    const found = Array.from(tree().querySelectorAll('[role="treeitem"]')).find(
      (el) => el.getAttribute('aria-label') === name,
    )
    if (!found) throw new Error(`no tree row named ${name}`)
    return found as HTMLElement
  }

  function rowLabels(): (string | null)[] {
    return Array.from(tree().querySelectorAll('[role="treeitem"]')).map((el) =>
      el.getAttribute('aria-label'),
    )
  }

  function field(id: string): HTMLElement {
    const found = document.getElementById(id)
    if (!found) throw new Error(`no field ${id} in the Inspector`)
    return found
  }

  // ---------------------------------------------------------------------
  // The Inspector's field table
  // ---------------------------------------------------------------------

  // Each control type commits on its own event, which is the locked rule this
  // drives rather than restates: text on Enter, notes on blur, everything
  // discrete the moment it changes.
  type Control = 'text' | 'notes' | 'select' | 'color' | 'toggle'

  async function edit(id: string, control: Control, value: string): Promise<void> {
    const el = field(id)
    if (control === 'toggle') {
      const box = el as HTMLInputElement
      box.checked = value === 'true'
      box.dispatchEvent(new Event('change', { bubbles: true }))
    } else {
      const input = el as HTMLInputElement | HTMLTextAreaElement
      // A colour is dragged through intermediate values before the picker
      // closes, which is the only way an `input` handler behind a swatch shows
      // itself: one that commits leaves an entry per value passed through.
      if (control === 'color') {
        input.value = '#010203'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      if (control === 'text') {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      } else if (control === 'notes') {
        input.dispatchEvent(new FocusEvent('blur', { bubbles: false }))
      } else {
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
    await nextTick()
  }

  interface FieldCase {
    row: string
    id: string
    control: Control
    // A value nothing in the fixture already holds: a commit equal to what is
    // stored emits nothing, so a matching value would prove the panel works
    // while testing none of it.
    value: string
    label: string
    reads: (fixture: Fixture) => unknown
    expected?: unknown
  }

  function map(mapId: MapId) {
    return useModelStore().project.mapsById.get(mapId)!
  }

  const FIELD_CASES: FieldCase[] = [
    {
      row: 'Room · Name',
      id: 'inspector-room-name',
      control: 'text',
      value: 'Maridia',
      label: 'Rename Room',
      reads: (f) => map(f.mapId).rooms.get(f.landing)!.name,
    },
    {
      row: 'Room · Notes',
      id: 'inspector-room-notes',
      control: 'notes',
      value: 'the ship',
      label: 'Edit Room Notes',
      reads: (f) => map(f.mapId).rooms.get(f.landing)!.notes,
    },
    {
      row: 'Room · Area',
      id: 'inspector-room-area',
      control: 'select',
      value: WORLD_AREA_ID,
      label: 'Change Area',
      reads: (f) => map(f.mapId).rooms.get(f.landing)!.areaId,
      expected: WORLD_AREA_ID,
    },
    {
      row: 'Icon · Plate colour',
      id: 'inspector-icon-plate',
      control: 'color',
      value: '#abcdef',
      label: 'Change Icon Colors',
      reads: (f) => map(f.mapId).icons.get(f.icon)!.plateColor,
    },
    {
      row: 'Icon · Glyph colour',
      id: 'inspector-icon-glyph',
      control: 'color',
      value: '#fedcba',
      label: 'Change Icon Colors',
      reads: (f) => map(f.mapId).icons.get(f.icon)!.glyphColor,
    },
    {
      row: 'Icon · Label',
      id: 'inspector-icon-label',
      control: 'text',
      value: 'Save point',
      label: 'Edit Icon Label',
      reads: (f) => map(f.mapId).icons.get(f.icon)!.label,
    },
    {
      row: 'Icon · Notes',
      id: 'inspector-icon-notes',
      control: 'notes',
      value: 'refills energy',
      label: 'Edit Icon Notes',
      reads: (f) => map(f.mapId).icons.get(f.icon)!.notes,
    },
    {
      row: 'Line · Colour',
      id: 'inspector-line-color',
      control: 'color',
      value: '#00ff88',
      label: 'Change Line Color',
      reads: (f) => map(f.mapId).lines.get(f.line)!.color,
    },
    {
      row: 'Line · Start arrow',
      id: 'inspector-line-arrow-start',
      control: 'toggle',
      value: 'true',
      label: 'Change Line Arrows',
      reads: (f) => map(f.mapId).lines.get(f.line)!.arrowStart,
      expected: true,
    },
    {
      row: 'Line · End arrow',
      id: 'inspector-line-arrow-end',
      control: 'toggle',
      value: 'true',
      label: 'Change Line Arrows',
      reads: (f) => map(f.mapId).lines.get(f.line)!.arrowEnd,
      expected: true,
    },
    {
      row: 'Line · Label',
      id: 'inspector-line-label',
      control: 'text',
      value: 'to Norfair',
      label: 'Edit Line Label',
      reads: (f) => map(f.mapId).lines.get(f.line)!.label,
    },
    {
      row: 'Line · Notes',
      id: 'inspector-line-notes',
      control: 'notes',
      value: 'sketch',
      label: 'Edit Line Notes',
      reads: (f) => map(f.mapId).lines.get(f.line)!.notes,
    },
    {
      row: 'Transition · Lock',
      id: 'inspector-transition-lock',
      control: 'select',
      value: 'locked',
      label: 'Change Lock',
      reads: (f) => map(f.mapId).transitions.get(f.teleport)!.locks.a,
      expected: 'locked',
    },
    {
      row: 'Transition · Direction',
      id: 'inspector-transition-direction',
      control: 'select',
      value: 'bToA',
      label: 'Change Direction',
      reads: (f) => map(f.mapId).transitions.get(f.teleport)!.direction,
      expected: 'bToA',
    },
    {
      row: 'Transition · Notes',
      id: 'inspector-transition-notes',
      control: 'notes',
      value: 'needs bombs',
      label: 'Edit Transition Notes',
      reads: (f) => map(f.mapId).transitions.get(f.teleport)!.notes,
    },
    {
      row: 'Area · Name',
      id: 'inspector-area-name',
      control: 'text',
      value: 'Brinstar',
      label: 'Rename Area',
      reads: () => useModelStore().project.areas.get(fixtureArea!)!.name,
    },
    {
      row: 'Area · Cell colour',
      id: 'inspector-area-cell',
      control: 'color',
      value: '#445566',
      label: 'Recolor Area',
      reads: () => useModelStore().project.areas.get(fixtureArea!)!.cellColor,
    },
    {
      row: 'Area · Wall colour',
      id: 'inspector-area-wall',
      control: 'color',
      value: '#667788',
      label: 'Recolor Area',
      reads: () => useModelStore().project.areas.get(fixtureArea!)!.wallColor,
    },
    {
      row: 'Area · Notes',
      id: 'inspector-area-notes',
      control: 'notes',
      value: 'the crash site',
      label: 'Edit Area Notes',
      reads: () => useModelStore().project.areas.get(fixtureArea!)!.notes,
    },
  ]

  // The area case's reader runs after the fixture is built, and a case is a
  // plain object: the id it needs is the one this holds.
  let fixtureArea: AreaId | null = null

  // What to select for a case, from its row's first word.
  function refFor(row: string, f: Fixture): ObjectRef {
    const kind = row.split(' ')[0]
    if (kind === 'Room') return { kind: 'room', id: f.landing }
    if (kind === 'Icon') return { kind: 'icon', id: f.icon }
    if (kind === 'Line') return { kind: 'line', id: f.line }
    if (kind === 'Transition') return { kind: 'transition', id: f.teleport }
    return { kind: 'area', id: f.crateria }
  }

  describe('every editable row of the field table reaches its op', () => {
    for (const testCase of FIELD_CASES) {
      it(`${testCase.row} commits, as one undo step`, async () => {
        const fixture = await start()
        select([refFor(testCase.row, fixture)], fixture.mapId)
        await nextTick()

        const model = useModelStore()
        const stored = testCase.reads(fixture)
        const previousLabel = model.status.undoLabel
        await edit(testCase.id, testCase.control, testCase.value)

        expect(testCase.reads(fixture)).toEqual(testCase.expected ?? testCase.value)
        expect(model.status.undoLabel).toBe(testCase.label)
        expect(model.status.undoLabel).not.toBe(previousLabel)

        // One entry, not two: a single undo puts back exactly what was there,
        // which is what a control committing on every keystroke or every pixel
        // of a colour drag would fail.
        model.undo()
        expect(testCase.reads(fixture)).toEqual(stored)
      })
    }
  })

  describe('the states that carry no fields', () => {
    it('shows nothing at all for an empty selection', async () => {
      await start()
      // The panel's own chrome stays; its body is what an empty selection
      // leaves blank.
      expect(inspector().querySelector('.panel-body')!.textContent?.trim()).toBe('')
    })

    it('counts a multi-object selection instead of inspecting one of them', async () => {
      const fixture = await start()
      select(
        [
          { kind: 'room', id: fixture.landing },
          { kind: 'room', id: fixture.corridor },
        ],
        fixture.mapId,
      )
      await nextTick()

      expect(inspector().textContent).toContain('2 selected')
      expect(document.getElementById('inspector-room-name')).toBeNull()
    })

    it('counts cells, which have no fields at any size', async () => {
      const fixture = await start()
      select([{ kind: 'cell', id: '0,0' }], fixture.mapId)
      await nextTick()

      expect(inspector().textContent).toContain('1 cell selected')
    })

    // A transition is described by its two ends and carries notes; a label
    // would be a second name for something the map already names twice.
    it('gives a transition no label field, unlike an icon or a line', async () => {
      const fixture = await start()
      select([{ kind: 'transition', id: fixture.teleport }], fixture.mapId)
      await nextTick()

      expect(document.getElementById('inspector-transition-notes')).not.toBeNull()
      expect(document.querySelector('[id$="-label"]')).toBeNull()
    })

    // Room colour comes from the area, which is why the swatch is a swatch.
    it('shows a room its area colour as something it cannot edit', async () => {
      const fixture = await start()
      select([{ kind: 'room', id: fixture.landing }], fixture.mapId)
      await nextTick()

      expect(inspector().querySelector('.color-swatch')).not.toBeNull()
      expect(inspector().querySelector('input[type="color"]')).toBeNull()
    })
  })

  // ---------------------------------------------------------------------
  // The Hierarchy's behaviours
  // ---------------------------------------------------------------------

  describe('the tree and the rest of the app share one selection', () => {
    it('lists areas with their rooms under them, scoped to this tab', async () => {
      const fixture = await start()
      expect(rowLabels()).toEqual(['World', 'Corridor', 'Crateria', 'Landing Site'])

      const tabs = useTabsStore()
      tabs.addTab()
      await nextTick()
      // Areas are project-wide, so both still show; the rooms are this tab's.
      expect(rowLabels()).toEqual(['World', 'Crateria'])
      tabs.activate(fixture.mapId)
    })

    it('marks a room selected on the canvas', async () => {
      const fixture = await start()
      select([{ kind: 'room', id: fixture.landing }], fixture.mapId)
      await nextTick()

      expect(rowNamed('Landing Site').getAttribute('aria-selected')).toBe('true')
      expect(rowNamed('Corridor').getAttribute('aria-selected')).toBe('false')
    })

    it('selects from a row click, and the Inspector follows', async () => {
      const fixture = await start()
      rowNamed('Landing Site').click()
      await nextTick()

      expect(useSelectionStore().roomsOn(fixture.mapId)).toEqual([fixture.landing])
      expect((field('inspector-room-name') as HTMLInputElement).value).toBe('Landing Site')
    })

    it('adds and removes with shift-click', async () => {
      const fixture = await start()
      rowNamed('Landing Site').click()
      rowNamed('Corridor').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
      await nextTick()
      expect(useSelectionStore().roomsOn(fixture.mapId)).toHaveLength(2)

      rowNamed('Corridor').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
      await nextTick()
      expect(useSelectionStore().roomsOn(fixture.mapId)).toEqual([fixture.landing])
    })

    // The tree is a list of objects, not a tool: what it selects is the same in
    // every mode, and picking a row must not put the user in another one.
    it('leaves the active mode alone', async () => {
      await start()
      useModeStore().setMode('door')
      await nextTick()

      rowNamed('Landing Site').click()
      await nextTick()

      expect(useModeStore().active).toBe('door')
    })

    // Areas have no canvas hit target of their own, so this is the only way to
    // select one, and its inspector is the only place its colours can change.
    it('selects an area, which no other surface can', async () => {
      const fixture = await start()
      rowNamed('Crateria').click()
      await nextTick()

      expect(useSelectionStore().selected).toEqual([{ kind: 'area', id: fixture.crateria }])
      expect((field('inspector-area-name') as HTMLInputElement).value).toBe('Crateria')
    })

    // Clearing is the canvas's business and Escape's. In a list the space below
    // the last row is layout, and clearing there would make scrolling a hazard.
    it('never clears the selection from its own dead space', async () => {
      const fixture = await start()
      select([{ kind: 'room', id: fixture.landing }], fixture.mapId)
      await nextTick()

      const panel = document.querySelector('[data-panel-id="hierarchy"]') as HTMLElement
      panel.click()
      await nextTick()

      expect(useSelectionStore().isEmpty).toBe(false)
    })

    it('renames a room in place, and the Inspector shows the new name', async () => {
      const fixture = await start()
      const row = wrapper!.find(`[data-row-id="${fixture.landing}"]`)
      await row.trigger('keydown', { key: 'F2' })
      const editor = wrapper!.get('.hierarchy-rename')
      await editor.setValue('Wrecked Ship')
      await editor.trigger('keydown.enter')

      expect(map(fixture.mapId).rooms.get(fixture.landing)!.name).toBe('Wrecked Ship')
      expect(useModelStore().status.undoLabel).toBe('Rename Room')
    })

    it('adds an area from the header button', async () => {
      await start()
      const before = useModelStore().project.areas.size

      await wrapper!.get('.hierarchy-add').trigger('click')

      expect(useModelStore().project.areas.size).toBe(before + 1)
      expect(useModelStore().status.undoLabel).toBe('Add Area')
    })

    // The filter narrows what is shown and touches nothing else: a row it
    // hides stays selected and stays deletable.
    it('filters without editing the selection', async () => {
      const fixture = await start()
      select([{ kind: 'room', id: fixture.landing }], fixture.mapId)
      await nextTick()

      const filter = document.querySelector('.hierarchy-filter') as HTMLInputElement
      filter.value = 'corr'
      filter.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()

      expect(rowLabels()).not.toContain('Landing Site')
      expect(useSelectionStore().roomsOn(fixture.mapId)).toEqual([fixture.landing])
      expect(useModelStore().status.undoLabel).toBe('Setup')
    })

    // An edit made in one panel is visible in the other because both read the
    // same model, which is the whole of the two-way sync.
    it('shows an Inspector rename in the tree row', async () => {
      const fixture = await start()
      select([{ kind: 'area', id: fixture.crateria }], fixture.mapId)
      await nextTick()
      await edit('inspector-area-name', 'text', 'Brinstar')

      expect(rowLabels()).toContain('Brinstar')
      expect(rowLabels()).not.toContain('Crateria')
    })

    // The tree is a list to look at as much as one to act in, so picking a row
    // must not yank the viewport. Revealing goes the other way: a selection
    // made on the canvas scrolls the row into view.
    it('never moves the camera', async () => {
      const fixture = await start()
      const tabs = useTabsStore()
      const before = {
        ...tabs.cameraOf(fixture.mapId).pan,
        zoom: tabs.cameraOf(fixture.mapId).zoom,
      }

      rowNamed('Landing Site').click()
      await nextTick()

      const after = tabs.cameraOf(fixture.mapId)
      expect({ ...after.pan, zoom: after.zoom }).toEqual(before)
    })

    // Ctrl+A answers at the granularity in use, which is rooms or cells. An
    // area swept in by it would put a destructive Delete behind a key pressed
    // meaning "the rooms on this tab".
    it('is left out of Select All, which takes rooms only', async () => {
      const fixture = await start()
      useModeStore().setMode('select')
      await nextTick()

      expect(runAction('selectAll')).toBe(true)
      await nextTick()

      const kinds = new Set(useSelectionStore().selected.map((ref) => ref.kind))
      expect(kinds).toEqual(new Set(['room']))
      expect(useSelectionStore().roomsOn(fixture.mapId)).toHaveLength(2)
    })

    // Highlighting is per-tab like everything else about a selection, areas
    // included, even though the area itself is on every tab.
    it('highlights an area on the tab it was selected on and no other', async () => {
      const fixture = await start()
      select([{ kind: 'area', id: fixture.crateria }], fixture.mapId)
      await nextTick()
      expect(rowNamed('Crateria').getAttribute('aria-selected')).toBe('true')

      const tabs = useTabsStore()
      tabs.addTab()
      await nextTick()
      expect(rowNamed('Crateria').getAttribute('aria-selected')).toBe('false')
    })
  })
})
