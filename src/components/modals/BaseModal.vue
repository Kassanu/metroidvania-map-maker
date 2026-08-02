<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { useDialogEscTier } from '@/hotkeys/useDialogEscTier'
import { t } from '@/i18n'

// The shell every Dialog shares: overlay, centred surface, header with title
// and close button. The point is that useDialogEscTier is wired here, once.
// Forgetting it on a new dialog silently breaks Esc precedence (our dispatcher
// would let the same Escape fall through to a lower tier and also clear a
// selection or abort a gesture). It's exactly the kind of thing that gets
// forgotten.
withDefaults(
  defineProps<{
    // Screen-reader description; there's no visible duplicate.
    description: string
    title: string
    width?: string
  }>(),
  { width: '32rem' },
)

const open = defineModel<boolean>('open', { required: true })

useDialogEscTier(open)
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="modal-overlay" />
      <DialogContent class="modal-content" :style="{ '--modal-width': width }">
        <div class="modal-header">
          <DialogTitle class="modal-title">{{ title }}</DialogTitle>
          <DialogDescription class="visually-hidden">{{ description }}</DialogDescription>
          <DialogClose class="modal-close" :aria-label="t('common.close')">✕</DialogClose>
        </div>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
