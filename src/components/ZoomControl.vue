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
import { t } from '@/i18n'

const tabsStore = useTabsStore()

const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

type ZoomValue = number | 'fit' | 'selection'

function formatZoom(value: unknown) {
  return `${Math.round(Number(value) * 100)}%`
}

const zoomModel = computed<ZoomValue>({
  get: () => tabsStore.activeTab?.zoom ?? 1,
  set: (value) => {
    if (value === 'fit' || value === 'selection') {
      // TODO: the page bounds to fit against exist now (`activeTab.bounds`),
      // but the viewport size to fit them *into* lives in CanvasRegion and
      // there is no selection yet. Both arrive with the canvas work.
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
          <ComboboxItem class="popover-item" :value="1">{{ t('zoom.resetView') }}</ComboboxItem>
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
          <!-- Disabled until there's a data model / selection to fit against. -->
          <ComboboxItem class="popover-item" value="fit" disabled>{{
            t('zoom.fitWindow')
          }}</ComboboxItem>
          <ComboboxItem class="popover-item" value="selection" disabled>
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
