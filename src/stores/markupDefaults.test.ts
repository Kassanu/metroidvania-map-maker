import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { useMarkupDefaultsStore } from './markupDefaults'

describe('markup defaults', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  it('blocks placing on an occupied cell until asked not to', () => {
    const defaults = useMarkupDefaultsStore()
    // Blocked is the default: the checkbox is what opts into overwriting.
    expect(defaults.replace).toBe(false)
    defaults.setReplace(true)
    expect(defaults.replace).toBe(true)
  })

  it('hands a placement both colours as one pair', () => {
    const defaults = useMarkupDefaultsStore()
    defaults.setPlateColor('#111111')
    defaults.setGlyphColor('#222222')
    expect(defaults.colors).toEqual({ plateColor: '#111111', glyphColor: '#222222' })
  })

  it('loads an icon’s canonical pair, replacing any override', () => {
    const defaults = useMarkupDefaultsStore()
    defaults.setPlateColor('#111111')

    defaults.loadColors({ plateColor: '#3b7dd8', glyphColor: '#f5f7fa' })

    // Both at once, so a half-loaded pair can never be placed.
    expect(defaults.colors).toEqual({ plateColor: '#3b7dd8', glyphColor: '#f5f7fa' })
  })

  it('keeps an override made after arming', () => {
    const defaults = useMarkupDefaultsStore()
    defaults.loadColors({ plateColor: '#3b7dd8', glyphColor: '#f5f7fa' })

    // Arming loads; the user may then override, and that override sticks until
    // the next icon is armed.
    defaults.setPlateColor('#c94f4f')
    expect(defaults.colors).toEqual({ plateColor: '#c94f4f', glyphColor: '#f5f7fa' })
  })
})
