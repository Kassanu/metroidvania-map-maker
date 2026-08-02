<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui'
import { useTabsStore } from '@/stores/tabs'
import { useDragReorder } from '@/composables/useDragReorder'
import { useOverflowScroll } from '@/composables/useOverflowScroll'
import { t } from '@/i18n'
import TabItem from './TabItem.vue'

const tabsStore = useTabsStore()

const tabList = ref<HTMLDivElement | null>(null)

const {
  isOverflowing,
  canScrollBack,
  canScrollForward,
  update: updateScrollState,
  scrollByPage,
} = useOverflowScroll(tabList)

// New tabs (and switching via the tab-menu dropdown) should scroll into
// view once they're off-screen, not just silently activate off to the side.
// flush: 'post' so this runs after the DOM update: a newly-added tab's
// element doesn't exist yet at the point activeTabId changes.
watch(
  () => tabsStore.activeTabId,
  (activeTabId) => {
    const el = tabList.value?.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  },
  { flush: 'post' },
)

onMounted(updateScrollState)

const activeTabName = computed(() => tabsStore.activeTab?.name ?? '')

// Drag-to-reorder via Pointer Events rather than HTML5 drag-and-drop: the
// whole app's input model runs on Pointer Events, and unlike HTML5 DnD it has
// a path to touch.
//
// Touch is not handled yet: a touch-drag here would currently fight the
// list's native scroll-to-pan. Disambiguating the two is deferred; fixing it
// in `useDragReorder` fixes it for both the tab bar and the sidebar's panel
// reorder at once.
const tabReorder = useDragReorder({
  container: tabList,
  axis: 'x',
  dataAttr: 'tab-id',
  order: () => tabsStore.tabs.map((tab) => tab.id),
  onReorder: (id, toIndex) => tabsStore.reorderTab(id, toIndex),
  shouldStart: (event) => !(event.target instanceof HTMLInputElement), // renaming, not a drag
})
</script>

<template>
  <div class="tab-bar">
    <button type="button" class="new-tab-button" :title="t('tabs.new')" @click="tabsStore.addTab()">
      +
    </button>

    <DropdownMenuRoot>
      <DropdownMenuTrigger
        class="tab-menu-button"
        :title="t('tabs.all')"
        :aria-label="t('tabs.allWithCurrent', { name: activeTabName })"
      >
        ☰
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent
          class="popover-surface scrollable tab-overview-content"
          style="--popover-min-width: 12rem"
          :side-offset="4"
          align="start"
        >
          <DropdownMenuItem
            v-for="tab in tabsStore.tabs"
            :key="tab.id"
            class="popover-item"
            :class="{ active: tab.id === tabsStore.activeTabId }"
            @select="tabsStore.activate(tab.id)"
          >
            {{ tab.name }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>

    <div
      ref="tabList"
      class="tab-list"
      role="tablist"
      :aria-label="t('tabs.list')"
      @scroll="updateScrollState"
      @pointerdown="tabReorder.onPointerDown"
      @click.capture="tabReorder.onClickCapture"
    >
      <TabItem v-for="tab in tabsStore.tabs" :key="tab.id" :tab="tab" />
    </div>

    <div v-if="isOverflowing" class="tab-scroll-buttons">
      <button
        type="button"
        class="tab-scroll-button"
        :title="t('tabs.scrollLeft')"
        :disabled="!canScrollBack"
        @click="scrollByPage(-1)"
      >
        &lt;
      </button>
      <button
        type="button"
        class="tab-scroll-button"
        :title="t('tabs.scrollRight')"
        :disabled="!canScrollForward"
        @click="scrollByPage(1)"
      >
        &gt;
      </button>
    </div>
  </div>
</template>

<style scoped>
.tab-bar {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background: var(--surface);
  border-top: 1px solid var(--border);
  min-width: 0;
}

.new-tab-button,
.tab-menu-button,
.tab-scroll-button {
  flex: none;
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  border-radius: 0.25rem;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
}
.new-tab-button:hover,
.tab-menu-button:hover,
.tab-scroll-button:hover:not(:disabled) {
  background: var(--surface-active);
}
.tab-scroll-button:disabled {
  opacity: 0.35;
  cursor: default;
}

.tab-list {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  overflow-x: auto;
  scrollbar-width: none;
  min-width: 0;
}
.tab-list::-webkit-scrollbar {
  display: none;
}

/* :deep(): .tab lives in TabItem.vue's template; this class is toggled
 * imperatively via classList inside useDragReorder, not as a Vue-bound
 * prop. */
:deep(.tab.dragging) {
  opacity: 0.5;
  cursor: grabbing;
}

.tab-scroll-buttons {
  flex: none;
  display: flex;
  gap: 0.125rem;
}
</style>
