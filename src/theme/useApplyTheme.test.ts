import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { nextTick } from 'vue'
import { useApplyTheme } from './useApplyTheme'
import { useThemeStore } from '@/stores/theme'

describe('useApplyTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createTestPinia())
    document.documentElement.removeAttribute('data-theme')
  })

  it('clears the data-theme override for "system" (lets prefers-color-scheme apply)', () => {
    useApplyTheme()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('stamps data-theme when the mode changes to an explicit override', async () => {
    const theme = useThemeStore()
    useApplyTheme()

    theme.setMode('dark')
    await nextTick()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    theme.setMode('light')
    await nextTick()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('switching back to "system" clears the override again', async () => {
    const theme = useThemeStore()
    useApplyTheme()

    theme.setMode('dark')
    await nextTick()
    theme.setMode('system')
    await nextTick()

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})
