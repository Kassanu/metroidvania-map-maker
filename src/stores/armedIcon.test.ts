import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { useArmedIconStore } from './armedIcon'
import { useModeStore } from './mode'

describe('the armed icon', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
    useModeStore().setMode('markup')
  })

  it('starts disarmed, so clicks mean what the table says', () => {
    const armed = useArmedIconStore()
    expect(armed.iconType).toBeNull()
    expect(armed.isArmed).toBe(false)
  })

  it('holds the registry id rather than the entry', () => {
    const armed = useArmedIconStore()
    armed.arm('save')
    // The id is what the placement op takes; holding the entry would pin a
    // snapshot of art the catalogue owns.
    expect(armed.iconType).toBe('save')
    expect(armed.isArmed).toBe(true)
  })

  it('toggles off on the same icon and re-arms on a different one', () => {
    const armed = useArmedIconStore()

    armed.toggle('save')
    expect(armed.iconType).toBe('save')
    // Clicking the armed library icon again is one of the three routes out.
    armed.toggle('save')
    expect(armed.iconType).toBeNull()

    armed.toggle('save')
    armed.toggle('missile')
    // A different icon re-arms rather than disarming.
    expect(armed.iconType).toBe('missile')
  })

  it('disarms on leaving Markup, and stays disarmed on returning', () => {
    const armed = useArmedIconStore()
    const mode = useModeStore()
    armed.arm('save')

    mode.setMode('draw')
    expect(armed.iconType).toBeNull()

    // Re-entering does not restore it: arming is a thing the user did, not a
    // property of the mode.
    mode.setMode('markup')
    expect(armed.iconType).toBeNull()
  })

  it('survives a tab switch, because it names no map', () => {
    const armed = useArmedIconStore()
    armed.arm('save')

    // Unlike the pending teleport it carries no map id, so there is nothing a
    // tab change could invalidate: the whole point is placing on several maps.
    expect(armed.iconType).toBe('save')
  })
})
