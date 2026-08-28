<script setup lang="ts">
import { computed } from 'vue'
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
const props = withDefaults(
  defineProps<{
    // Screen-reader description; there's no visible duplicate.
    description: string
    title: string
    width?: string
    // False while the dialog is doing something that closing would abandon: an
    // export mid-write, where the bytes are already on their way and there is
    // no cancel. Every route out is refused together, since Esc, the overlay
    // and the close button are one decision and a dialog that Esc dismisses
    // while its button is disabled is worse than one that refuses both.
    closable?: boolean
  }>(),
  { width: '32rem', closable: true },
)

const open = defineModel<boolean>('open', { required: true })

// The one gate every route out passes through. Reka closes by writing the
// model, so refusing here covers the ones that never reach a handler of ours.
const shown = computed({
  get: () => open.value,
  set: (next: boolean) => {
    if (!next && !props.closable) return
    open.value = next
  },
})

useDialogEscTier(shown)
</script>

<template>
  <DialogRoot v-model:open="shown">
    <DialogPortal>
      <DialogOverlay class="modal-overlay" />
      <DialogContent class="modal-content" :style="{ '--modal-width': width }">
        <div class="modal-header">
          <DialogTitle class="modal-title">{{ title }}</DialogTitle>
          <DialogDescription class="visually-hidden">{{ description }}</DialogDescription>
          <DialogClose class="modal-close" :disabled="!closable" :aria-label="t('common.close')">
            ✕
          </DialogClose>
        </div>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
