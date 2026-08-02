<script setup lang="ts">
import { computed } from 'vue'
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui'
import IconPicker from '@/components/panels/IconPicker.vue'
import { useDialogEscTier } from '@/hotkeys/useDialogEscTier'
import { t } from '@/i18n'
import type { CellKey } from '@/core/cell'
import type { IconRegistryEntry } from '@/icons/registry'

// The library, opened at a map cell.
//
// The first chrome in the app anchored to a place on the map rather than to a
// control. The anchor is a zero-size element positioned over the canvas at the
// cell's screen point, so the popup needs no virtual-reference handling and
// tracks the anchor the way every other popover in the app does.
//
// It dismisses when the map moves under it rather than following: the caller
// closes it on pan, zoom and tab change. Following would mean a popup chasing
// the cell across the viewport and off the edge of it, still open and pointing
// at nothing on screen. Dismissing is also what makes the wheel unambiguous,
// since a wheel over the canvas zooms.

const props = defineProps<{ at: { x: number; y: number } | null; cell: CellKey | null }>()
const emit = defineEmits<{ pick: [entry: IconRegistryEntry]; close: [] }>()

const isOpen = computed({
  get: () => props.at !== null,
  set: (open) => {
    if (!open) emit('close')
  },
})

// Registers on the Esc stack's dialog tier while open, so one Escape closes
// this and does not also reach a selection below it.
useDialogEscTier(isOpen)
</script>

<template>
  <PopoverRoot v-model:open="isOpen">
    <PopoverAnchor
      class="icon-picker-anchor"
      :style="at ? { left: `${at.x}px`, top: `${at.y}px` } : undefined"
    />
    <PopoverPortal>
      <PopoverContent
        class="popover-surface icon-picker-popover"
        side="right"
        align="start"
        :side-offset="8"
        :collision-padding="8"
        :aria-label="t('iconPicker.atCell', { cell: cell ?? '' })"
        @open-auto-focus.prevent
      >
        <IconPicker autofocus @pick="(entry) => emit('pick', entry)" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style scoped>
/* Zero-size and inert: it exists only to give the popup somewhere to point. */
.icon-picker-anchor {
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
}

.icon-picker-popover {
  width: 15rem;
  padding: 0.5rem;
}
</style>
