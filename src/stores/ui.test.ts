import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { useUiStore } from './ui'
import { PREFS_VERSION } from '@/config/preferences'

// The persistence plugin wraps stored prefs in a { v, data } envelope and
// debounces the write, so these read/write through the same shape and flush
// pending writes rather than waiting on a timer.
function savedPref(key: string): Record<string, unknown> | undefined {
  const raw = localStorage.getItem(`mmm:${key}`)
  return raw ? JSON.parse(raw).data : undefined
}

function seedPref(key: string, data: Record<string, unknown>) {
  localStorage.setItem(`mmm:${key}`, JSON.stringify({ v: PREFS_VERSION, data }))
}

describe('useUiStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createTestPinia())
  })

  it('starts expanded at the default width on both sides', () => {
    const store = useUiStore()
    expect(store.leftSidebarCollapsed).toBe(false)
    expect(store.rightSidebarCollapsed).toBe(false)
    expect(store.leftSidebarWidth).toBe(256)
    expect(store.rightSidebarWidth).toBe(256)
  })

  describe('collapse toggles', () => {
    it('toggleLeftSidebar/toggleRightSidebar flip only their own side, and persist', () => {
      const store = useUiStore()
      store.toggleLeftSidebar()
      expect(store.leftSidebarCollapsed).toBe(true)
      expect(store.rightSidebarCollapsed).toBe(false)

      store.$flushPersist()
      expect(savedPref('sidebarLayout')?.leftSidebarCollapsed).toBe(true)
    })
  })

  describe('width setters', () => {
    it('clamps to the min/max bounds', () => {
      const store = useUiStore()
      store.setLeftSidebarWidth(10)
      expect(store.leftSidebarWidth).toBe(160)
      store.setLeftSidebarWidth(9999)
      expect(store.leftSidebarWidth).toBe(480)
    })

    it('holds the write until the debounce flushes, then stores the final width', () => {
      const store = useUiStore()
      store.setRightSidebarWidth(280)
      store.setRightSidebarWidth(300)
      expect(localStorage.getItem('mmm:sidebarLayout')).toBeNull()

      store.$flushPersist()
      expect(savedPref('sidebarLayout')?.rightSidebarWidth).toBe(300)
    })
  })

  describe('resetSidebarLayout', () => {
    it('restores both sides to expanded at the default width, and persists', () => {
      const store = useUiStore()
      store.toggleLeftSidebar()
      store.setRightSidebarWidth(400)
      store.$flushPersist()

      store.resetSidebarLayout()

      expect(store.leftSidebarCollapsed).toBe(false)
      expect(store.rightSidebarCollapsed).toBe(false)
      expect(store.leftSidebarWidth).toBe(256)
      expect(store.rightSidebarWidth).toBe(256)

      store.$flushPersist()
      expect(savedPref('sidebarLayout')).toMatchObject({
        leftSidebarCollapsed: false,
        rightSidebarCollapsed: false,
        leftSidebarWidth: 256,
        rightSidebarWidth: 256,
      })
    })
  })

  describe('zen mode', () => {
    it('starts off and toggles without touching sidebarLayout persistence', () => {
      const store = useUiStore()
      expect(store.zenMode).toBe(false)

      store.toggleZenMode()
      expect(store.zenMode).toBe(true)
      // Session-only fields are outside the persist entry's paths, so they
      // don't even create a stored entry.
      store.$flushPersist()
      expect(localStorage.getItem('mmm:sidebarLayout')).toBeNull()

      store.toggleZenMode()
      expect(store.zenMode).toBe(false)
    })

    it('does not persist across a fresh store (session-only)', () => {
      const store = useUiStore()
      store.toggleZenMode()
      expect(store.zenMode).toBe(true)

      setActivePinia(createTestPinia())
      const fresh = useUiStore()
      expect(fresh.zenMode).toBe(false)
    })
  })

  describe('persistence', () => {
    it('loads saved collapsed/width state on store creation', () => {
      seedPref('sidebarLayout', {
        leftSidebarCollapsed: true,
        rightSidebarCollapsed: false,
        leftSidebarWidth: 200,
        rightSidebarWidth: 320,
      })
      const store = useUiStore()
      expect(store.leftSidebarCollapsed).toBe(true)
      expect(store.leftSidebarWidth).toBe(200)
      expect(store.rightSidebarWidth).toBe(320)
    })
  })

  describe('welcome screen', () => {
    it('is open by default (first run), with hideWelcomeOnStartup off', () => {
      const store = useUiStore()
      expect(store.welcomeOpen).toBe(true)
      expect(store.hideWelcomeOnStartup).toBe(false)
    })

    it('setHideWelcomeOnStartup persists the flag', () => {
      const store = useUiStore()
      store.setHideWelcomeOnStartup(true)
      expect(store.hideWelcomeOnStartup).toBe(true)
      store.$flushPersist()
      expect(savedPref('welcome')).toEqual({ hideWelcomeOnStartup: true })
    })

    it('does not auto-open on a fresh store once hideOnStartup is saved', () => {
      seedPref('welcome', { hideWelcomeOnStartup: true })
      const store = useUiStore()
      expect(store.welcomeOpen).toBe(false)
    })

    it('openWelcome() reopens it regardless of the startup preference', () => {
      seedPref('welcome', { hideWelcomeOnStartup: true })
      const store = useUiStore()
      expect(store.welcomeOpen).toBe(false)
      store.openWelcome()
      expect(store.welcomeOpen).toBe(true)
    })
  })

  describe('about dialog', () => {
    it('starts closed; openAbout() opens it', () => {
      const store = useUiStore()
      expect(store.aboutOpen).toBe(false)
      store.openAbout()
      expect(store.aboutOpen).toBe(true)
    })
  })
})
