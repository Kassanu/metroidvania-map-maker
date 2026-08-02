import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { useThemeStore } from './theme'
import { PREFS_VERSION } from '@/config/preferences'

describe('useThemeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createTestPinia())
  })

  it('defaults to system', () => {
    const store = useThemeStore()
    expect(store.mode).toBe('system')
  })

  it('setMode updates the mode and persists it', () => {
    const store = useThemeStore()
    store.setMode('dark')
    expect(store.mode).toBe('dark')
    store.$flushPersist()
    expect(JSON.parse(localStorage.getItem('mmm:theme') ?? '{}').data).toEqual({ mode: 'dark' })
  })

  it('loads a previously saved mode on store creation', () => {
    localStorage.setItem('mmm:theme', JSON.stringify({ v: PREFS_VERSION, data: { mode: 'light' } }))
    const store = useThemeStore()
    expect(store.mode).toBe('light')
  })

  it('ignores a stored pref written by an incompatible version', () => {
    localStorage.setItem(
      'mmm:theme',
      JSON.stringify({ v: PREFS_VERSION + 1, data: { mode: 'dark' } }),
    )
    const store = useThemeStore()
    expect(store.mode).toBe('system')
  })
})
