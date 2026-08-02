import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import Toolbar from './Toolbar.vue'
import { useUiStore } from '@/stores/ui'
import { useModeStore } from '@/stores/mode'
import { useToolsStore } from '@/stores/tools'
import { runAction } from '@/hotkeys/actions'
import { PROJECT_SCOPE, useModelStore } from '@/stores/model'
import { useDrawAreaStore } from '@/stores/drawArea'
import { useDoorDefaultsStore } from '@/stores/doorDefaults'
import { createNewArea, createNewLockType, deleteArea } from '@/core/ops/project'
import { WORLD_AREA_ID } from '@/core/ids'
import { MAX_BRUSH_SIZE } from '@/canvas/brush'

describe('Toolbar', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  // The dynamic section is per-mode: Draw and Door have real controls, the rest
  // are still placeholder text until their tools are built.
  it('shows the Draw tools in the dynamic section, and only in Draw mode', async () => {
    const modeStore = useModeStore()
    const wrapper = mount(Toolbar)

    expect(wrapper.find('.brush-size').exists()).toBe(true)

    modeStore.setMode('select')
    await nextTick()
    expect(wrapper.find('.brush-size').exists()).toBe(false)
  })

  // The toggle belongs to every mode with deletable content, which is Draw,
  // Door and Markup. It is also the only erase route touch has, since
  // right-click and the stylus eraser end are the other two.
  describe('the erase toggle', () => {
    it('is present in every mode with something to erase', async () => {
      const modeStore = useModeStore()
      const wrapper = mount(Toolbar)
      expect(wrapper.find('.erase-toggle-button').exists()).toBe(true)

      modeStore.setMode('door')
      await nextTick()
      expect(wrapper.find('.erase-toggle-button').exists()).toBe(true)
      // Door's own section, not Draw's left on screen.
      expect(wrapper.find('.brush-size').exists()).toBe(false)

      modeStore.setMode('markup')
      await nextTick()
      expect(wrapper.find('.erase-toggle-button').exists()).toBe(true)
      expect(wrapper.find('.replace-button').exists()).toBe(true)

      // And absent from the one mode whose tools are still unbuilt.
      modeStore.setMode('select')
      await nextTick()
      expect(wrapper.find('.erase-toggle-button').exists()).toBe(false)
    })

    // One flag, shared: "the primary pointer erases" is an intent the user
    // carries between modes, and each mode decides what erasing means.
    it('reads and writes the same flag from Door mode', async () => {
      const tools = useToolsStore()
      useModeStore().setMode('door')
      const wrapper = mount(Toolbar)

      await wrapper.get('.erase-toggle-button').trigger('click')
      expect(tools.erase).toBe(true)
      expect(wrapper.get('.erase-toggle-button').attributes('aria-pressed')).toBe('true')

      await wrapper.get('.erase-toggle-button').trigger('click')
      expect(tools.erase).toBe(false)
    })

    // The two modes describe different destruction, so they cannot share one
    // tooltip: Door mode never erases a cell.
    it('describes what this mode erases', async () => {
      const modeStore = useModeStore()
      const wrapper = mount(Toolbar)
      expect(wrapper.get('.erase-toggle-button').attributes('title')).toContain('cells')

      modeStore.setMode('door')
      await nextTick()
      const title = wrapper.get('.erase-toggle-button').attributes('title')!
      expect(title).toContain('doors, elevators and teleports')
      expect(title).not.toContain('cells')
    })
  })

  describe('brush size', () => {
    it('steps with the toolbar buttons and reads back the size', async () => {
      const tools = useToolsStore()
      const wrapper = mount(Toolbar)

      expect(wrapper.get('.brush-size').text()).toBe('1×1')

      await wrapper.get('[title="Larger brush (])"]').trigger('click')
      expect(tools.brushSize).toBe(2)
      expect(wrapper.get('.brush-size').text()).toBe('2×2')

      await wrapper.get('[title="Smaller brush ([)"]').trigger('click')
      expect(tools.brushSize).toBe(1)
    })

    it('disables the step buttons at the ends of the range', async () => {
      const tools = useToolsStore()
      const wrapper = mount(Toolbar)
      const smaller = () => wrapper.get('[title="Smaller brush ([)"]')
      const larger = () => wrapper.get('[title="Larger brush (])"]')

      expect(smaller().attributes('disabled')).toBeDefined()
      expect(larger().attributes('disabled')).toBeUndefined()

      tools.setBrushSize(MAX_BRUSH_SIZE)
      await nextTick()
      expect(larger().attributes('disabled')).toBeDefined()
      expect(smaller().attributes('disabled')).toBeUndefined()
    })

    // `[` and `]` mirror Photoshop's brush-size shortcuts. They go through
    // the keymap rather than a bare listener, so the cheat sheet already
    // lists them.
    it('resizes on [ and ], through the keymap', async () => {
      const tools = useToolsStore()
      const wrapper = mount(Toolbar, { attachTo: document.body })
      await nextTick()

      expect(runAction('brushSizeUp')).toBe(true)
      expect(tools.brushSize).toBe(2)

      expect(runAction('brushSizeDown')).toBe(true)
      expect(tools.brushSize).toBe(1)

      wrapper.unmount()
    })

    // Registered by the Draw toolbar, so it is bound only while Draw mode
    // owns the section: a brush size means nothing in the other three modes.
    it('unbinds [ and ] when Draw mode is left', async () => {
      const modeStore = useModeStore()
      const wrapper = mount(Toolbar, { attachTo: document.body })
      await nextTick()
      expect(runAction('brushSizeUp')).toBe(true)

      modeStore.setMode('door')
      await nextTick()
      expect(runAction('brushSizeUp')).toBe(false)

      wrapper.unmount()
    })
  })

  it('the erase button toggles tools.erase', async () => {
    const tools = useToolsStore()
    const wrapper = mount(Toolbar)

    const eraseButton = wrapper.get('.erase-toggle-button')
    expect(eraseButton.attributes('aria-pressed')).toBe('false')

    await eraseButton.trigger('click')
    expect(tools.erase).toBe(true)
    expect(eraseButton.attributes('aria-pressed')).toBe('true')

    await eraseButton.trigger('click')
    expect(tools.erase).toBe(false)
  })

  // The three inner-wall styles. A radio group rather than three toggles, so
  // exactly-one-selected is what the markup says and not something the click
  // handlers have to keep true.
  describe('inner-wall style', () => {
    it('selects a style and reports it as the checked radio', async () => {
      const tools = useToolsStore()
      const wrapper = mount(Toolbar)

      const buttons = wrapper.findAll('.wall-style-button')
      expect(buttons).toHaveLength(3)
      expect(tools.wallStyle).toBe('solid')
      expect(buttons[0].attributes('aria-checked')).toBe('true')

      await buttons[1].trigger('click')
      expect(tools.wallStyle).toBe('dotted')
      expect(buttons[1].attributes('aria-checked')).toBe('true')
      expect(buttons[0].attributes('aria-checked')).toBe('false')

      await buttons[2].trigger('click')
      expect(tools.wallStyle).toBe('doorway')
    })

    it('shows exactly one as checked, whichever is selected', async () => {
      const tools = useToolsStore()
      const wrapper = mount(Toolbar)

      for (const style of ['solid', 'dotted', 'doorway'] as const) {
        tools.setWallStyle(style)
        await nextTick()
        const checked = wrapper
          .findAll('.wall-style-button')
          .filter((button) => button.attributes('aria-checked') === 'true')
        expect(checked).toHaveLength(1)
      }
    })

    // Per-session like the brush, and for the same reason: nothing here opts
    // into `persist`.
    it('is Draw-only, like the rest of the section', async () => {
      const wrapper = mount(Toolbar)
      expect(wrapper.findAll('.wall-style-button')).toHaveLength(3)

      useModeStore().setMode('markup')
      await nextTick()
      expect(wrapper.findAll('.wall-style-button')).toHaveLength(0)
    })
  })

  // The sub-mode lock. Same radio-group treatment as the wall styles, and Auto
  // is the default a user has to be able to get back to.
  describe('sub-mode lock', () => {
    it('selects a lock and reports it as the checked radio', async () => {
      const tools = useToolsStore()
      const wrapper = mount(Toolbar)

      const buttons = wrapper.findAll('.sub-mode-button')
      expect(buttons).toHaveLength(4)
      expect(tools.subMode).toBe('auto')
      expect(buttons[0].attributes('aria-checked')).toBe('true')

      await buttons[2].trigger('click')
      expect(tools.subMode).toBe('resize')
      expect(buttons[2].attributes('aria-checked')).toBe('true')
      expect(buttons[0].attributes('aria-checked')).toBe('false')

      // And back: a lock the user cannot leave is a trap.
      await buttons[0].trigger('click')
      expect(tools.subMode).toBe('auto')
    })

    it('shows exactly one as checked, whichever is selected', async () => {
      const tools = useToolsStore()
      const wrapper = mount(Toolbar)

      for (const mode of ['auto', 'cells', 'resize', 'vertex'] as const) {
        tools.setSubMode(mode)
        await nextTick()
        const checked = wrapper
          .findAll('.sub-mode-button')
          .filter((button) => button.attributes('aria-checked') === 'true')
        expect(checked).toHaveLength(1)
      }
    })

    it('is Draw-only, like the rest of the section', async () => {
      const wrapper = mount(Toolbar)
      expect(wrapper.findAll('.sub-mode-button')).toHaveLength(4)

      useModeStore().setMode('select')
      await nextTick()
      expect(wrapper.findAll('.sub-mode-button')).toHaveLength(0)
    })
  })

  // The area picker only picks: areas are created in the Hierarchy, so there
  // is deliberately no "New area…" entry here.
  describe('area picker', () => {
    function addArea(name: string) {
      const model = useModelStore()
      return model.run('Add area', PROJECT_SCOPE, (tx) =>
        createNewArea(tx, model.project, name, '#336699', '#112233'),
      ).id
    }

    it('lists every area, World first, and nothing else', async () => {
      const wrapper = mount(Toolbar)
      expect(wrapper.findAll('.area-select option').map((o) => o.text())).toEqual(['World'])

      addArea('Caves')
      addArea('Surface')
      await nextTick()

      // World stays first because it is the default and the fallback; the rest
      // follow in creation order. No entry that is not an area.
      expect(wrapper.findAll('.area-select option').map((o) => o.text())).toEqual([
        'World',
        'Caves',
        'Surface',
      ])
    })

    it('selects an area into the store', async () => {
      const drawArea = useDrawAreaStore()
      const caves = addArea('Caves')
      const wrapper = mount(Toolbar)
      await nextTick()

      await wrapper.get('.area-select').setValue(caves)

      expect(drawArea.areaId).toBe(caves)
    })

    it('reads back the store, so a prune shows up in the control', async () => {
      const model = useModelStore()
      const drawArea = useDrawAreaStore()
      const caves = addArea('Caves')
      const wrapper = mount(Toolbar)
      await nextTick()
      await wrapper.get('.area-select').setValue(caves)

      model.run('Delete area', PROJECT_SCOPE, (tx) => deleteArea(tx, model.project, caves))
      await nextTick()

      expect(drawArea.areaId).toBe(WORLD_AREA_ID)
      expect((wrapper.get('.area-select').element as HTMLSelectElement).value).toBe(WORLD_AREA_ID)
    })

    // The swatch is the point of areas: it should show the selected area's
    // own colour, and fall through to the theme variable for World, which
    // has none.
    it('shows the selected area colour, and the theme fallback for World', async () => {
      const wrapper = mount(Toolbar)
      const swatch = () => wrapper.get('.area-swatch').attributes('style') ?? ''
      expect(swatch()).toContain('--canvas-room-fill')

      // The tick matters: without it the new area has no <option> yet, so
      // `setValue` cannot select it and the change event carries an empty
      // value.
      const caves = addArea('Caves')
      await nextTick()
      await wrapper.get('.area-select').setValue(caves)
      await nextTick()

      expect(swatch()).toContain('rgb(51, 102, 153)')
    })

    it('is Draw-only, like the rest of the section', async () => {
      const wrapper = mount(Toolbar)
      expect(wrapper.find('.area-select').exists()).toBe(true)

      useModeStore().setMode('door')
      await nextTick()
      expect(wrapper.find('.area-select').exists()).toBe(false)
    })
  })

  it('the Zen mode button toggles ui.zenMode', async () => {
    const ui = useUiStore()
    const wrapper = mount(Toolbar)

    expect(ui.zenMode).toBe(false)
    const zenButton = wrapper.get('.zen-toggle-button')
    expect(zenButton.attributes('aria-pressed')).toBe('false')

    await zenButton.trigger('click')
    expect(ui.zenMode).toBe(true)
    expect(zenButton.attributes('aria-pressed')).toBe('true')
  })

  // The Door creation strip. Every control says what the next transition
  // gets; none of them touches the selected one, which would mean two places
  // to edit an existing transition. The store holds that rule; what is
  // tested here is that the controls read and write it.
  describe('the Door creation strip', () => {
    beforeEach(() => {
      useModeStore().setMode('door')
    })

    it('lists every lock type, Open first, and nothing else', async () => {
      const model = useModelStore()
      model.run('Add', PROJECT_SCOPE, (tx) => createNewLockType(tx, model.project, 'Missile Door'))
      const wrapper = mount(Toolbar)
      await nextTick()

      const options = wrapper.findAll('.lock-select option').map((option) => option.text())
      // A fresh project seeds two, which is what gives the picker real content
      // with no management UI in existence.
      expect(options).toEqual(['Open', 'Locked', 'Missile Door'])
    })

    it('picks a lock type into the store', async () => {
      const model = useModelStore()
      const missile = model.run('Add', PROJECT_SCOPE, (tx) =>
        createNewLockType(tx, model.project, 'Missile Door'),
      )
      const defaults = useDoorDefaultsStore()
      const wrapper = mount(Toolbar)

      await wrapper.get('.lock-select').setValue(missile.id)

      expect(defaults.lockTypeId).toBe(missile.id)
    })

    // Two-way or one-way, deliberately not the Inspector's three-way selector:
    // `B→A` swaps the ends of a transition that has them, and at creation the
    // gesture has not decided which end is A yet.
    it('toggles one-way, and offers no B→A', async () => {
      const defaults = useDoorDefaultsStore()
      const wrapper = mount(Toolbar)

      expect(wrapper.get('.one-way-button').attributes('aria-pressed')).toBe('false')
      await wrapper.get('.one-way-button').trigger('click')

      expect(defaults.oneWay).toBe(true)
      expect(wrapper.get('.one-way-button').attributes('aria-pressed')).toBe('true')
      expect(wrapper.text()).not.toContain('B→A')
    })

    // The tooltips carry the rule, because it is the question a user will
    // otherwise answer by experiment, on a door they wanted to keep.
    it('says outright that it does not change the selection', () => {
      const wrapper = mount(Toolbar)
      for (const selector of ['.lock-select', '.one-way-button']) {
        expect(wrapper.get(selector).attributes('title')).toContain(
          'Does not change what is selected',
        )
      }
    })

    it('is Door-only, like the rest of the section', async () => {
      const wrapper = mount(Toolbar)
      expect(wrapper.find('.lock-select').exists()).toBe(true)

      useModeStore().setMode('draw')
      await nextTick()
      expect(wrapper.find('.lock-select').exists()).toBe(false)
    })
  })
})
