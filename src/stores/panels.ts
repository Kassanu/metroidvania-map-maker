import { defineStore } from 'pinia'
import { PANEL_REGISTRY, type PanelId, type SidebarSide } from '@/panels/registry'

// Per-panel state only: what the user has done to each panel. Identity
// (title, default side, mode gate, component) lives in panels/registry.ts.
export type { PanelId, SidebarSide }

export interface PanelDef {
  id: PanelId
  side: SidebarSide
  order: number
  collapsed: boolean
  visible: boolean // false = removed; recoverable via the View menu checkbox
  size: number // flex-grow weight, shared among the expanded panels on the same side
}

function defaultPanels(): PanelDef[] {
  return PANEL_REGISTRY.map((entry, index) => ({
    id: entry.id,
    side: entry.defaultSide,
    order: index,
    collapsed: false,
    visible: true,
    size: 1,
  }))
}

// Merge saved prefs onto the registry's defaults so a panel type added,
// renamed, or removed later never leaves stale or missing state behind.
function mergeSaved(saved: PanelDef[]): PanelDef[] {
  const savedById = new Map(saved.map((p) => [p.id, p]))
  return defaultPanels().map((def) => ({ ...def, ...savedById.get(def.id) }))
}

export const usePanelsStore = defineStore('panels', {
  state: () => ({
    panels: defaultPanels(),
  }),
  getters: {
    isVisible: (state) => (id: PanelId) => state.panels.find((p) => p.id === id)?.visible ?? false,
  },
  actions: {
    toggleCollapsed(id: PanelId) {
      const panel = this.panels.find((p) => p.id === id)
      if (!panel) return
      panel.collapsed = !panel.collapsed
    },
    setVisible(id: PanelId, visible: boolean) {
      const panel = this.panels.find((p) => p.id === id)
      if (!panel) return
      panel.visible = visible
    },
    remove(id: PanelId) {
      this.setVisible(id, false)
    },
    // Live-updated during a resize drag. The persistence plugin's debounce
    // coalesces the drag's stream of writes into one, so there's no separate
    // commit-on-release call for the caller to make.
    setSizes(updates: { id: PanelId; size: number }[]) {
      for (const { id, size } of updates) {
        const panel = this.panels.find((p) => p.id === id)
        if (panel) panel.size = size
      }
    },
    // Moves the panel to `toIndex` among its own side's panels only.
    // `order` is a global field but is only ever compared within a side's
    // subset, so reassigning 0..n-1 here never touches the other side's
    // ordering. Same splice-then-reindex approach as tabs.reorderTab.
    reorderPanel(id: PanelId, toIndex: number) {
      const panel = this.panels.find((p) => p.id === id)
      if (!panel) return
      const sidePanels = this.panels
        .filter((p) => p.side === panel.side)
        .sort((a, b) => a.order - b.order)
      const fromIndex = sidePanels.findIndex((p) => p.id === id)
      if (fromIndex === -1 || fromIndex === toIndex) return
      const [moved] = sidePanels.splice(fromIndex, 1)
      sidePanels.splice(toIndex, 0, moved)
      sidePanels.forEach((p, i) => {
        p.order = i
      })
    },
    resetLayout() {
      this.panels = defaultPanels()
    },
  },
  persist: {
    key: 'panels',
    paths: ['panels'],
    // Saved entries merge onto the registry's defaults rather than replacing
    // the array wholesale, so a panel type added since the last save appears
    // and one removed since disappears.
    hydrate(saved, state) {
      state.panels = mergeSaved(saved.panels ?? [])
    },
  },
})
