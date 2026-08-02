import { describe, it, expect, beforeEach } from 'vitest'
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from '@/canvas/brush'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { useToolsStore } from './tools'
import { useModeStore } from './mode'

describe('tools store', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
    localStorage.clear()
  })

  it('starts with erase off and a 1×1 brush', () => {
    const tools = useToolsStore()
    expect(tools.erase).toBe(false)
    expect(tools.brushSize).toBe(1)
  })

  describe('brush size', () => {
    // Clamped in the store rather than at each call site, so `[` at the floor
    // and `]` at the ceiling are quiet no-ops wherever they arrive from.
    it('stops at the floor and the ceiling', () => {
      const tools = useToolsStore()

      tools.shrinkBrush()
      expect(tools.brushSize).toBe(MIN_BRUSH_SIZE)

      tools.setBrushSize(MAX_BRUSH_SIZE)
      tools.growBrush()
      expect(tools.brushSize).toBe(MAX_BRUSH_SIZE)
    })

    it('steps one at a time', () => {
      const tools = useToolsStore()
      tools.growBrush()
      tools.growBrush()
      expect(tools.brushSize).toBe(3)
      tools.shrinkBrush()
      expect(tools.brushSize).toBe(2)
    })

    it('admits no fractional size', () => {
      const tools = useToolsStore()
      tools.setBrushSize(2.5)
      expect(Number.isInteger(tools.brushSize)).toBe(true)
    })
  })

  // One flag across modes, not one per mode: the toggle means the same thing
  // in Draw, Door and Markup, so switching between them must not silently
  // disarm it.
  it('keeps the erase toggle across a mode switch', () => {
    const tools = useToolsStore()
    const modeStore = useModeStore()

    tools.toggleErase()
    modeStore.setMode('markup')
    modeStore.setMode('draw')

    expect(tools.erase).toBe(true)
  })

  // Deliberately not persisted: the store declares no `persist` option, which
  // is the whole opt-in. Brush size resets to the default each session rather
  // than being saved as a user pref; the erase toggle follows it because a tool
  // left in a destructive state across restarts is a trap. This assertion
  // catches persistence added later for symmetry with the view toggles.
  it('does not survive a session', () => {
    const tools = useToolsStore()
    tools.toggleErase()
    tools.setBrushSize(5)
    tools.$flushPersist()

    expect(localStorage.length).toBe(0)

    setActivePinia(createTestPinia())
    expect(useToolsStore().erase).toBe(false)
    expect(useToolsStore().brushSize).toBe(1)
  })
})
