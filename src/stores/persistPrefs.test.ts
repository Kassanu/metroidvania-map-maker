import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineStore, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { createTestPinia } from '@/test-setup'
import { PREFS_VERSION } from '@/config/preferences'

const useProbeStore = defineStore('persistProbe', {
  state: () => ({ durable: 1, alsoDurable: 'a', session: false }),
  actions: {
    bumpDurable() {
      this.durable += 1
    },
    flipSession() {
      this.session = !this.session
    },
  },
  persist: { key: 'probe', paths: ['durable', 'alsoDurable'] },
})

function stored(key: string) {
  const raw = localStorage.getItem(`mmm:${key}`)
  return raw ? JSON.parse(raw) : null
}

function seed(key: string, data: Record<string, unknown>, v = PREFS_VERSION) {
  localStorage.setItem(`mmm:${key}`, JSON.stringify({ v, data }))
}

describe('persistPrefs plugin', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createTestPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes only the declared paths, under a versioned envelope', () => {
    const store = useProbeStore()
    store.bumpDurable()
    store.$flushPersist()

    expect(stored('probe')).toEqual({ v: PREFS_VERSION, data: { durable: 2, alsoDurable: 'a' } })
  })

  // $subscribe fires on the next tick, so these await it before letting the
  // debounce timer run.
  it('debounces the write instead of storing on every mutation', async () => {
    vi.useFakeTimers()
    const store = useProbeStore()

    store.bumpDurable()
    store.bumpDurable()
    await nextTick()
    expect(stored('probe')).toBeNull()

    vi.runAllTimers()
    expect(stored('probe')?.data.durable).toBe(3)
  })

  it('leaves storage untouched when only a non-persisted field changes', async () => {
    vi.useFakeTimers()
    const store = useProbeStore()

    store.flipSession()
    await nextTick()
    vi.runAllTimers()

    expect(stored('probe')).toBeNull()
  })

  it('restores saved fields on creation and leaves absent ones at their default', () => {
    seed('probe', { durable: 42 })
    const store = useProbeStore()

    expect(store.durable).toBe(42)
    expect(store.alsoDurable).toBe('a')
  })

  it('drops fields that are no longer part of the state', () => {
    seed('probe', { durable: 7, longGone: true })
    const store = useProbeStore()

    expect(store.durable).toBe(7)
    expect('longGone' in store.$state).toBe(false)
  })

  it('falls back to defaults for a stored envelope from another version', () => {
    seed('probe', { durable: 99 }, PREFS_VERSION + 1)
    const store = useProbeStore()

    expect(store.durable).toBe(1)
  })

  it('ignores a value that was not written by the plugin', () => {
    localStorage.setItem('mmm:probe', JSON.stringify({ durable: 99 }))
    const store = useProbeStore()

    expect(store.durable).toBe(1)
  })
})
