import type { Component } from 'vue'
import type { Mode } from '@/stores/mode'
import type { MessageKey } from '@/i18n'
import HierarchyPanel from '@/components/panels/HierarchyPanel.vue'
import IconLibraryPanel from '@/components/panels/IconLibraryPanel.vue'
import InspectorPanel from '@/components/panels/InspectorPanel.vue'

// Panel identity, in one place: id, title, where it starts, which mode (if
// any) gates it, and what renders it. The sidebar and the View menu both
// iterate this, so adding a panel type means adding one entry here and
// nothing else.
//
// Lives outside stores/ by design: this is configuration, not reactive
// state. It names components, which a store should not import. The panels
// store holds the per-panel state (collapsed, order, size) keyed by these ids.

export type PanelId = 'hierarchy' | 'iconLibrary' | 'inspector'
export type SidebarSide = 'left' | 'right'

export interface PanelRegistryEntry {
  id: PanelId
  titleKey: MessageKey
  defaultSide: SidebarSide
  component: Component
  mode?: Mode // present only for panels gated to one mode (e.g. Icon Library → Markup)
}

export const PANEL_REGISTRY: PanelRegistryEntry[] = [
  {
    id: 'hierarchy',
    titleKey: 'panel.hierarchy',
    defaultSide: 'left',
    component: HierarchyPanel,
  },
  {
    id: 'iconLibrary',
    titleKey: 'panel.iconLibrary',
    defaultSide: 'left',
    mode: 'markup',
    component: IconLibraryPanel,
  },
  {
    id: 'inspector',
    titleKey: 'panel.inspector',
    defaultSide: 'right',
    component: InspectorPanel,
  },
]

export function getRegistryEntry(id: PanelId): PanelRegistryEntry {
  return PANEL_REGISTRY.find((entry) => entry.id === id)!
}
