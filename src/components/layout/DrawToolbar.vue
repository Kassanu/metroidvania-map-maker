<script setup lang="ts">
import { useToolsStore } from '@/stores/tools'
import { useHotkeyAction } from '@/hotkeys/useHotkeyAction'
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from '@/canvas/brush'
import { computed } from 'vue'
import { useModelStore, dependOn } from '@/stores/model'
import { useDrawAreaStore } from '@/stores/drawArea'
import { WORLD_AREA_ID } from '@/core/ids'
import { t, type MessageKey } from '@/i18n'
import type { WallStyle } from '@/core/types'
import type { SubMode } from '@/gestures/subMode'
import type { AreaId } from '@/core/ids'

// Wall styles in order: plain, dotted, doorway. Each carries its message key
// literally to avoid compiling against the whole i18n catalogue.
const WALL_STYLES = [
  { style: 'solid', label: 'toolbar.wallStyle.solid' },
  { style: 'dotted', label: 'toolbar.wallStyle.dotted' },
  { style: 'doorway', label: 'toolbar.wallStyle.doorway' },
] as const satisfies readonly { style: WallStyle; label: MessageKey }[]

// Sub-modes: auto, cells, resize, vertex. Auto is the default. Literal keys
// like wall styles above.
const SUB_MODE_OPTIONS = [
  { mode: 'auto', label: 'toolbar.subMode.auto' },
  { mode: 'cells', label: 'toolbar.subMode.cells' },
  { mode: 'resize', label: 'toolbar.subMode.resize' },
  { mode: 'vertex', label: 'toolbar.subMode.vertex' },
] as const satisfies readonly { mode: SubMode; label: MessageKey }[]

// Draw mode's toolbar section: brush size, sub-mode lock, wall style, area
// dropdown, and erase. A component per mode rather than a growing switch in
// Toolbar.vue.
const tools = useToolsStore()
const model = useModelStore()
const drawArea = useDrawAreaStore()

// Every area in the project, World first because it is the default and the
// fallback. `dependOn` is how a computed subscribes to the plain-TS model:
// areas are project *structure*, so a recolour or a new area moves
// `structureRev` and nothing else.
const areas = computed(() => {
  dependOn(model.structureRev)
  const all = [...model.project.areas.values()]
  return [
    ...all.filter((area) => area.id === WORLD_AREA_ID),
    ...all.filter((area) => area.id !== WORLD_AREA_ID),
  ]
})

// The swatch beside the picker. The choice reads as a colour, not just a name.
// World has no colour of its own (`cellColor: null` means resolve from the
// active theme), and the same CSS variable the canvas uses gives the swatch the
// same answer in both themes.
const selectedFill = computed(
  () => model.project.areas.get(drawArea.areaId)?.cellColor ?? 'var(--canvas-room-fill)',
)

// `[` and `]` to adjust brush size. Registered here rather than globally
// because this component is mounted only while Draw mode is active.
useHotkeyAction('brushSizeDown', () => tools.shrinkBrush())
useHotkeyAction('brushSizeUp', () => tools.growBrush())
</script>

