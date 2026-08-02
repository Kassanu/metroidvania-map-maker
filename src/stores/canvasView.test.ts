import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { useCanvasViewStore } from './canvasView'
import { PREFS_VERSION } from '@/config/preferences'

function savedPref(key: string): Record<string, unknown> | undefined {
  const raw = localStorage.getItem(`mmm:${key}`)
  return raw ? JSON.parse(raw).data : undefined
}

describe('useCanvasViewStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createTestPinia())
  })

  it('defaults to grid/rulers/coords all on, units in cells', () => {
    const store = useCanvasViewStore()
    expect(store.showGrid).toBe(true)
    expect(store.showRulers).toBe(true)
    expect(store.showCoords).toBe(true)
    expect(store.rulerUnits).toBe('cells')
  })

  it('each toggle flips only its own flag, and persists', () => {
    const store = useCanvasViewStore()
    store.toggleGrid()
    expect(store.showGrid).toBe(false)
    expect(store.showRulers).toBe(true)

    store.$flushPersist()
    expect(savedPref('canvasView')?.showGrid).toBe(false)
  })

  it('toggleRulers and toggleCoords flip independently', () => {
    const store = useCanvasViewStore()
    store.toggleRulers()
    expect(store.showRulers).toBe(false)
    store.toggleCoords()
    expect(store.showCoords).toBe(false)
    expect(store.showGrid).toBe(true)
  })

  it('setRulerUnits switches and persists the unit', () => {
    const store = useCanvasViewStore()
    store.setRulerUnits('px')
    expect(store.rulerUnits).toBe('px')
    store.$flushPersist()
    expect(savedPref('canvasView')?.rulerUnits).toBe('px')
  })

  it('loads saved prefs on store creation', () => {
    localStorage.setItem(
      'mmm:canvasView',
      JSON.stringify({
        v: PREFS_VERSION,
        data: { showGrid: false, showRulers: false, showCoords: true, rulerUnits: 'px' },
      }),
    )
    const store = useCanvasViewStore()
    expect(store.showGrid).toBe(false)
    expect(store.showRulers).toBe(false)
    expect(store.rulerUnits).toBe('px')
  })

  // The layer toggles, and the nesting between them.
  describe('the transitions layer', () => {
    it('defaults both the layer and its sub-toggle on', () => {
      const store = useCanvasViewStore()
      expect(store.showTransitions).toBe(true)
      expect(store.showTeleportLines).toBe(true)
      expect(store.teleportLinesDisabled).toBe(false)
    })

    it('toggles the layer, and persists it', () => {
      const store = useCanvasViewStore()
      store.toggleTransitions()
      expect(store.showTransitions).toBe(false)
      store.$flushPersist()
      expect(savedPref('canvasView')?.showTransitions).toBe(false)
    })

    it('reports the sub-toggle as disabled while the layer is off', () => {
      const store = useCanvasViewStore()
      store.toggleTransitions()
      expect(store.teleportLinesDisabled).toBe(true)
    })

    // Disabled, not merely ignored: the menu item cannot be clicked, and the
    // action refuses too, so a keyboard route or a future shortcut cannot store
    // a change nobody can see.
    it('refuses to toggle lines while the layer is off', () => {
      const store = useCanvasViewStore()
      store.toggleTransitions()
      store.toggleTeleportLines()
      expect(store.showTeleportLines).toBe(true)
    })

    // The reason the two flags stay independent state rather than the master
    // forcing the sub-toggle: hiding the layer and showing it again has to give
    // back the map you had, not silently restore lines you had turned off.
    it('remembers a hidden line through the layer going off and on', () => {
      const store = useCanvasViewStore()
      store.toggleTeleportLines()
      expect(store.showTeleportLines).toBe(false)

      store.toggleTransitions()
      store.toggleTransitions()

      expect(store.showTransitions).toBe(true)
      expect(store.showTeleportLines).toBe(false)
    })

    // `pick` keeps a field absent from storage at its default, so adding a
    // field does not need a PREFS_VERSION bump: a stored pref missing it reads
    // back as the default rather than `undefined`.
    it('defaults both when an older stored pref has neither', () => {
      localStorage.setItem(
        'mmm:canvasView',
        JSON.stringify({
          v: PREFS_VERSION,
          data: { showGrid: false, showRulers: true, showCoords: true, rulerUnits: 'cells' },
        }),
      )
      const store = useCanvasViewStore()
      expect(store.showGrid).toBe(false)
      expect(store.showTransitions).toBe(true)
      expect(store.showTeleportLines).toBe(true)
    })
  })

  // The same nesting one level along, with two children under one master.
  describe('the markup layer', () => {
    it('defaults the layer and both sub-toggles on', () => {
      const store = useCanvasViewStore()
      expect(store.showMarkup).toBe(true)
      expect(store.showIcons).toBe(true)
      expect(store.showLines).toBe(true)
      expect(store.markupLayersDisabled).toBe(false)
    })

    it('toggles the layer, and persists it', () => {
      const store = useCanvasViewStore()
      store.toggleMarkup()
      expect(store.showMarkup).toBe(false)
      store.$flushPersist()
      expect(savedPref('canvasView')?.showMarkup).toBe(false)
    })

    it('reports both sub-toggles as disabled while the layer is off', () => {
      const store = useCanvasViewStore()
      store.toggleMarkup()
      expect(store.markupLayersDisabled).toBe(true)
    })

    it('refuses to toggle either half while the layer is off', () => {
      const store = useCanvasViewStore()
      store.toggleMarkup()
      store.toggleIcons()
      store.toggleLines()
      expect(store.showIcons).toBe(true)
      expect(store.showLines).toBe(true)
    })

    it('toggles the two halves independently of each other', () => {
      const store = useCanvasViewStore()
      store.toggleIcons()
      expect(store.showIcons).toBe(false)
      expect(store.showLines).toBe(true)
    })

    it('remembers a hidden half through the layer going off and on', () => {
      const store = useCanvasViewStore()
      store.toggleLines()

      store.toggleMarkup()
      store.toggleMarkup()

      expect(store.showMarkup).toBe(true)
      expect(store.showLines).toBe(false)
    })

    it('defaults every markup field when an older stored pref has none', () => {
      localStorage.setItem(
        'mmm:canvasView',
        JSON.stringify({
          v: PREFS_VERSION,
          data: { showGrid: false, showRulers: true, showCoords: true, rulerUnits: 'cells' },
        }),
      )
      const store = useCanvasViewStore()
      expect(store.showMarkup).toBe(true)
      expect(store.showIcons).toBe(true)
      expect(store.showLines).toBe(true)
      expect(store.showAllLabels).toBe(false)
    })
  })

  describe('the show-all-labels toggle', () => {
    // Off where every layer toggle is on: this one is not a layer. A map with
    // a label on everything is unreadable, so hover-only is the resting state
    // and showing them all is the deliberate act.
    it('defaults off, unlike every layer toggle', () => {
      expect(useCanvasViewStore().showAllLabels).toBe(false)
    })

    it('toggles and persists, and answers to no master', () => {
      const store = useCanvasViewStore()
      store.toggleMarkup()
      // Still free with the markup layer hidden: labels are drawn inside their
      // objects' gates, so the layer already hides them and there is nothing
      // for this control to claim falsely.
      store.toggleAllLabels()
      expect(store.showAllLabels).toBe(true)
      store.$flushPersist()
      expect(savedPref('canvasView')?.showAllLabels).toBe(true)
    })
  })
})
