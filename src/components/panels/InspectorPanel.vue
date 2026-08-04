<script setup lang="ts">
import { computed } from 'vue'
import RoomInspector from './inspectors/RoomInspector.vue'
import { useSelectionStore } from '@/stores/selection'
import { useTabsStore } from '@/stores/tabs'
import { t } from '@/i18n'
import type { ObjectRef } from '@/core/types'

// What the selection is, in editable form. Four states, decided in one place:
// nothing, a count of cells, one object, or a count of objects.
//
// The order of those tests is load-bearing. Cells are counted before the
// single-object case, because a cell has no editable field at any count: it
// names a position rather than a thing, so "1 cell selected" is the honest
// answer where a panel of fields would be an empty promise.
//
// A kind with no arm in `binding` renders nothing rather than a stub.

const selection = useSelectionStore()
const tabsStore = useTabsStore()

// A selection belongs to the tab it was made on, so one left on another tab is
// invisible here for the same reason it is invisible to that tab's keys and
// menus.
const items = computed<readonly ObjectRef[]>(() =>
  selection.mapId === tabsStore.activeTabId ? selection.selected : [],
)

const cellCount = computed(() => {
  const all = items.value
  if (all.length === 0) return 0
  return all.every((ref) => ref.kind === 'cell') ? all.length : 0
})

const single = computed<ObjectRef | null>(() =>
  cellCount.value === 0 && items.value.length === 1 ? items.value[0] : null,
)

// Each kind names its own component and its own props, rather than a shared
// prop shape every future inspector would have to accept.
const binding = computed(() => {
  const ref = single.value
  if (!ref) return null
  switch (ref.kind) {
    case 'room':
      return {
        key: `${ref.kind}:${ref.id}`,
        is: RoomInspector,
        props: { mapId: tabsStore.activeTabId, roomId: ref.id },
      }
    default:
      return null
  }
})

const cellSummary = computed(() =>
  cellCount.value === 1
    ? t('inspector.cellSelected')
    : t('inspector.cellsSelected', { n: cellCount.value }),
)
</script>

<template>
  <p v-if="cellCount > 0" class="inspector-summary">{{ cellSummary }}</p>

  <!-- Keyed by the ref, so switching from one room to another remounts rather
       than reusing a panel whose fields may hold a half-typed draft. -->
  <component :is="binding.is" v-else-if="binding" :key="binding.key" v-bind="binding.props" />

  <p v-else-if="items.length > 1" class="inspector-summary">
    {{ t('inspector.selected', { n: items.length }) }}
  </p>
</template>

<style scoped>
.inspector-summary {
  color: var(--fg);
  opacity: 0.7;
  font-size: 0.8125rem;
  margin: 0;
}
</style>
