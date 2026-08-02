import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import AboutModal from './AboutModal.vue'
import { useUiStore } from '@/stores/ui'
import { version as appVersion } from '../../../package.json'

describe('AboutModal', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    setActivePinia(createTestPinia())
    wrapper = mount(AboutModal, { attachTo: document.body })
  })

  afterEach(() => {
    wrapper.unmount()
  })

  it('is not in the document while closed', () => {
    expect(document.querySelector('.modal-content')).toBeNull()
  })

  it('shows the app version once opened', async () => {
    const ui = useUiStore()
    ui.openAbout()
    await nextTick()

    expect(document.querySelector('.about-version')?.textContent).toContain(appVersion)
  })
})
