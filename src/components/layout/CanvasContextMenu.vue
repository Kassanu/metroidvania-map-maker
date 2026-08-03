<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger,
} from 'reka-ui'
import { useSelectionStore } from '@/stores/selection'
import { useTabsStore } from '@/stores/tabs'
import { hasAction, runAction } from '@/hotkeys/actions'
import { useDialogEscTier } from '@/hotkeys/useDialogEscTier'
import { t, type MessageKey } from '@/i18n'
import type { ActionId } from '@/hotkeys/keymap'

// The canvas context menu: four verbs, all of them about the selection.
//
// Paste is not here even though the Edit menu has it. Every item in this menu
// acts on what was right-clicked; paste acts on the pointer, which is a
// different question and belongs where the whole document is in view.
//
// Wraps the trigger rather than sitting beside it, so the element that opens
// the menu stays the caller's: the canvas viewport is where the pointer, the
// cursor and the gestures all live, and it must not be moved inside a wrapper
// element that would sit between it and its layout box.

const props = defineProps<{ disabled: boolean }>()

const selection = useSelectionStore()
const tabsStore = useTabsStore()

// What the menu reports about itself, not what drives it: `ContextMenuRoot`
// owns its open state and only emits, so this follows and never leads.
const open = ref(false)
useDialogEscTier(open, false)

// `payload` items need something a clipboard can hold; the rest need only a
// selection to act on.
const ITEMS = [
  { action: 'cut', label: 'menu.edit.cut', payload: true },
  { action: 'copy', label: 'menu.edit.copy', payload: true },
  { action: 'duplicate', label: 'menu.edit.duplicate', payload: true },
  { action: 'deleteSelection', label: 'menu.edit.delete', payload: false },
] as const satisfies readonly { action: ActionId; label: MessageKey; payload: boolean }[]

const items = computed(() =>
  ITEMS.map((item) => ({
    ...item,
    // An id with no handler is disabled rather than silently inert. Read at
    // render rather than watched: handlers register once, when the feature that
    // owns them mounts, which is always before a menu can be opened.
    enabled:
      hasAction(item.action) &&
      (item.payload
        ? selection.hasCopyableOn(tabsStore.activeTabId)
        : !selection.isEmpty && selection.mapId === tabsStore.activeTabId),
  })),
)
</script>

<template>
  <ContextMenuRoot @update:open="open = $event">
    <ContextMenuTrigger as-child :disabled="props.disabled">
      <slot />
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent class="popover-surface" style="--popover-min-width: 9rem">
        <ContextMenuItem
          v-for="item in items"
          :key="item.action"
          class="popover-item"
          :disabled="!item.enabled"
          @select="runAction(item.action)"
        >
          {{ t(item.label) }}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
