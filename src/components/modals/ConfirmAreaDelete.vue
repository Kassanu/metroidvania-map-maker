<script setup lang="ts">
import { computed } from 'vue'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui'
import { t } from '@/i18n'

// The question asked before an area goes, wherever the delete was started: the
// tree's row menu and `Delete` on a selection both land here, so the two cannot
// come to describe the same operation differently.
//
// An area is asked about and a room is not because an area is project-wide: the
// rooms it moves to World can be on tabs the user is not looking at, and
// `rooms` counts them all.
//
// `alsoSelection` is set when the same keypress deletes other selected objects
// alongside the areas. It says so without tallying five kinds, which the dialog
// would state less clearly than the canvas already shows.

const props = defineProps<{
  open: boolean
  names: readonly string[]
  rooms: number
  alsoSelection?: boolean
}>()

const emit = defineEmits<{ 'update:open': [value: boolean]; confirm: [] }>()

const title = computed(() =>
  props.names.length === 1
    ? t('areaDelete.title', { name: props.names[0] })
    : t('areaDelete.titleMany', { count: props.names.length }),
)
</script>

<template>
  <AlertDialogRoot :open="open" @update:open="emit('update:open', $event)">
    <AlertDialogPortal>
      <AlertDialogOverlay class="modal-overlay" />
      <AlertDialogContent class="modal-content" style="--modal-width: 22rem">
        <AlertDialogTitle class="confirm-delete-title">{{ title }}</AlertDialogTitle>
        <AlertDialogDescription class="confirm-delete-description">
          <span>
            {{ rooms ? t('areaDelete.rooms', { count: rooms }) : t('areaDelete.empty') }}
          </span>
          <span v-if="alsoSelection">{{ t('areaDelete.alsoSelection') }}</span>
          <span class="confirm-delete-note">{{ t('tab.deleteUndoable') }}</span>
        </AlertDialogDescription>
        <div class="confirm-delete-actions">
          <AlertDialogCancel class="confirm-delete-cancel">
            {{ t('common.cancel') }}
          </AlertDialogCancel>
          <AlertDialogAction class="confirm-delete-confirm" @click="emit('confirm')">
            {{ t('common.delete') }}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<style scoped>
.confirm-delete-title {
  font-size: 1rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
}

.confirm-delete-description {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.875rem;
  opacity: 0.8;
  margin: 0 0 1rem;
}

.confirm-delete-note {
  opacity: 0.85;
}

.confirm-delete-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.confirm-delete-cancel,
.confirm-delete-confirm {
  border-radius: 0.25rem;
  padding: 0.375rem 0.75rem;
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}

.confirm-delete-cancel {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--fg);
}
.confirm-delete-cancel:hover {
  background: var(--surface-active);
}

.confirm-delete-confirm {
  border: none;
  background: #d64545;
  color: #fff;
}
.confirm-delete-confirm:hover {
  background: #b83a3a;
}
</style>
