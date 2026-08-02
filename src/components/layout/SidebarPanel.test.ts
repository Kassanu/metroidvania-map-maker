import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import SidebarPanel from './SidebarPanel.vue'
import { usePanelsStore } from '@/stores/panels'

describe('SidebarPanel', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createTestPinia())
    wrapper = mount(SidebarPanel, {
      props: { id: 'hierarchy', title: 'Hierarchy' },
      slots: { default: '<p class="panel-content">content</p>' },
      attachTo: document.body,
    })
  })

  afterEach(() => {
    wrapper.unmount()
  })

  it('renders its slot content while expanded', () => {
    expect(wrapper.find('.panel-content').exists()).toBe(true)
  })

  it('collapsing via the chevron hides the slot content', async () => {
    await wrapper.get('.panel-collapse-button').trigger('click')
    expect(wrapper.find('.panel-content').exists()).toBe(false)
  })

  it('clicking the title also toggles collapse', async () => {
    await wrapper.get('.panel-title').trigger('click')
    expect(wrapper.find('.panel-content').exists()).toBe(false)
  })

  it('the "..." menu\'s Remove item hides the panel via the store', async () => {
    const panelsStore = usePanelsStore()
    await wrapper.get('.panel-menu-button').trigger('click')
    await nextTick()

    const removeItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === 'Remove',
    ) as HTMLElement
    removeItem.click()
    await nextTick()

    expect(panelsStore.isVisible('hierarchy')).toBe(false)
  })
})
