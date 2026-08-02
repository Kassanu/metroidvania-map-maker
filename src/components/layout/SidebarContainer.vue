<script setup lang="ts">
import { computed, ref } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useModeStore } from '@/stores/mode'
import { usePanelsStore } from '@/stores/panels'
import { getRegistryEntry, type PanelId, type SidebarSide } from '@/panels/registry'
import SidebarPanel from './SidebarPanel.vue'
import { redistribute } from '@/panels/resize'
import { startPointerDrag } from '@/composables/pointerDrag'
import { useDragReorder } from '@/composables/useDragReorder'
import { t } from '@/i18n'

const props = defineProps<{ side: SidebarSide }>()

const ui = useUiStore()
const mode = useModeStore()
const panelsStore = usePanelsStore()

const collapsed = computed(() =>
  props.side === 'left' ? ui.leftSidebarCollapsed : ui.rightSidebarCollapsed,
)
const width = computed(() => (props.side === 'left' ? ui.leftSidebarWidth : ui.rightSidebarWidth))

function toggleCollapsed() {
  if (props.side === 'left') ui.toggleLeftSidebar()
  else ui.toggleRightSidebar()
}

const ariaLabel = computed(() =>
  props.side === 'left' ? t('sidebar.primary') : t('sidebar.secondary'),
)

// '«'/'»' point whichever way expands the sidebar: mirrored per side.
const collapseIcon = computed(() => {
  if (props.side === 'left') return collapsed.value ? '»' : '«'
  return collapsed.value ? '«' : '»'
})

// Mode-gated panels (e.g. Icon Library → Markup) only render while that
// mode is active; removed (visible: false) panels are recoverable via the
// View menu, not shown here at all.
const visiblePanels = computed(() =>
  panelsStore.panels
    .filter((p) => p.side === props.side && p.visible)
    .filter((p) => {
      const panelMode = getRegistryEntry(p.id).mode
      return !panelMode || panelMode === mode.active
    })
    .sort((a, b) => a.order - b.order),
)

const panelList = ref<HTMLDivElement | null>(null)

// --- Outer sidebar width resize -------------------------------------------
// Live-updates ui's width state on every move; the persistence plugin's
// debounce collapses the drag into a single storage write on its own.
function handleWidthResizeStart(event: PointerEvent) {
  const startWidth = width.value

  startPointerDrag(event, {
    onMove: ({ dx }) => {
      // The right sidebar grows as the pointer moves left, so its handle
      // reads the delta mirrored.
      const delta = props.side === 'left' ? dx : -dx
      if (props.side === 'left') ui.setLeftSidebarWidth(startWidth + delta)
      else ui.setRightSidebarWidth(startWidth + delta)
    },
  })
}

// --- Inner panel-height resize ---------------------------------------------
// Only meaningful between two adjacent expanded panels: a collapsed panel's
// height is fixed by its header, not part of the flex-grow split.
function canResizeBetween(index: number): boolean {
  const a = visiblePanels.value[index]
  const b = visiblePanels.value[index + 1]
  return !!a && !!b && !a.collapsed && !b.collapsed
}

// Redistributes height only between the dragged pair: both panels' current
// pixel heights and flex-grow weights are captured at drag start, then a
// pixel delta is converted back to a proportional weight change, keeping
// every other panel's weight (and thus height) untouched. See panels.ts's
// `size` field.
function handlePanelResizeStart(event: PointerEvent, index: number) {
  const container = panelList.value
  if (!container) return
  const panelA = visiblePanels.value[index]
  const panelB = visiblePanels.value[index + 1]
  const elA = container.querySelector<HTMLElement>(`[data-panel-id="${panelA.id}"]`)
  const elB = container.querySelector<HTMLElement>(`[data-panel-id="${panelB.id}"]`)
  if (!elA || !elB) return

  const heightA0 = elA.getBoundingClientRect().height
  const heightB0 = elB.getBoundingClientRect().height
  const pairSizeSum = panelA.size + panelB.size

  startPointerDrag(event, {
    onMove: ({ dy }) => {
      const [sizeA, sizeB] = redistribute(heightA0, heightB0, pairSizeSum, dy)
      panelsStore.setSizes([
        { id: panelA.id, size: sizeA },
        { id: panelB.id, size: sizeB },
      ])
    },
  })
}

