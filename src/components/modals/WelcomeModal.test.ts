import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import WelcomeModal from './WelcomeModal.vue'
import { useUiStore } from '@/stores/ui'

describe('WelcomeModal', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createTestPinia())
    wrapper = mount(WelcomeModal, { attachTo: document.body })
  })

  afterEach(() => {
    wrapper.unmount()
  })

  it('is open by default (first run)', () => {
    expect(document.querySelector('.modal-content')).not.toBeNull()
  })

  it('checking "don\'t show on startup" persists the preference', async () => {
    const ui = useUiStore()
    const checkbox = document.querySelector('.welcome-checkbox input') as HTMLInputElement
    checkbox.checked = true
    await checkbox.dispatchEvent(new Event('change'))
    await nextTick()

    expect(ui.hideWelcomeOnStartup).toBe(true)
    ui.$flushPersist()
    expect(JSON.parse(localStorage.getItem('mmm:welcome') ?? '{}').data).toEqual({
      hideWelcomeOnStartup: true,
    })
  })

  it('"Get started" closes it', async () => {
    const ui = useUiStore()
    const dismiss = document.querySelector('.welcome-dismiss') as HTMLElement
    dismiss.click()
    await nextTick()

    expect(ui.welcomeOpen).toBe(false)
  })
})
