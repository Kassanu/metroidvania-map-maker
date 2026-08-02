import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { usePanelsStore, type PanelDef } from './panels'
import { PANEL_REGISTRY, getRegistryEntry } from '@/panels/registry'
import { PREFS_VERSION } from '@/config/preferences'

function savedPanels(): PanelDef[] {
  const raw = localStorage.getItem('mmm:panels')
  return raw ? JSON.parse(raw).data.panels : []
}

function seedPanels(panels: Partial<PanelDef>[]) {
  localStorage.setItem('mmm:panels', JSON.stringify({ v: PREFS_VERSION, data: { panels } }))
}

describe('usePanelsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createTestPinia())
  })

  it('starts with one entry per registry panel, matching its default side and order', () => {
    const store = usePanelsStore()
    expect(store.panels.map((p) => p.id)).toEqual(PANEL_REGISTRY.map((e) => e.id))
    expect(store.panels.every((p) => !p.collapsed && p.visible && p.size === 1)).toBe(true)
    expect(store.panels.find((p) => p.id === 'hierarchy')?.side).toBe('left')
    expect(store.panels.find((p) => p.id === 'inspector')?.side).toBe('right')
  })

  it('getRegistryEntry() looks up a panel by id', () => {
    expect(getRegistryEntry('iconLibrary').mode).toBe('markup')
    expect(getRegistryEntry('hierarchy').mode).toBeUndefined()
  })

  describe('toggleCollapsed', () => {
    it('flips the collapsed flag for the given panel only', () => {
      const store = usePanelsStore()
      store.toggleCollapsed('hierarchy')
      expect(store.panels.find((p) => p.id === 'hierarchy')?.collapsed).toBe(true)
      expect(store.panels.find((p) => p.id === 'inspector')?.collapsed).toBe(false)
    })

    it('is a no-op for an unknown id', () => {
      const store = usePanelsStore()
      const before = store.panels.map((p) => ({ ...p }))
      // @ts-expect-error testing an invalid id is safely ignored
      store.toggleCollapsed('does-not-exist')
      expect(store.panels).toEqual(before)
    })
  })

  describe('setVisible / remove', () => {
    it('setVisible(false) hides the panel; isVisible reflects it', () => {
      const store = usePanelsStore()
      store.setVisible('inspector', false)
      expect(store.isVisible('inspector')).toBe(false)
      expect(store.isVisible('hierarchy')).toBe(true)
    })

    it('remove() is shorthand for setVisible(id, false)', () => {
      const store = usePanelsStore()
      store.remove('hierarchy')
      expect(store.isVisible('hierarchy')).toBe(false)
    })

    it('setVisible(true) restores a removed panel', () => {
      const store = usePanelsStore()
      store.remove('hierarchy')
      store.setVisible('hierarchy', true)
      expect(store.isVisible('hierarchy')).toBe(true)
    })
  })

  describe('setSizes', () => {
    it('applies each update, and the write waits for the debounce', () => {
      const store = usePanelsStore()
      store.setSizes([
        { id: 'hierarchy', size: 0.4 },
        { id: 'iconLibrary', size: 1.6 },
      ])
      expect(store.panels.find((p) => p.id === 'hierarchy')?.size).toBe(0.4)
      expect(store.panels.find((p) => p.id === 'iconLibrary')?.size).toBe(1.6)
      expect(localStorage.getItem('mmm:panels')).toBeNull()

      store.$flushPersist()
      expect(savedPanels().find((p) => p.id === 'hierarchy')?.size).toBe(0.4)
    })

    it('ignores updates for unknown ids', () => {
      const store = usePanelsStore()
      // @ts-expect-error testing an invalid id is safely ignored
      store.setSizes([{ id: 'does-not-exist', size: 5 }])
      expect(store.panels.every((p) => p.size === 1)).toBe(true)
    })
  })

  describe('reorderPanel', () => {
    it('moves a panel within its own side and reindexes that side only', () => {
      const store = usePanelsStore()
      store.reorderPanel('iconLibrary', 0) // was after hierarchy on the left
      const left = store.panels.filter((p) => p.side === 'left').sort((a, b) => a.order - b.order)
      expect(left.map((p) => p.id)).toEqual(['iconLibrary', 'hierarchy'])
      // the right side (inspector) is untouched
      expect(store.panels.find((p) => p.id === 'inspector')?.order).toBe(2)
    })

    it('is a no-op for an unknown id or the same index', () => {
      const store = usePanelsStore()
      const before = store.panels.map((p) => ({ ...p }))
      // @ts-expect-error testing an invalid id is safely ignored
      store.reorderPanel('does-not-exist', 0)
      store.reorderPanel('hierarchy', 0) // already at index 0
      expect(store.panels).toEqual(before)
    })

    it('persists the new order', () => {
      const store = usePanelsStore()
      store.reorderPanel('iconLibrary', 0)
      store.$flushPersist()
      expect(savedPanels().find((p) => p.id === 'iconLibrary')?.order).toBe(0)
    })
  })

  describe('resetLayout', () => {
    it('restores every panel to its registry defaults, and persists', () => {
      const store = usePanelsStore()
      store.remove('hierarchy')
      store.toggleCollapsed('inspector')
      store.reorderPanel('iconLibrary', 0)
      store.setSizes([{ id: 'hierarchy', size: 3 }])

      store.resetLayout()

      expect(store.panels.every((p) => !p.collapsed && p.visible && p.size === 1)).toBe(true)
      expect(store.panels.map((p) => p.id)).toEqual(PANEL_REGISTRY.map((e) => e.id))

      store.$flushPersist()
      expect(savedPanels().every((p) => !p.collapsed)).toBe(true)
    })
  })

  describe('persistence', () => {
    it('persists panel state to localStorage on mutation', () => {
      const store = usePanelsStore()
      store.toggleCollapsed('inspector')
      store.$flushPersist()
      expect(savedPanels().find((p) => p.id === 'inspector')?.collapsed).toBe(true)
    })

    it('loads saved state on store creation, merged over the registry defaults', () => {
      seedPanels([{ id: 'inspector', side: 'right', order: 0, collapsed: true, visible: false }])
      const store = usePanelsStore()
      expect(store.panels.find((p) => p.id === 'inspector')).toMatchObject({
        collapsed: true,
        visible: false,
      })
      // hierarchy/iconLibrary weren't in the saved blob, so they still fall back to defaults
      expect(store.panels.find((p) => p.id === 'hierarchy')).toMatchObject({
        collapsed: false,
        visible: true,
      })
    })

    it('ignores stale saved entries for panel ids no longer in the registry', () => {
      seedPanels([
        // @ts-expect-error a panel id that no longer exists in the registry
        { id: 'longRemovedPanel', side: 'left', order: 0, collapsed: true, visible: true },
      ])
      const store = usePanelsStore()
      expect(store.panels.map((p) => p.id)).toEqual(PANEL_REGISTRY.map((e) => e.id))
    })
  })
})
