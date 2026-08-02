import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { useHotkeys } from './useHotkeys'
import { useModeStore } from '@/stores/mode'
import { useTabsStore } from '@/stores/tabs'
import { PROJECT_SCOPE, useModelStore } from '@/stores/model'
import { renameProject } from '@/core/ops/project'

const HostComponent = defineComponent({
  setup() {
    useHotkeys()
    return () => null
  },
})

function dispatchOn(target: EventTarget, init: Partial<KeyboardEventInit> & { key: string }) {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
}

describe('useHotkeys', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    setActivePinia(createTestPinia())
    wrapper = mount(HostComponent, { attachTo: document.body })
  })

  afterEach(() => {
    wrapper.unmount()
  })

  it('switches modes on number keys', () => {
    const modeStore = useModeStore()
    dispatchOn(window, { key: '4' })
    expect(modeStore.active).toBe('markup')
  })

  it('zooms the active tab on mod+= and resets on mod+0', () => {
    const tabsStore = useTabsStore()
    const tabId = tabsStore.activeTabId

    dispatchOn(window, { key: '=', ctrlKey: true })
    expect(tabsStore.cameraOf(tabId).zoom).toBe(1.25)

    dispatchOn(window, { key: '0', ctrlKey: true })
    expect(tabsStore.cameraOf(tabId).zoom).toBe(1)
  })

  // One stack for the whole project, so undo/redo are global rather than
  // per-tab. Both bindings for redo are in the keymap because Windows apps use
  // Ctrl+Y and mod+shift+Z is the cross-platform convention.
  it('undoes on mod+z and redoes on both mod+shift+z and mod+y', () => {
    const model = useModelStore()
    model.run('Rename', PROJECT_SCOPE, (tx) => renameProject(tx, model.project, 'Zebes'))

    dispatchOn(window, { key: 'z', ctrlKey: true })
    expect(model.project.name).toBe('Untitled Project')

    dispatchOn(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(model.project.name).toBe('Zebes')

    dispatchOn(window, { key: 'z', ctrlKey: true })
    dispatchOn(window, { key: 'y', ctrlKey: true })
    expect(model.project.name).toBe('Zebes')
  })

  it('undo at the bottom of the stack does nothing rather than throwing', () => {
    const model = useModelStore()
    dispatchOn(window, { key: 'z', ctrlKey: true })
    expect(model.project.name).toBe('Untitled Project')
    expect(model.status.canRedo).toBe(false)
  })

  it('does nothing while an input is focused', () => {
    const modeStore = useModeStore()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    dispatchOn(input, { key: '4' })

    expect(modeStore.active).toBe('draw')
    input.remove()
  })

  it('does nothing for an unbound combo', () => {
    const modeStore = useModeStore()
    dispatchOn(window, { key: 'q', ctrlKey: true, shiftKey: true, altKey: true })
    expect(modeStore.active).toBe('draw')
  })
})
