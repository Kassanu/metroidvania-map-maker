import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import CheatSheetModal from './CheatSheetModal.vue'
import { useUiStore } from '@/stores/ui'

describe('CheatSheetModal', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    setActivePinia(createTestPinia())
    wrapper = mount(CheatSheetModal, { attachTo: document.body })
  })

  afterEach(() => {
    wrapper.unmount()
  })

  it('is not in the document while closed', () => {
    expect(document.querySelector('.modal-content')).toBeNull()
  })

  it('renders shortcut content once opened', async () => {
    const ui = useUiStore()
    ui.toggleCheatSheet()
    await nextTick()

    const content = document.querySelector('.modal-content')
    expect(content).not.toBeNull()
    expect(content?.textContent).toContain('Redo')
    expect(content?.textContent).toContain('Ctrl+Z')
  })

  it("toggling the ui store's cheatSheetOpen flag opens and closes it", () => {
    const ui = useUiStore()
    expect(ui.cheatSheetOpen).toBe(false)
    ui.toggleCheatSheet()
    expect(ui.cheatSheetOpen).toBe(true)
    ui.toggleCheatSheet()
    expect(ui.cheatSheetOpen).toBe(false)
  })
})
