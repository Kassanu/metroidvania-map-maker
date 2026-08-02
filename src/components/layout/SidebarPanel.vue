<script setup lang="ts">
import { computed } from 'vue'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui'
import { usePanelsStore } from '@/stores/panels'
import type { PanelId } from '@/panels/registry'
import { t } from '@/i18n'

const props = defineProps<{ id: PanelId; title: string }>()

const panelsStore = usePanelsStore()
const panel = computed(() => panelsStore.panels.find((p) => p.id === props.id)!)

// Collapsed panels take only their header's natural height; expanded ones
// share the sidebar's remaining space by `size` weight (flex-grow), which
// SidebarContainer's resize handles adjust directly via the DOM.
const rootStyle = computed(() =>
  panel.value.collapsed ? { flex: 'none' } : { flex: `${panel.value.size} 1 0` },
)
</script>

<template>
  <section class="sidebar-panel" :data-panel-id="id" :style="rootStyle" :aria-label="title">
    <div class="panel-header">
      <button
        type="button"
        class="panel-collapse-button"
        :aria-expanded="!panel.collapsed"
        :title="panel.collapsed ? t('panel.expand') : t('panel.collapse')"
        @click="panelsStore.toggleCollapsed(id)"
      >
        {{ panel.collapsed ? '▸' : '▾' }}
      </button>
      <button type="button" class="panel-title" @click="panelsStore.toggleCollapsed(id)">
        {{ title }}
      </button>

      <DropdownMenuRoot>
        <DropdownMenuTrigger
          class="panel-menu-button"
          :title="t('panel.options')"
          :aria-label="t('panel.optionsFor', { title })"
        >
          ⋯
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            class="popover-surface panel-menu-content"
            :side-offset="4"
            align="end"
          >
            <DropdownMenuItem class="popover-item" @select="panelsStore.remove(id)">
              {{ t('panel.remove') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </div>
    <div v-if="!panel.collapsed" class="panel-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.sidebar-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-bottom: 1px solid var(--border);
}
.sidebar-panel:last-child {
  border-bottom: none;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.375rem;
}

.panel-collapse-button {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  border: none;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  border-radius: 0.25rem;
}
.panel-collapse-button:hover {
  background: var(--surface-active);
}

.panel-title {
  flex: 1;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--fg);
  font: inherit;
  font-weight: 600;
  font-size: 0.8125rem;
  cursor: pointer;
  padding: 0.125rem 0;
}

.panel-menu-button {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  border: none;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  border-radius: 0.25rem;
}
.panel-menu-button:hover {
  background: var(--surface-active);
}

.panel-body {
  flex: 1;
  min-height: 0;
  padding: 0.5rem;
  overflow: auto;
}
</style>
