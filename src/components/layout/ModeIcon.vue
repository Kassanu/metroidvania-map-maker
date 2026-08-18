<script setup lang="ts">
// The glyph on an activity-bar mode button, one per mode.
//
// Separate from `icons/registry.ts`, which is the map's icon catalogue: those
// ids are the save-file format and those glyphs are drawn to canvas. These are
// chrome, drawn as inline SVG in the DOM and filled with `currentColor`, so an
// active button tints its icon with its own text.
//
// Paths are in a 24x24 viewBox and list in paint order. The door needs two:
// its body is an outline with the panels cut out, and the knob is a solid dot
// sitting in one of those cut-outs.
import type { Mode } from '@/stores/mode'

const PATHS: Record<Mode, readonly string[]> = {
  // A house: a room is the thing this mode builds.
  draw: [
    'M12.71 2.29a.996.996 0 0 0-1.41 0l-8.01 8A1 1 0 0 0 3 11v9c0 1.1.9 2 2 2h4c.55 0 1-.45 1-1v-6h4v6c0 .55.45 1 1 1h4c1.1 0 2-.9 2-2v-9c0-.27-.11-.52-.29-.71zM16 20v-5c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v5H5v-8.59l7-7l7 7V20z',
  ],
  // A marquee, the gesture that picks objects out.
  select: [
    'M3 3h2v2H3zm0 4h2v2H3zm0 4h2v2H3zm0 4h2v2H3zm0 4h2v2H3zM7 3h2v2H7zm0 16h2v2H7zm4-16h2v2h-2zm0 16h2v2h-2zm4-16h2v2h-2zm0 16h2v2h-2zm4-16h2v2h-2zm0 4h2v2h-2zm0 4h2v2h-2zm0 4h2v2h-2zm0 4h2v2h-2z',
  ],
  // An open door, the transition this mode places.
  door: [
    'm20.2 4.02l-10-2a.99.99 0 0 0-.83.21C9.14 2.42 9 2.7 9 3v1H4c-.55 0-1 .45-1 1v14c0 .55.45 1 1 1h5v1c0 .3.13.58.37.77c.18.15.4.23.63.23c.07 0 .13 0 .2-.02l10-2c.47-.09.8-.5.8-.98V5c0-.48-.34-.89-.8-.98M5 18V6h4v12zm14 .18l-8 1.6V4.22l8 1.6z',
    'M13 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2',
  ],
  // A pen, for the icons and lines drawn over a map.
  markup: [
    'M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10s10-4.49 10-10S17.51 2 12 2M9 19.41v-4.15l1.87-3.27h2.27l1.87 3.27v4.15c-.93.38-1.94.59-3 .59s-2.07-.21-3-.59Zm8-1.18v-3.24c0-.17-.05-.34-.13-.5l-4-7c-.36-.62-1.38-.62-1.74 0l-4 7c-.09.15-.13.32-.13.5v3.24c-1.83-1.47-3-3.72-3-6.24c0-4.41 3.59-8 8-8s8 3.59 8 8c0 2.52-1.17 4.77-3 6.24',
  ],
}

defineProps<{ mode: Mode }>()
</script>

<template>
  <svg
    class="mode-icon"
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="d in PATHS[mode]" :key="d" :d="d" />
  </svg>
</template>

<style scoped>
.mode-icon {
  flex: none;
  display: block;
}
</style>
