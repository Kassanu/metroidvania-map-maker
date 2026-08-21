<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxViewport,
} from 'reka-ui'
import { useTabsStore } from '@/stores/tabs'
import { useSelectionStore } from '@/stores/selection'
import { t } from '@/i18n'

const tabsStore = useTabsStore()
const selection = useSelectionStore()

const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

// Disabled rather than a no-op: an enabled item that declines is worse than
// one that says it cannot act. The selection is per-tab, so one belonging to
// another tab frames nothing here and reads as empty.
const nothingSelected = computed(() => selection.refsOn(tabsStore.activeTabId).length === 0)

// The commands share the zoom's model because they share its control. Only a
// number is ever read back out: `get` answers the current zoom, so the field
// shows a percentage whichever item was picked.
type ZoomValue = number | 'reset' | 'fit' | 'selection'

function formatZoom(value: unknown) {
  return `${Math.round(Number(value) * 100)}%`
}

const zoomModel = computed<ZoomValue>({
  get: () => tabsStore.activeTab?.zoom ?? 1,
  set: (value) => {
    // Not `setZoom(1)`: this puts the tab back where it opened, which is what
    // resets a view rather than just its scale. `mod+0` stays zoom-only on
    // purpose, so the two are separate commands with separate names.
    if (value === 'reset') {
      tabsStore.resetView(tabsStore.activeTabId)
      return
    }
    if (value === 'fit') {
      tabsStore.fitToContent(tabsStore.activeTabId)
      return
    }
    if (value === 'selection') {
      tabsStore.fitToSelection(tabsStore.activeTabId, selection.refsOn(tabsStore.activeTabId))
      return
    }
    tabsStore.setZoom(tabsStore.activeTabId, value)
  },
})

function parseZoomPercent(text: string): number | null {
  const normalized = text
    .trim()
    .replace(/,/g, '.')
    .replace(/[^\d.]/g, '')
  const percent = parseFloat(normalized)
  if (!Number.isFinite(percent) || percent <= 0) return null
  return percent / 100
}

function commitZoomFromText(text: string) {
  const zoom = parseZoomPercent(text)
  if (zoom !== null) tabsStore.setZoom(tabsStore.activeTabId, zoom)
}

function zoomIn() {
  tabsStore.zoomIn(tabsStore.activeTabId)
}

function zoomOut() {
  tabsStore.zoomOut(tabsStore.activeTabId)
}

// Reka's Combobox unconditionally selects whatever item is "highlighted" on
// Enter (see ListboxRoot's onKeydownEnter). There's no prop to disable this.
// With `ignoreFilter`, that highlight doesn't track what's typed, so it can be
// stale (e.g. still "100%" from when the popup opened). We only want the typed
// text to win when the user actually edited the field and never arrow-navigated
// afterward (navigating means they want the highlighted item, not their earlier
// typing). hasNavigated/isEditingText tell those cases apart. The commit is
// deferred a microtask so it always lands after whatever synchronous selection
// Reka's own handler made in the same keydown dispatch, regardless of which of
// the two same-element listeners fires first (they're merged into one native
// listener, so we can't rely on order).
const isEditingText = ref(false)
const hasNavigated = ref(false)

function handleOpenChange(open: boolean) {
  if (open) {
    isEditingText.value = false
    hasNavigated.value = false
  }
}

function handleInputInput() {
  isEditingText.value = true
}

function commitIfEditing(text: string) {
  if (hasNavigated.value || !isEditingText.value) return
  isEditingText.value = false
  queueMicrotask(() => commitZoomFromText(text))
}

function handleInputKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    hasNavigated.value = true
    return
  }
  if (event.key !== 'Enter') return
  commitIfEditing((event.target as HTMLInputElement).value)
}

function handleInputBlur(event: FocusEvent) {
  commitIfEditing((event.target as HTMLInputElement).value)
}
</script>

<template>
  <ComboboxRoot
    v-model="zoomModel"
    class="zoom-control"
    ignore-filter
    open-on-focus
    open-on-click
    @update:open="handleOpenChange"
  >
    <ComboboxAnchor class="zoom-anchor">
      <ComboboxInput
        class="zoom-input"
        :aria-label="t('zoom.label')"
        :display-value="formatZoom"
        @input="handleInputInput"
        @keydown="handleInputKeydown"
        @blur="handleInputBlur"
      />
      <ComboboxTrigger class="zoom-trigger" :aria-label="t('zoom.options')">▾</ComboboxTrigger>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent
        class="popover-surface scrollable zoom-content"
        position="popper"
        :side-offset="4"
      >
        <ComboboxViewport class="zoom-viewport">
          <ComboboxItem class="popover-item" value="reset">{{ t('zoom.resetView') }}</ComboboxItem>
          <ComboboxSeparator class="popover-separator" />
          <ComboboxItem
            v-for="preset in ZOOM_PRESETS"
            :key="preset"
            class="popover-item"
            :value="preset"
          >
            {{ formatZoom(preset) }}
          </ComboboxItem>
          <ComboboxSeparator class="popover-separator" />
          <ComboboxItem class="popover-item" value="fit">{{ t('zoom.fitWindow') }}</ComboboxItem>
          <ComboboxItem class="popover-item" value="selection" :disabled="nothingSelected">
            {{ t('zoom.toSelection') }}
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
  <button type="button" class="toolbar-button" :title="t('zoom.in')" @click="zoomIn">+</button>
  <button type="button" class="toolbar-button" :title="t('zoom.out')" @click="zoomOut">−</button>
</template>

<style scoped>
.zoom-control {
  display: contents;
}

.zoom-anchor {
  display: flex;
  align-items: center;
  height: 2rem;
  border-radius: 0.375rem;
  background: transparent;
}
.zoom-anchor:hover {
  background: var(--surface-active);
}
.zoom-anchor:focus-within {
  background: var(--surface-active);
}

.zoom-input {
  width: 3.25rem;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--fg);
  font: inherit;
  text-align: right;
  padding: 0 0 0 0.5rem;
}
.zoom-input:focus {
  outline: none;
}

.zoom-trigger {
  height: 100%;
  padding: 0 0.375rem;
  border: none;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
}
</style>
