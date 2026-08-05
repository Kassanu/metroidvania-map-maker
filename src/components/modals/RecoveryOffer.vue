<script setup lang="ts">
// The offer made at startup when a previous session left work behind.
//
// A list rather than a single question, because snapshots are per project and
// a crash can leave more than one. Each row is answered on its own: recovering
// takes that work back, discarding throws it away and is the only thing that
// stops it being offered again.
//
// No button closes the dialog. The store owns what is offered, so the list
// shortening is what closes it; Reka's own Action and Cancel emit their close
// before the button's handler, and the store would have cleared the row a beat
// before anything could read it.

import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui'
import { t } from '@/i18n'
import type { SnapshotInfo } from '@/storage'

defineProps<{ snapshots: SnapshotInfo[] }>()
const emit = defineEmits<{ recover: [key: string]; discard: [key: string]; dismiss: [] }>()

// Escape and the overlay are the only things left that close it, and both
// leave every snapshot where it is.
function onOpenChange(open: boolean) {
  if (!open) emit('dismiss')
}

// The absolute local time rather than "4 minutes ago". What a person needs of
// a snapshot is whether it is newer than what they have, and a relative phrase
// makes that a subtraction they have to do themselves.
function when(savedAt: number): string {
  return new Date(savedAt).toLocaleString()
}
</script>

<template>
  <AlertDialogRoot :open="snapshots.length > 0" @update:open="onOpenChange">
    <AlertDialogPortal>
      <AlertDialogOverlay class="modal-overlay" />
      <AlertDialogContent class="modal-content" style="--modal-width: 28rem">
        <AlertDialogTitle class="recovery-title">{{ t('recovery.title') }}</AlertDialogTitle>
        <AlertDialogDescription class="recovery-body">
          {{ t('recovery.body') }}
        </AlertDialogDescription>
        <ul class="recovery-list">
          <li v-for="snapshot in snapshots" :key="snapshot.key" class="recovery-row">
            <div class="recovery-what">
              <span class="recovery-name">{{ snapshot.projectName }}</span>
              <span class="recovery-where">
                {{
                  snapshot.fileName
                    ? t('recovery.from', { file: snapshot.fileName })
                    : t('recovery.noFile')
                }}
              </span>
              <span class="recovery-when">
                {{ t('recovery.savedAt', { when: when(snapshot.savedAt) }) }}
              </span>
            </div>
            <div class="recovery-row-actions">
              <button type="button" class="recovery-discard" @click="emit('discard', snapshot.key)">
                {{ t('recovery.discard') }}
              </button>
              <button type="button" class="recovery-recover" @click="emit('recover', snapshot.key)">
                {{ t('recovery.recover') }}
              </button>
            </div>
          </li>
        </ul>
        <div class="recovery-actions">
          <button type="button" class="recovery-dismiss" @click="emit('dismiss')">
            {{ t('recovery.dismiss') }}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<style scoped>
.recovery-title {
  font-size: 1rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
}

.recovery-body {
  font-size: 0.875rem;
  opacity: 0.8;
  margin: 0 0 0.75rem;
}

/* Bounded, since the store's own ceiling still allows several rows and the
   dismissal must stay reachable without scrolling the page. */
.recovery-list {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  max-height: 16rem;
  overflow-y: auto;
}

.recovery-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
  border-top: 1px solid var(--border);
}

.recovery-what {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.recovery-name {
  font-size: 0.875rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recovery-where,
.recovery-when {
  font-size: 0.75rem;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recovery-row-actions,
.recovery-actions {
  display: flex;
  gap: 0.5rem;
}

.recovery-actions {
  justify-content: flex-end;
}

.recovery-discard,
.recovery-dismiss,
.recovery-recover {
  border-radius: 0.25rem;
  padding: 0.375rem 0.75rem;
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
  white-space: nowrap;
}

.recovery-discard,
.recovery-dismiss {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--fg);
}
.recovery-discard:hover,
.recovery-dismiss:hover {
  background: var(--surface-active);
}

.recovery-recover {
  border: none;
  background: var(--accent);
  color: #fff;
}
.recovery-recover:hover {
  filter: brightness(1.1);
}
</style>
