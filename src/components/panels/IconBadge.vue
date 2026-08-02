<script setup lang="ts">
import { ICON_VIEWBOX, type IconArt } from '@/canvas/iconBadge'
import type { IconColors } from '@/core/ops/markup'

// A badge in the DOM, for the chrome. `canvas/iconBadge.ts` is the same badge
// on the map, and between them that is every way an icon is drawn: plate
// first, glyph over it, nothing else.
//
// SVG rather than a canvas per grid cell: a hundred canvases would each need a
// context, a ref and a redraw on every colour or theme change, and gain nothing
// over two paths the browser already scales.

withDefaults(defineProps<{ art: IconArt; colors: IconColors; size?: number }>(), { size: 28 })
</script>

<template>
  <svg
    class="icon-badge"
    :viewBox="`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`"
    :width="size"
    :height="size"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="art.plate" :fill="colors.plateColor" />
    <path :d="art.glyph" :fill="colors.glyphColor" />
  </svg>
</template>

<style scoped>
.icon-badge {
  display: block;
}
</style>
