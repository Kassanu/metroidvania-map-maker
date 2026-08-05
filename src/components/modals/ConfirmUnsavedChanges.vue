<script setup lang="ts">
// The question asked before a project is replaced, wherever the replacement
// was started. New and Open both land here, so the two cannot come to describe
// the same loss differently.
//
// Three ways out rather than two, which is the desktop convention and the one
// people already know: Save writes and then continues, Don't Save continues
// without writing, Cancel abandons the whole operation.
//
// The choice is emitted rather than stored here. Reka closes the dialog before
// running the handler of the button that was picked, so state living in the
// open flag would be cleared a beat before anything could read it.

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
import type { UnsavedChoice } from '@/stores/file'

defineProps<{ open: boolean; name: string }>()
const emit = defineEmits<{ choose: [choice: UnsavedChoice] }>()

// Escape and the overlay both mean cancel, which is the safe answer: it is
// the only one of the three that loses nothing.
function onOpenChange(open: boolean) {
  if (!open) emit('choose', 'cancel')
}
</script>

<template>
  <AlertDialogRoot :open="open" @update:open="onOpenChange">
    <AlertDialogPortal>
      <AlertDialogOverlay class="modal-overlay" />
      <AlertDialogContent class="modal-content" style="--modal-width: 24rem">
        <AlertDialogTitle class="unsaved-title">
          {{ t('unsaved.title', { name }) }}
        </AlertDialogTitle>
        <AlertDialogDescription class="unsaved-body">
          {{ t('unsaved.body') }}
        </AlertDialogDescription>
        <div class="unsaved-actions">
          <button type="button" class="unsaved-discard" @click="emit('choose', 'discard')">
            {{ t('unsaved.discard') }}
          </button>
          <span class="unsaved-spacer" />
          <AlertDialogCancel class="unsaved-cancel" @click="emit('choose', 'cancel')">
            {{ t('common.cancel') }}
          </AlertDialogCancel>
          <AlertDialogAction class="unsaved-save" @click="emit('choose', 'save')">
            {{ t('unsaved.save') }}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<style scoped>
.unsaved-title {
  font-size: 1rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
}

.unsaved-body {
  font-size: 0.875rem;
  opacity: 0.8;
  margin: 0 0 1rem;
}

.unsaved-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* Pushes Cancel and Save to the trailing edge, leaving the destructive
   choice on its own at the other end where it will not be hit by reflex. */
.unsaved-spacer {
  flex: 1;
}

.unsaved-discard,
.unsaved-cancel,
.unsaved-save {
  border-radius: 0.25rem;
  padding: 0.375rem 0.75rem;
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}

.unsaved-discard,
.unsaved-cancel {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--fg);
}
.unsaved-discard:hover,
.unsaved-cancel:hover {
  background: var(--surface-active);
}

.unsaved-save {
  border: none;
  background: var(--accent);
  color: #fff;
}
.unsaved-save:hover {
  filter: brightness(1.1);
}
</style>
