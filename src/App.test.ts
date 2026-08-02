import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { nextTick } from 'vue'
import App from './App.vue'
import { useUiStore } from './stores/ui'

describe('App', () => {
  it('renders the app name and all shell regions', () => {
    const wrapper = mount(App, { global: { plugins: [createTestPinia()] } })

    expect(wrapper.get('h1').text()).toBe('Metroidvania Map Maker')
    expect(wrapper.find('[aria-label="Main menu"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Toolbar"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Mode switch"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Primary sidebar"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Map canvas"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Inspector"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Maps"]').exists()).toBe(true)
  })

  describe('Zen mode', () => {
    it('keeps only the toolbar, canvas, and tab bar; hides the rest of the chrome', async () => {
      const pinia = createTestPinia()
      setActivePinia(pinia)
      const wrapper = mount(App, { global: { plugins: [pinia] } })

      useUiStore().toggleZenMode()
      await nextTick()

      expect(wrapper.find('[aria-label="Main menu"]').exists()).toBe(false)
      expect(wrapper.find('[aria-label="Mode switch"]').exists()).toBe(false)
      expect(wrapper.find('[aria-label="Primary sidebar"]').exists()).toBe(false)
      expect(wrapper.find('[aria-label="Inspector"]').exists()).toBe(false)
      expect(wrapper.find('[aria-label="Toolbar"]').exists()).toBe(true)
      expect(wrapper.find('[aria-label="Map canvas"]').exists()).toBe(true)
      expect(wrapper.find('[aria-label="Maps"]').exists()).toBe(true)
    })

    it("toggling the toolbar's Zen button again (still visible) restores the chrome", async () => {
      const pinia = createTestPinia()
      setActivePinia(pinia)
      const wrapper = mount(App, { global: { plugins: [pinia] } })
      const ui = useUiStore()

      ui.toggleZenMode()
      await nextTick()
      await wrapper.get('.zen-toggle-button').trigger('click')

      expect(ui.zenMode).toBe(false)
      expect(wrapper.find('[aria-label="Main menu"]').exists()).toBe(true)
      expect(wrapper.find('[aria-label="Primary sidebar"]').exists()).toBe(true)
    })
  })
})
