<script setup lang="ts">
// The checkbox tree an export dialog picks its scope with.
//
// Rendered as flat rows carrying `aria-level`, the way the Hierarchy is, since
// a tree is a list of visible rows to everything that reads it. The tri-state
// arithmetic lives in `scopeTree.ts` rather than here, and the depth comes from
// the tree itself: a tab whose `areas` is null is the leaf.
//
// A disabled node is unticked and cannot be ticked. Emptiness is read off the
// node rather than recomputed here, so the row that draws disabled and the tick
// policy that skips it cannot come to disagree.

import { computed } from 'vue'
import { CheckboxIndicator, CheckboxRoot } from 'reka-ui'
import { stateOf, toggle } from '@/export/scopeTree'
import type { CheckedState, LeafId, ScopeNode, ScopeTab } from '@/export/scopeTree'

const props = defineProps<{
  tree: ScopeTab[]
  // Read-only: every update goes back out as a new set, because a set mutated
  // in place is the same object the parent already holds and nothing rerenders.
  selected: ReadonlySet<LeafId>
  label: string
  // What an empty tab's row says. What makes a tab empty is the caller's, so
  // how to say it is too.
  emptyNote: string
}>()

const emit = defineEmits<{ 'update:selected': [Set<LeafId>] }>()

// One flat list of rows rather than nested lists, each carrying the level it
// sits at. `key` is unique per row: a room id alone would collide with nothing,
// but an area id repeats across tabs.
interface Row {
  key: string
  level: 1 | 2 | 3
  label: string
  node: ScopeNode
  empty: boolean
}

const rows = computed<Row[]>(() => {
  const out: Row[] = []
  for (const tab of props.tree) {
    out.push({ key: tab.id, level: 1, label: tab.label, node: tab, empty: tab.empty })
    for (const area of tab.areas ?? []) {
      out.push({
        key: `${tab.id}/${area.id}`,
        level: 2,
        label: area.label,
        node: area,
        empty: false,
      })
      for (const room of area.rooms) {
        out.push({ key: room.id, level: 3, label: room.label, node: room, empty: false })
      }
    }
  }
  return out
})

function stateFor(node: ScopeNode): CheckedState {
  return stateOf(node, props.selected)
}

// Reka hands back the state it is moving to, which for a box currently
// indeterminate is `true`: ticking a partly-filled area fills it.
function onCheckedChange(node: ScopeNode, next: CheckedState): void {
  emit('update:selected', toggle(node, props.selected, next === true))
}
</script>

<template>
  <div class="scope-tree" role="tree" :aria-label="label">
    <div
      v-for="row in rows"
      :key="row.key"
      class="scope-row"
      role="treeitem"
      :aria-level="row.level"
      :aria-selected="stateFor(row.node) === true"
      :data-row-kind="row.node.kind"
      :data-row-id="row.node.id"
      :style="{ '--row-level': row.level }"
    >
      <CheckboxRoot
        class="scope-check"
        :aria-label="row.label"
        :model-value="stateFor(row.node)"
        :disabled="row.empty"
        @update:model-value="onCheckedChange(row.node, $event)"
      >
        <CheckboxIndicator class="scope-check-mark">
          {{ stateFor(row.node) === 'indeterminate' ? '–' : '✓' }}
        </CheckboxIndicator>
      </CheckboxRoot>
      <span class="scope-label">{{ row.label }}</span>
      <span v-if="row.empty" class="scope-note">{{ emptyNote }}</span>
    </div>
  </div>
</template>

<style scoped>
.scope-tree {
  max-height: 16rem;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  padding: 0.25rem;
}

.scope-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  /* Each level indents by one step; the checkbox column stays aligned with it
     so the three levels read as a tree without nested containers. */
  padding-left: calc((var(--row-level) - 1) * 1.25rem);
  min-height: 1.75rem;
}

.scope-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  flex: none;
  border: 1px solid var(--border);
  border-radius: 0.1875rem;
  background: var(--bg);
  color: var(--fg);
  cursor: pointer;
}

.scope-check[data-disabled] {
  opacity: 0.4;
  cursor: default;
}

.scope-check-mark {
  font-size: 0.75rem;
  line-height: 1;
}

.scope-label {
  font-size: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scope-note {
  font-size: 0.75rem;
  opacity: 0.7;
  margin: 0;
}
</style>
