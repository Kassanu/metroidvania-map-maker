import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { useLocaleStore } from '@/stores/locale'
import { useApplyLocale } from './useApplyLocale'
import { currentLocale, setLocale } from './index'

const Host = defineComponent({
  setup() {
    useApplyLocale()
    return () => null
  },
})

describe('useApplyLocale', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createTestPinia())
  })

  afterEach(() => {
    setLocale('en')
    vi.unstubAllGlobals()
  })

  it('resolves the system preference from the browser languages', () => {
    vi.stubGlobal('navigator', { languages: ['fr-FR', 'en-GB'] })
    mount(Host)
    expect(currentLocale()).toBe('en')
  })

  it('re-resolves when the browser language changes', () => {
    vi.stubGlobal('navigator', { languages: ['fr-FR'] })
    mount(Host)

    const resolve = vi.fn()
    window.addEventListener('languagechange', resolve)
    window.dispatchEvent(new Event('languagechange'))
    expect(resolve).toHaveBeenCalled()
    expect(currentLocale()).toBe('en')
    window.removeEventListener('languagechange', resolve)
  })

  it('uses an explicit preference instead of the system one', () => {
    const localeStore = useLocaleStore()
    localeStore.setPreference('en')
    mount(Host)
    expect(currentLocale()).toBe('en')
  })

  it('stops listening once the host unmounts', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    mount(Host).unmount()
    expect(remove).toHaveBeenCalledWith('languagechange', expect.any(Function))
  })
})

describe('useLocaleStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createTestPinia())
  })

  it('defaults to following the system', () => {
    expect(useLocaleStore().preference).toBe('system')
  })

  it('persists an explicit choice', () => {
    const localeStore = useLocaleStore()
    localeStore.setPreference('en')
    localeStore.$flushPersist()

    expect(JSON.parse(localStorage.getItem('mmm:locale') ?? '{}').data).toEqual({
      preference: 'en',
    })
  })
})
