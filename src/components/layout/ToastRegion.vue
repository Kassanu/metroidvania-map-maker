<script setup lang="ts">
// The one place toasts render.
//
// Mounted beside AppShell rather than inside it, so the viewport is never a
// child of the app grid. A fixed-position element that loses its positioning
// becomes an unplaced grid item and shoves every region, and keeping it out of
// the grid means no CSS regression can do that.
//
// Every class here is a global rule in style.css. ToastViewport and ToastRoot
// set `inheritAttrs: false` and re-bind $attrs onto an inner <Primitive>, so a
// scoped rule's data-v attribute and the class land on two different elements
// and the rule matches neither.
//
// The buttons are plain. Reka's ToastAction and ToastClose emit their close
// before the button's own handler runs, so an action with a question behind it
// loses the answer to a toast that has already gone. Whoever raised a toast
// owns closing it, through the handle notify() returned.

import { ToastDescription, ToastProvider, ToastRoot, ToastTitle, ToastViewport } from 'reka-ui'
import { dismissToast, durationOf, toasts } from '@/notify'
import { t } from '@/i18n'
</script>

<template>
  <ToastProvider>
    <ToastRoot
      v-for="toast in toasts"
      :key="toast.id"
      class="toast"
      :class="`toast-${toast.severity}`"
      :open="true"
      :duration="durationOf(toast)"
      :type="toast.severity === 'error' ? 'foreground' : 'background'"
      @update:open="(open: boolean) => !open && dismissToast(toast.id)"
    >
      <ToastTitle v-if="toast.titleKey" class="toast-title">{{ t(toast.titleKey) }}</ToastTitle>
      <ToastDescription class="toast-body">{{ t(toast.bodyKey, toast.params) }}</ToastDescription>
      <div v-if="toast.actions?.length" class="toast-actions">
        <button
          v-for="action in toast.actions"
          :key="action.labelKey"
          type="button"
          class="toast-action"
          :class="{ primary: action.primary }"
          @click="action.onClick()"
        >
          {{ t(action.labelKey) }}
        </button>
      </div>
      <!-- Excluded from the announcement: Reka builds the live region's text
           from the toast's own text content, and a spoken "✕" is noise. The
           action buttons stay in, because their labels are the offer. -->
      <button
        type="button"
        class="toast-close"
        data-reka-toast-announce-exclude
        :aria-label="t('common.close')"
        @click="dismissToast(toast.id)"
      >
        ✕
      </button>
    </ToastRoot>
    <ToastViewport class="toast-viewport" />
  </ToastProvider>
</template>
