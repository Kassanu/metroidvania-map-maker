<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger,
} from 'reka-ui'
import { useTabsStore, type MapTab } from '@/stores/tabs'
import { dependOn, useModelStore } from '@/stores/model'
import { mapDeletionImpact } from '@/core/ops/maps'
import { useDialogEscTier } from '@/hotkeys/useDialogEscTier'
import { t } from '@/i18n'
import { useInlineEdit } from '@/composables/useInlineEdit'

const props = defineProps<{ tab: MapTab }>()

const tabsStore = useTabsStore()
const model = useModelStore()

const confirmingDelete = ref(false)

const {
  editing,
  draft,
  setInputRef,
  start: startRename,
  commit: commitRename,
  cancel: cancelRename,
} = useInlineEdit(
  () => props.tab.name,
  (name) => tabsStore.renameTab(props.tab.id, name),
)

// An AlertDialog rather than a Dialog (confirm semantics), so it can't go
// through BaseModal, but it still has to register on the Esc stack's dialog
// tier, or one Escape both closes it and falls through to whatever's below.
// Reka closes the dialog itself; this only tells our own dispatcher that a
// dialog is up.
useDialogEscTier(confirmingDelete)

// What the delete will actually destroy. A pre-action query, never something
// the op returns: the confirmation is asked ahead of the action, and
// `deleteMap` deliberately does not ask (see ops/maps.ts). Computed only while
// the dialog is open, since it walks every other map's transitions to find
// the ones pointing here, which is not work to do on every render of every
// tab.
const impact = computed(() => {
  if (!confirmingDelete.value) return null
  dependOn(model.rev)
  if (!model.project.mapsById.has(props.tab.id)) return null
  return mapDeletionImpact(model.project, props.tab.id)
})

// Only the non-zero ones. A list of four zeroes tells the user nothing and
// buries the line that matters.
const contents = computed(() => {
  const found = impact.value
  if (!found) return []
  return [
    { label: t('tab.deleteRooms'), count: found.rooms },
    { label: t('tab.deleteIcons'), count: found.icons },
    { label: t('tab.deleteLines'), count: found.lines },
    { label: t('tab.deleteTransitions'), count: found.transitions },
  ].filter((entry) => entry.count > 0)
})

function confirmDelete() {
  tabsStore.deleteTab(props.tab.id)
}
</script>

<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as="div" class="tab-trigger">
      <button
        v-if="!editing"
        type="button"
        role="tab"
        class="tab"
        :class="{ active: tab.id === tabsStore.activeTabId }"
        :aria-selected="tab.id === tabsStore.activeTabId"
        :data-tab-id="tab.id"
        @click="tabsStore.activate(tab.id)"
        @dblclick="startRename"
      >
        {{ tab.name }}
      </button>
      <input
        v-else
        :ref="setInputRef"
        v-model="draft"
        class="tab-rename-input"
        :data-tab-id="tab.id"
        @keydown.enter="commitRename"
        @keydown.esc="cancelRename"
        @blur="commitRename"
      />
    </ContextMenuTrigger>

    <ContextMenuPortal>
      <ContextMenuContent
        class="popover-surface tab-menu-content"
        style="--popover-min-width: 9rem"
      >
        <ContextMenuItem class="popover-item" @select="startRename">
          {{ t('tab.rename') }}
        </ContextMenuItem>
        <ContextMenuItem class="popover-item" @select="tabsStore.duplicateTab(tab.id)">
          {{ t('tab.duplicate') }}
        </ContextMenuItem>
        <ContextMenuItem class="popover-item" @select="confirmingDelete = true">
          {{ t('tab.delete') }}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>

  <AlertDialogRoot v-model:open="confirmingDelete">
    <AlertDialogPortal>
      <AlertDialogOverlay class="modal-overlay" />
      <AlertDialogContent class="modal-content" style="--modal-width: 24rem">
        <AlertDialogTitle class="tab-delete-title">
          {{ t('tab.deleteTitle', { name: tab.name }) }}
        </AlertDialogTitle>
        <AlertDialogDescription class="tab-delete-description">
          <span v-if="contents.length === 0" class="tab-delete-empty">
            {{ t('tab.deleteEmpty') }}
          </span>
          <ul v-else class="tab-delete-contents">
            <li v-for="entry in contents" :key="entry.label">
              {{ entry.label }}: {{ entry.count }}
            </li>
          </ul>

          <span v-if="impact?.incoming.length" class="tab-delete-incoming">
            {{ t('tab.deleteIncoming') }}
            <ul class="tab-delete-contents">
              <li v-for="source in impact.incoming" :key="source.mapId">
                {{
                  t('tab.deleteIncomingEntry', { name: source.mapName, count: source.teleports })
                }}
              </li>
            </ul>
          </span>

          <span v-if="impact?.replacesLastMap" class="tab-delete-note">
            {{ t('tab.deleteReplacesLast') }}
          </span>
          <span class="tab-delete-note">{{ t('tab.deleteUndoable') }}</span>
        </AlertDialogDescription>
        <div class="tab-delete-actions">
          <AlertDialogCancel class="tab-delete-cancel">{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction class="tab-delete-confirm" @click="confirmDelete">
            {{ t('tab.delete') }}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<style scoped>
.tab-trigger {
  display: contents;
}

.tab,
.tab-rename-input {
  flex: none;
  white-space: nowrap;
  border-radius: 0.25rem;
  padding: 0.25rem 0.75rem;
  font-family: inherit;
  font-size: 0.8125rem;
  line-height: 1.25rem;
}

.tab {
  border: none;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
}
.tab:hover {
  background: var(--surface-active);
}
.tab.active {
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
.tab.active:hover {
  background: var(--accent);
}

.tab-rename-input {
  font-weight: 600;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--accent);
}

.tab-delete-title {
  font-size: 1rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
}

.tab-delete-description {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.875rem;
  opacity: 0.8;
  margin: 0 0 1rem;
}

.tab-delete-contents {
  margin: 0;
  padding-left: 1.25rem;
}

.tab-delete-incoming {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.tab-delete-note {
  opacity: 0.85;
}

.tab-delete-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.tab-delete-cancel,
.tab-delete-confirm {
  border-radius: 0.25rem;
  padding: 0.375rem 0.75rem;
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}

.tab-delete-cancel {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--fg);
}
.tab-delete-cancel:hover {
  background: var(--surface-active);
}

.tab-delete-confirm {
  border: none;
  background: #d64545;
  color: #fff;
}
.tab-delete-confirm:hover {
  background: #b83a3a;
}
</style>
