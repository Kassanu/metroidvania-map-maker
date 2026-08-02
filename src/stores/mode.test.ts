import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { useModeStore } from './mode'

describe('useModeStore', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  it('defaults to draw mode', () => {
    expect(useModeStore().active).toBe('draw')
  })

  it('switches modes', () => {
    const store = useModeStore()
    store.setMode('markup')
    expect(store.active).toBe('markup')
  })
})
