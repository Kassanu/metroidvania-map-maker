import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import MenuBar from './MenuBar.vue'
import { usePanelsStore } from '@/stores/panels'
import { useUiStore } from '@/stores/ui'
import { useThemeStore } from '@/stores/theme'
import { useCanvasViewStore } from '@/stores/canvasView'
import { PROJECT_SCOPE, useModelStore } from '@/stores/model'
import { useTabsStore } from '@/stores/tabs'
import { renameProject } from '@/core/ops/project'

describe('MenuBar', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createTestPinia())
    wrapper = mount(MenuBar, { attachTo: document.body })
  })

  afterEach(() => {
    wrapper.unmount()
  })

  async function openViewMenu() {
    const trigger = wrapper.findAll('.menu-item').find((el) => el.text() === 'View')!
    await trigger.trigger('click')
    await nextTick()
  }

  const PANEL_TITLES = ['Hierarchy', 'Icon Library', 'Inspector']

  it('lists every panel, checked according to its current visibility', async () => {
    const panelsStore = usePanelsStore()
    panelsStore.remove('inspector')
    await openViewMenu()

    const items = Array.from(document.querySelectorAll('[role="menuitemcheckbox"]')).filter((el) =>
      PANEL_TITLES.includes(el.textContent?.trim() ?? ''),
    )
    expect(items.map((el) => el.textContent?.trim())).toEqual([
      'Hierarchy',
      'Icon Library',
      'Inspector',
    ])
    expect(
      items.find((el) => el.textContent?.trim() === 'Inspector')?.getAttribute('data-state'),
    ).toBe('unchecked')
    expect(
      items.find((el) => el.textContent?.trim() === 'Hierarchy')?.getAttribute('data-state'),
    ).toBe('checked')
  })

  it("toggling a checkbox item flips the panel's visibility and keeps the menu open", async () => {
    const panelsStore = usePanelsStore()
    await openViewMenu()

    const hierarchyItem = Array.from(document.querySelectorAll('[role="menuitemcheckbox"]')).find(
      (el) => el.textContent?.trim() === 'Hierarchy',
    ) as HTMLElement
    hierarchyItem.click()
    await nextTick()

    expect(panelsStore.isVisible('hierarchy')).toBe(false)
    // Selecting a normal menu item closes the menu; a checklist shouldn't.
    expect(document.querySelector('.view-menu-content')).not.toBeNull()
  })

  it('"Reset Sidebars" restores both the panel layout and the sidebar chrome', async () => {
    const panelsStore = usePanelsStore()
    const ui = useUiStore()
    panelsStore.remove('hierarchy')
    ui.toggleLeftSidebar()
    ui.setLeftSidebarWidth(400)

    await openViewMenu()
    const resetItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === 'Reset Sidebars',
    ) as HTMLElement
    resetItem.click()
    await nextTick()

    expect(panelsStore.isVisible('hierarchy')).toBe(true)
    expect(ui.leftSidebarCollapsed).toBe(false)
    expect(ui.leftSidebarWidth).toBe(256)
  })

  async function openSubmenu(triggerLabel: string) {
    const subTrigger = Array.from(document.querySelectorAll('.popover-subtrigger')).find(
      (el) => el.textContent?.trim() === triggerLabel,
    ) as HTMLElement
    await subTrigger.dispatchEvent(new PointerEvent('click', { bubbles: true, cancelable: true }))
    await nextTick()
  }

  // The title is the seam's first UI consumer: it reads a published projection
  // rather than a store-local copy, and it writes through a real core op, so
  // renaming the project is an undoable step like any other edit.
  describe('project title', () => {
    it('renders the name core owns', () => {
      expect(wrapper.get('.project-title-button').text()).toBe('Untitled Project')
    })

    // Dirty is measured against the last entry that changed the model, so
    // undoing back to the saved state is clean again. A dirty flag that
    // stayed set after that would be crying wolf.
    it('commits a rename through the model store as an undoable step', async () => {
      const model = useModelStore()
      await wrapper.get('.project-title-button').trigger('click')
      const input = wrapper.get('.project-title-input')
      await input.setValue('Zebes')
      await input.trigger('keydown.enter')

      expect(model.project.name).toBe('Zebes')
      // With the unsaved marker, since the rename is an unsaved edit.
      expect(wrapper.get('.project-title-button').text()).toBe('Zebes •')
      expect(model.status.canUndo).toBe(true)
      expect(model.status.isDirty).toBe(true)

      model.undo()
      await nextTick()
      expect(wrapper.get('.project-title-button').text()).toBe('Untitled Project')
    })

    it('shows the unsaved marker only while there is unsaved work', async () => {
      const model = useModelStore()
      expect(wrapper.get('.project-title-button').text()).toBe('Untitled Project')

      model.run('Rename', PROJECT_SCOPE, (tx) => renameProject(tx, model.project, 'Zebes'))
      await nextTick()
      expect(wrapper.get('.project-title-button').text()).toBe('Zebes •')

      model.markSaved()
      await nextTick()
      expect(wrapper.get('.project-title-button').text()).toBe('Zebes')
    })
  })

  describe('Edit menu', () => {
    async function openEditMenu() {
      const trigger = wrapper.findAll('.menu-item').find((el) => el.text() === 'Edit')!
      await trigger.trigger('click')
      await nextTick()
    }

    function editItems() {
      return Array.from(document.querySelectorAll('.edit-menu-content [role="menuitem"]'))
    }

    it('offers Undo and Redo, both disabled on an untouched project', async () => {
      await openEditMenu()
      const items = editItems()
      expect(items.map((el) => el.textContent?.trim())).toEqual(['Undo', 'Redo'])
      for (const item of items) expect(item.getAttribute('data-disabled')).not.toBeNull()
    })

    // The label comes off the transaction, so the menu names the step it will
    // actually revert rather than making the user guess.
    it('names the step it will undo', async () => {
      const model = useModelStore()
      model.run('Rename Project', PROJECT_SCOPE, (tx) => renameProject(tx, model.project, 'Zebes'))
      await openEditMenu()

      const items = editItems()
      expect(items[0].textContent?.trim()).toBe('Undo Rename Project')
      expect(items[0].getAttribute('data-disabled')).toBeNull()
      expect(items[1].textContent?.trim()).toBe('Redo')
    })

    it('undoing from the menu moves the model and offers the redo', async () => {
      const model = useModelStore()
      model.run('Rename Project', PROJECT_SCOPE, (tx) => renameProject(tx, model.project, 'Zebes'))
      await openEditMenu()
      ;(editItems()[0] as HTMLElement).click()
      // Two ticks: the menu roots are controlled, because they claim the Esc
      // stack's `dialog` tier while open. Choosing an item closes the menu
      // through that bound flag, which takes a round trip through Vue: if the
      // close has not landed before the trigger is clicked again below, the
      // click toggles the still-open menu shut instead of reopening it.
      await nextTick()
      await nextTick()

      expect(model.project.name).toBe('Untitled Project')
      await openEditMenu()
      expect(editItems()[1].textContent?.trim()).toBe('Redo Rename Project')
    })

    // A tab switch is a history entry of its own, and its label is supplied
    // by the app rather than hardcoded: core holds no user-visible strings.
    it('names a tab switch from the catalogue', async () => {
      const tabs = useTabsStore()
      tabs.addTab()
      tabs.activate(tabs.tabs[0].id)
      await openEditMenu()

      expect(editItems()[0].textContent?.trim()).toBe('Undo Switch Tab')
    })
  })

  describe('canvas view toggles', () => {
    it('lists Grid, Rulers, and Coords Overlay, all checked by default', async () => {
      await openViewMenu()

      const items = Array.from(document.querySelectorAll('[role="menuitemcheckbox"]'))
      const labels = ['Grid', 'Rulers', 'Coords Overlay']
      for (const label of labels) {
        const item = items.find((el) => el.textContent?.trim() === label)
        expect(item?.getAttribute('data-state')).toBe('checked')
      }
    })

    it('toggling Grid flips the canvasView store and keeps the menu open', async () => {
      const canvasView = useCanvasViewStore()
      await openViewMenu()

      const gridItem = Array.from(document.querySelectorAll('[role="menuitemcheckbox"]')).find(
        (el) => el.textContent?.trim() === 'Grid',
      ) as HTMLElement
      gridItem.click()
      await nextTick()

      expect(canvasView.showGrid).toBe(false)
      expect(document.querySelector('.view-menu-content')).not.toBeNull()
    })

    it('the Ruler Units submenu lists Cells/Pixels, radio-checked to the current setting', async () => {
      await openViewMenu()
      await openSubmenu('Ruler Units')

      const items = Array.from(document.querySelectorAll('[role="menuitemradio"]'))
      expect(items.map((el) => el.textContent?.trim())).toEqual(['Cells', 'Pixels'])
      expect(
        items.find((el) => el.textContent?.trim() === 'Cells')?.getAttribute('data-state'),
      ).toBe('checked')
    })

    it('selecting Pixels updates rulerUnits', async () => {
      const canvasView = useCanvasViewStore()
      await openViewMenu()
      await openSubmenu('Ruler Units')

      const pixelsItem = Array.from(document.querySelectorAll('[role="menuitemradio"]')).find(
        (el) => el.textContent?.trim() === 'Pixels',
      ) as HTMLElement
      pixelsItem.click()
      await nextTick()

      expect(canvasView.rulerUnits).toBe('px')
    })
  })

  // Per-layer visibility: a transitions master with the teleport-lines
  // sub-toggle nested under it.
  describe('layer toggles', () => {
    const checkboxes = () => Array.from(document.querySelectorAll('[role="menuitemcheckbox"]'))
    const itemNamed = (label: string) =>
      checkboxes().find((el) => el.textContent?.trim() === label) as HTMLElement

    it('lists both, checked, with the sub-toggle after its master', async () => {
      await openViewMenu()

      const labels = checkboxes().map((el) => el.textContent?.trim())
      const master = labels.indexOf('Transitions')
      expect(master).toBeGreaterThanOrEqual(0)
      // Directly after, which is the whole of the nesting on screen: a gap
      // between them would put an unrelated item inside the group.
      expect(labels[master + 1]).toBe('Teleport Lines')
      expect(itemNamed('Transitions').getAttribute('data-state')).toBe('checked')
      expect(itemNamed('Teleport Lines').getAttribute('data-state')).toBe('checked')
    })

    it('toggling Transitions flips the store and keeps the menu open', async () => {
      const canvasView = useCanvasViewStore()
      await openViewMenu()

      itemNamed('Transitions').click()
      await nextTick()

      expect(canvasView.showTransitions).toBe(false)
      expect(document.querySelector('.view-menu-content')).not.toBeNull()
    })

    it('toggling Teleport Lines flips only the sub-toggle', async () => {
      const canvasView = useCanvasViewStore()
      await openViewMenu()

      itemNamed('Teleport Lines').click()
      await nextTick()

      expect(canvasView.showTeleportLines).toBe(false)
      expect(canvasView.showTransitions).toBe(true)
    })

    // Disabled, not merely ignored: a checkbox that still ticked while
    // changing nothing on screen would be worse than one that says it cannot
    // act.
    it('disables the sub-toggle while the layer is hidden', async () => {
      const canvasView = useCanvasViewStore()
      canvasView.toggleTransitions()
      await openViewMenu()

      const lines = itemNamed('Teleport Lines')
      expect(lines.getAttribute('data-disabled')).not.toBeNull()

      lines.click()
      await nextTick()
      expect(canvasView.showTeleportLines).toBe(true)
    })
  })

  describe('Appearance submenu', () => {
    async function openAppearanceSubmenu() {
      await openViewMenu()
      await openSubmenu('Appearance')
    }

    it('lists the three theme options, radio-checked to the current mode', async () => {
      await openAppearanceSubmenu()

      const items = Array.from(document.querySelectorAll('[role="menuitemradio"]'))
      expect(items.map((el) => el.textContent?.trim())).toEqual(['System Default', 'Light', 'Dark'])
      expect(
        items.find((el) => el.textContent?.trim() === 'System Default')?.getAttribute('data-state'),
      ).toBe('checked')
    })

    it('selecting a theme updates the store', async () => {
      const theme = useThemeStore()
      await openAppearanceSubmenu()

      const darkItem = Array.from(document.querySelectorAll('[role="menuitemradio"]')).find(
        (el) => el.textContent?.trim() === 'Dark',
      ) as HTMLElement
      darkItem.click()
      await nextTick()

      expect(theme.mode).toBe('dark')
    })
  })

  describe('Help menu', () => {
    async function openHelpMenu() {
      const trigger = wrapper.findAll('.menu-item').find((el) => el.text() === 'Help')!
      await trigger.trigger('click')
      await nextTick()
    }

    it('"Welcome screen" opens the welcome dialog', async () => {
      const ui = useUiStore()
      ui.welcomeOpen = false // already dismissed earlier in the session
      await openHelpMenu()

      const items = Array.from(document.querySelectorAll('[role="menuitem"]'))
      const welcomeItem = items.find(
        (el) => el.textContent?.trim() === 'Welcome screen',
      ) as HTMLElement
      welcomeItem.click()
      await nextTick()

      expect(ui.welcomeOpen).toBe(true)
    })

    it('"About" opens the about dialog', async () => {
      const ui = useUiStore()
      await openHelpMenu()

      const items = Array.from(document.querySelectorAll('[role="menuitem"]'))
      const aboutItem = items.find((el) => el.textContent?.trim() === 'About') as HTMLElement
      aboutItem.click()
      await nextTick()

      expect(ui.aboutOpen).toBe(true)
    })

    it('GitHub and Wiki are real external links, not JS-driven actions', async () => {
      await openHelpMenu()

      const github = document.querySelector(
        '.help-menu-content a[href*="github.com"]:not([href*="/wiki"])',
      )
      const wiki = document.querySelector('.help-menu-content a[href$="/wiki"]')
      expect(github?.getAttribute('target')).toBe('_blank')
      expect(github?.getAttribute('rel')).toBe('noopener noreferrer')
      expect(wiki).not.toBeNull()
    })
  })
})