// --- Drag-to-reorder ---------------------------------------------------
// Vertical counterpart to the tab bar's reorder, same composable. Only a
// panel's header is a drag handle, so a press anywhere else (the body, the
// menu trigger) is left alone; capture is deferred so a plain press still
// reaches the header's own nested buttons.
const panelReorder = useDragReorder({
  container: panelList,
  axis: 'y',
  dataAttr: 'panel-id',
  order: () =>
    panelsStore.panels
      .filter((p) => p.side === props.side)
      .sort((a, b) => a.order - b.order)
      .map((p) => p.id),
  onReorder: (id, toIndex) => panelsStore.reorderPanel(id as PanelId, toIndex),
  deferCapture: true,
  shouldStart: (event) => {
    const target = event.target as HTMLElement
    if (target.closest('.panel-menu-button')) return false // menu trigger, not a drag
    return Boolean(target.closest('.panel-header'))
  },
})
</script>

<template>
  <aside
    class="sidebar"
    :class="[`side-${side}`, { collapsed }]"
    :style="!collapsed ? { width: `${width}px` } : undefined"
    :aria-label="ariaLabel"
  >
    <div class="sidebar-header">
      <button
        type="button"
        class="collapse-button"
        :aria-expanded="!collapsed"
        :title="t('sidebar.toggle')"
        @click="toggleCollapsed"
      >
        {{ collapseIcon }}
      </button>
    </div>
    <div v-if="!collapsed" class="sidebar-body">
      <div
        ref="panelList"
        class="panel-list"
        @pointerdown="panelReorder.onPointerDown"
        @click.capture="panelReorder.onClickCapture"
      >
        <template v-for="(p, index) in visiblePanels" :key="p.id">
          <SidebarPanel :id="p.id" :title="t(getRegistryEntry(p.id).titleKey)">
            <component :is="getRegistryEntry(p.id).component" />
          </SidebarPanel>
          <div
            v-if="index < visiblePanels.length - 1 && canResizeBetween(index)"
            class="panel-resize-handle"
            @pointerdown.stop="handlePanelResizeStart($event, index)"
          />
        </template>
      </div>
    </div>
    <div
      v-if="!collapsed"
      class="width-resize-handle"
      :title="t('sidebar.resize')"
      @pointerdown="handleWidthResizeStart"
    />
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative;
  width: 16rem;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  overflow: hidden;
}
.sidebar.side-left {
  border-right: 1px solid var(--border);
}
.sidebar.side-right {
  border-left: 1px solid var(--border);
}
.sidebar.collapsed {
  width: 2rem;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0.375rem 0.5rem;
  border-bottom: 1px solid var(--border);
}
.sidebar.side-left .sidebar-header {
  justify-content: flex-end;
}
.sidebar.side-right .sidebar-header {
  justify-content: flex-start;
}
.sidebar.collapsed .sidebar-header {
  justify-content: center;
}

.collapse-button {
  border: none;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
}
.collapse-button:hover {
  background: var(--surface-active);
}

.sidebar-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.panel-list {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

/* :deep(): SidebarPanel's root is styled by its own scoped CSS; this
 * imperatively-toggled class is applied directly via classList inside
 * useDragReorder, not as a Vue-bound prop (same pattern as TabBar's
 * .tab.dragging). */
:deep(.sidebar-panel.dragging) {
  opacity: 0.5;
}

.panel-resize-handle {
  flex: none;
  height: 4px;
  margin: -2px 0;
  cursor: row-resize;
  position: relative;
  z-index: var(--z-handle);
}
.panel-resize-handle:hover {
  background: var(--accent);
}

.width-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  z-index: var(--z-handle);
}
.sidebar.side-left .width-resize-handle {
  right: -2px;
}
.sidebar.side-right .width-resize-handle {
  left: -2px;
}
.width-resize-handle:hover {
  background: var(--accent);
}
</style>