<template>
  <div class="toolbar-group dynamic" role="group" :aria-label="t('toolbar.draw.label')">
    <span class="brush-label">{{ t('toolbar.brush') }}</span>
    <button
      type="button"
      class="toolbar-button"
      :title="t('toolbar.brushSmaller')"
      :disabled="tools.brushSize <= MIN_BRUSH_SIZE"
      @click="tools.shrinkBrush()"
    >
      −
    </button>
    <!-- aria-live so a screen reader hears the size change from `[`/`]`, which
         otherwise moves nothing focusable. -->
    <span class="brush-size" aria-live="polite">{{
      t('toolbar.brushSize', { n: tools.brushSize })
    }}</span>
    <button
      type="button"
      class="toolbar-button"
      :title="t('toolbar.brushLarger')"
      :disabled="tools.brushSize >= MAX_BRUSH_SIZE"
      @click="tools.growBrush()"
    >
      +
    </button>

    <span class="toolbar-divider" aria-hidden="true" />

    <!-- The sub-mode lock. First in the section because it governs what every
         other control in it can do: under Resize-only the brush is inert. -->
    <span class="lock-label">{{ t('toolbar.lock') }}</span>
    <div
      class="sub-modes"
      role="radiogroup"
      :aria-label="t('toolbar.lock')"
      :title="t('toolbar.subModeTitle')"
    >
      <button
        v-for="option in SUB_MODE_OPTIONS"
        :key="option.mode"
        type="button"
        class="toolbar-button sub-mode-button"
        role="radio"
        :aria-checked="tools.subMode === option.mode"
        :class="{ active: tools.subMode === option.mode }"
        @click="tools.setSubMode(option.mode)"
      >
        {{ t(option.label) }}
      </button>
    </div>

    <span class="toolbar-divider" aria-hidden="true" />

    <!-- The three locked inner-wall styles, as a radio group rather than three
         toggles: exactly one is in effect, and a radio group is what tells a
         screen reader that without needing the pressed states kept in sync. -->
    <span class="wall-label">{{ t('toolbar.wall') }}</span>
    <div
      class="wall-styles"
      role="radiogroup"
      :aria-label="t('toolbar.wall')"
      :title="t('toolbar.wallStyleTitle')"
    >
      <button
        v-for="option in WALL_STYLES"
        :key="option.style"
        type="button"
        class="toolbar-button wall-style-button"
        role="radio"
        :aria-checked="tools.wallStyle === option.style"
        :class="{ active: tools.wallStyle === option.style }"
        @click="tools.setWallStyle(option.style)"
      >
        {{ t(option.label) }}
      </button>
    </div>

    <span class="toolbar-divider" aria-hidden="true" />

    <!-- A native select: one choice from a short list, so it gets keyboard
         support, a real touch picker and screen-reader semantics for free.
         Areas are created in the Hierarchy; this only picks from what exists,
         which is why there is no "New area..." entry. -->
    <label class="area-label" for="draw-area">{{ t('toolbar.area') }}</label>
    <span class="area-swatch" :style="{ background: selectedFill }" aria-hidden="true" />
    <select
      id="draw-area"
      class="area-select"
      :title="t('toolbar.areaTitle')"
      :value="drawArea.areaId"
      @change="drawArea.select(($event.target as HTMLSelectElement).value as AreaId)"
    >
      <option v-for="area in areas" :key="area.id" :value="area.id">{{ area.name }}</option>
    </select>

    <span class="toolbar-divider" aria-hidden="true" />

    <button
      type="button"
      class="toolbar-button erase-toggle-button"
      :title="t('toolbar.eraseTitle')"
      :aria-pressed="tools.erase"
      @click="tools.toggleErase()"
    >
      {{ t('toolbar.erase') }}
    </button>
  </div>
</template>

<style scoped>
/* Everything else is Toolbar.vue's :deep rules on .toolbar-button,
 * .toolbar-group and .toolbar-divider, so the controls in this bar cannot
 * drift away from the persistent ones beside them. */
.brush-label {
  font-size: 0.8125rem;
  opacity: 0.75;
}
.brush-size {
  min-width: 2.5ch;
  text-align: center;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}
.erase-toggle-button {
  font-size: 0.8125rem;
}
.wall-label {
  font-size: 0.8125rem;
  opacity: 0.75;
}
.wall-styles {
  display: flex;
  gap: 0.125rem;
}
.wall-style-button {
  font-size: 0.8125rem;
}
/* The selected style, not merely focused: `active` tracks aria-checked, so the
 * visual and the accessible state cannot drift. */
.wall-style-button.active,
.sub-mode-button.active {
  background: var(--accent-soft, var(--surface-raised));
  font-weight: 600;
}
.lock-label {
  font-size: 0.8125rem;
  opacity: 0.75;
}
.sub-modes {
  display: flex;
  gap: 0.125rem;
}
.sub-mode-button {
  font-size: 0.8125rem;
}
.area-label {
  font-size: 0.8125rem;
  opacity: 0.75;
}
.area-swatch {
  width: 0.75rem;
  height: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.125rem;
}
.area-select {
  font: inherit;
  font-size: 0.8125rem;
  max-width: 10rem;
  background: var(--surface);
  color: inherit;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  padding: 0.125rem 0.25rem;
}
</style>
