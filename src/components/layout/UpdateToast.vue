<script setup lang="ts">
// The offer to install a new build.
//
// A toast rather than a dialog, deliberately. Nothing is wrong and nothing
// needs answering: the update waits as long as it takes, and interrupting
// somebody mid-drag to say so would be worse than not mentioning it. It is
// also why the toast does not time out; a notice that vanishes before it is
// read is the same as no notice.
//
// Both buttons are plain, and neither closes the toast. Reka's own Action and
// Close do, and the close arrives as a dismissal alongside the choice:
// measured, Reload emits `install then dismiss`. Since installing has to ask
// about unsaved work first, refusing that question would leave the update
// still waiting and the offer already gone for the session. The store owns
// whether there is an offer; a click only says which one was picked.

import { ToastDescription, ToastProvider, ToastRoot, ToastTitle, ToastViewport } from 'reka-ui'
import { t } from '@/i18n'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ install: []; dismiss: [] }>()

function onOpenChange(open: boolean) {
  if (!open) emit('dismiss')
}
</script>

<template>
  <ToastProvider>
    <ToastRoot
      class="update-toast"
      :open="open"
      :duration="Number.POSITIVE_INFINITY"
      @update:open="onOpenChange"
    >
      <ToastTitle class="update-title">{{ t('update.title') }}</ToastTitle>
      <ToastDescription class="update-body">{{ t('update.body') }}</ToastDescription>
      <div class="update-actions">
        <button type="button" class="update-later" @click="emit('dismiss')">
          {{ t('update.later') }}
        </button>
        <button type="button" class="update-reload" @click="emit('install')">
          {{ t('update.reload') }}
        </button>
      </div>
    </ToastRoot>
    <ToastViewport class="update-viewport" />
  </ToastProvider>
</template>

<style scoped>
/* Bottom trailing corner, clear of the tab bar, and above the canvas without
   covering the tools. */
.update-viewport {
  position: fixed;
  bottom: 3.5rem;
  right: 1rem;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(22rem, calc(100vw - 2rem));
  margin: 0;
  padding: 0;
  list-style: none;
  outline: none;
}

.update-toast {
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--surface);
  color: var(--fg);
  padding: 0.75rem;
  box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 0.35);
}

.update-title {
  font-size: 0.875rem;
  font-weight: 700;
  margin: 0 0 0.25rem;
}

.update-body {
  font-size: 0.8125rem;
  opacity: 0.8;
  margin: 0 0 0.75rem;
}

.update-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.update-later,
.update-reload {
  border-radius: 0.25rem;
  padding: 0.3125rem 0.625rem;
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

.update-later {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--fg);
}
.update-later:hover {
  background: var(--surface-active);
}

.update-reload {
  border: none;
  background: var(--accent);
  color: #fff;
}
.update-reload:hover {
  filter: brightness(1.1);
}
</style>
