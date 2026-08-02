import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import SidebarContainer from './SidebarContainer.vue'
import { usePanelsStore } from '@/stores/panels'
import { useModeStore } from '@/stores/mode'
import { useUiStore } from '@/stores/ui'

describe('SidebarContainer', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createTestPinia())
  })

  it('renders the panels assigned to its side, in registry order', () => {
    const wrapper = mount(SidebarContainer, { props: { side: 'left' } })
    const titles = wrapper.findAll('.panel-title').map((el) => el.text())
    // Icon Library is markup-only and the default mode is draw, so it's absent.
    expect(titles).toEqual(['Hierarchy'])
  })

  it('shows the Icon Library panel only while in Markup mode', async () => {
    const wrapper = mount(SidebarContainer, { props: { side: 'left' } })
    const mode = useModeStore()
    mode.setMode('markup')
    await wrapper.vm.$nextTick()
    const titles = wrapper.findAll('.panel-title').map((el) => el.text())
    expect(titles).toEqual(['Hierarchy', 'Icon Library'])
  })

  it('does not render a panel the user removed', () => {
    const panelsStore = usePanelsStore()
    panelsStore.remove('hierarchy')
    const wrapper = mount(SidebarContainer, { props: { side: 'left' } })
    expect(wrapper.findAll('.panel-title')).toHaveLength(0)
  })

  it("renders the right sidebar's Inspector panel", () => {
    const wrapper = mount(SidebarContainer, { props: { side: 'right' } })
    expect(wrapper.findAll('.panel-title').map((el) => el.text())).toEqual(['Inspector'])
  })

  it('the outer collapse button hides the whole sidebar body', async () => {
    const wrapper = mount(SidebarContainer, { props: { side: 'left' } })
    expect(wrapper.find('.sidebar-body').exists()).toBe(true)
    await wrapper.get('.collapse-button').trigger('click')
    expect(wrapper.find('.sidebar-body').exists()).toBe(false)
  })

  function pointerEvent(
    type: string,
    init: Partial<PointerEventInit> & { clientX?: number; clientY?: number },
  ) {
    return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  }

  describe('width resize', () => {
    it('dragging the handle live-updates the width, with the store write debounced', () => {
      const ui = useUiStore()
      const wrapper = mount(SidebarContainer, { props: { side: 'left' }, attachTo: document.body })
      const handle = wrapper.get('.width-resize-handle').element as HTMLElement

      handle.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, pointerId: 1 }))
      handle.dispatchEvent(pointerEvent('pointermove', { clientX: 150, pointerId: 1 }))
      expect(ui.leftSidebarWidth).toBe(256 + 50)
      expect(localStorage.getItem('mmm:sidebarLayout')).toBeNull()

      handle.dispatchEvent(pointerEvent('pointerup', { clientX: 150, pointerId: 1 }))
      ui.$flushPersist()
      const saved = JSON.parse(localStorage.getItem('mmm:sidebarLayout') ?? '{}').data
      expect(saved.leftSidebarWidth).toBe(306)
    })

    it('dragging inward on the right sidebar grows it (mirrored direction)', () => {
      const ui = useUiStore()
      const wrapper = mount(SidebarContainer, { props: { side: 'right' }, attachTo: document.body })
      const handle = wrapper.get('.width-resize-handle').element as HTMLElement

      handle.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, pointerId: 1 }))
      handle.dispatchEvent(pointerEvent('pointermove', { clientX: 60, pointerId: 1 })) // dragging left grows the right sidebar
      expect(ui.rightSidebarWidth).toBe(256 + 40)
    })
  })

  describe('panel-height resize', () => {
    function stubPanelRects(wrapper: ReturnType<typeof mount>, tops: number[], height = 200) {
      const panels = wrapper.findAll('[data-panel-id]')
      panels.forEach((p, i) => {
        p.element.getBoundingClientRect = () =>
          ({
            top: tops[i],
            height,
            bottom: tops[i] + height,
            left: 0,
            right: 0,
            width: 0,
          }) as DOMRect
      })
    }

    it('redistributes size between the dragged pair only, live, with the write debounced', async () => {
      const panelsStore = usePanelsStore()
      const mode = useModeStore()
      mode.setMode('markup') // gives the left sidebar two expanded panels: Hierarchy + Icon Library
      const wrapper = mount(SidebarContainer, { props: { side: 'left' }, attachTo: document.body })
      await nextTick()
      stubPanelRects(wrapper, [0, 200])

      const handle = wrapper.get('.panel-resize-handle').element as HTMLElement
      handle.dispatchEvent(pointerEvent('pointerdown', { clientY: 200, pointerId: 1 }))
      handle.dispatchEvent(pointerEvent('pointermove', { clientY: 250, pointerId: 1 })) // grow Hierarchy by 50px

      const hierarchy = panelsStore.panels.find((p) => p.id === 'hierarchy')!
      const iconLibrary = panelsStore.panels.find((p) => p.id === 'iconLibrary')!
      expect(hierarchy.size + iconLibrary.size).toBeCloseTo(2) // pairSizeSum preserved (started 1 + 1)
      expect(hierarchy.size).toBeGreaterThan(1)
      expect(localStorage.getItem('mmm:panels')).toBeNull()

      handle.dispatchEvent(pointerEvent('pointerup', { clientY: 250, pointerId: 1 }))
      panelsStore.$flushPersist()
      const saved = JSON.parse(localStorage.getItem('mmm:panels') ?? '{}').data.panels
      expect(saved.find((p: { id: string }) => p.id === 'hierarchy').size).toBeCloseTo(
        hierarchy.size,
      )
    })

    it('does not render a resize handle next to a collapsed panel', async () => {
      const panelsStore = usePanelsStore()
      const mode = useModeStore()
      mode.setMode('markup')
      panelsStore.toggleCollapsed('hierarchy')
      const wrapper = mount(SidebarContainer, { props: { side: 'left' } })
      await nextTick()
      expect(wrapper.find('.panel-resize-handle').exists()).toBe(false)
    })
  })

  describe('drag to reorder', () => {
    beforeEach(() => {
      const mode = useModeStore()
      mode.setMode('markup') // two panels on the left to reorder against each other
    })

    it("moving past a neighbor's midpoint reorders the panels", async () => {
      const panelsStore = usePanelsStore()
      const wrapper = mount(SidebarContainer, { props: { side: 'left' }, attachTo: document.body })
      await nextTick()
      const panels = wrapper.findAll('[data-panel-id]')
      panels[0].element.getBoundingClientRect = () => ({ top: 0, height: 40 }) as DOMRect
      panels[1].element.getBoundingClientRect = () => ({ top: 40, height: 40 }) as DOMRect

      const header = wrapper.get('.panel-header').element as HTMLElement
      header.dispatchEvent(pointerEvent('pointerdown', { clientY: 20, pointerId: 1 }))
      header.dispatchEvent(pointerEvent('pointermove', { clientY: 70, pointerId: 1 })) // past Icon Library's midpoint (60)
      header.dispatchEvent(pointerEvent('pointerup', { clientY: 70, pointerId: 1 }))

      const left = panelsStore.panels
        .filter((p) => p.side === 'left')
        .sort((a, b) => a.order - b.order)
      expect(left.map((p) => p.id)).toEqual(['iconLibrary', 'hierarchy'])
    })

    it('a small movement within the dead zone does not reorder, and the click still toggles collapse', async () => {
      const panelsStore = usePanelsStore()
      const wrapper = mount(SidebarContainer, { props: { side: 'left' }, attachTo: document.body })
      await nextTick()

      const header = wrapper.get('.panel-header').element as HTMLElement
      header.dispatchEvent(pointerEvent('pointerdown', { clientY: 20, pointerId: 1 }))
      header.dispatchEvent(pointerEvent('pointermove', { clientY: 22, pointerId: 1 })) // under the dead zone
      header.dispatchEvent(pointerEvent('pointerup', { clientY: 22, pointerId: 1 }))
      await wrapper.get('.panel-title').trigger('click')

      const left = panelsStore.panels
        .filter((p) => p.side === 'left')
        .sort((a, b) => a.order - b.order)
      expect(left.map((p) => p.id)).toEqual(['hierarchy', 'iconLibrary']) // unchanged order
      expect(panelsStore.panels.find((p) => p.id === 'hierarchy')?.collapsed).toBe(true) // click toggled it
    })

    it('a real drag suppresses the trailing click so it does not also toggle collapse', async () => {
      const panelsStore = usePanelsStore()
      const wrapper = mount(SidebarContainer, { props: { side: 'left' }, attachTo: document.body })
      await nextTick()
      const panels = wrapper.findAll('[data-panel-id]')
      panels[0].element.getBoundingClientRect = () => ({ top: 0, height: 40 }) as DOMRect
      panels[1].element.getBoundingClientRect = () => ({ top: 40, height: 40 }) as DOMRect

      const header = wrapper.get('.panel-header').element as HTMLElement
      header.dispatchEvent(pointerEvent('pointerdown', { clientY: 20, pointerId: 1 }))
      header.dispatchEvent(pointerEvent('pointermove', { clientY: 70, pointerId: 1 }))
      header.dispatchEvent(pointerEvent('pointerup', { clientY: 70, pointerId: 1 }))
      header.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

      expect(panelsStore.panels.find((p) => p.id === 'hierarchy')?.collapsed).toBe(false) // trailing click suppressed
    })
  })
})
