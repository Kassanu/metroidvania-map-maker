<script setup lang="ts">
import IconPicker from './IconPicker.vue'
import { useArmedIconStore } from '@/stores/armedIcon'
import { useMarkupDefaultsStore } from '@/stores/markupDefaults'
import type { IconRegistryEntry } from '@/icons/registry'

// The docked half of the library: the same component the canvas opens as a
// popup, in a different home and without the focus grab.
//
// Picking here arms rather than places, which is the difference between the two
// homes. The popup was opened at a cell and so has somewhere to put an icon;
// this has none, so it sets up the clicks that follow.

const armedIcon = useArmedIconStore()
const markupDefaults = useMarkupDefaultsStore()

// Clicking the armed icon again disarms it, one of the three routes out.
// Arming loads the icon's own colours into the toolbar, so what the grid shows
// is what lands on the map until the user overrides a swatch.
function handlePick(entry: IconRegistryEntry) {
  armedIcon.toggle(entry.id)
  if (armedIcon.iconType === entry.id) markupDefaults.loadColors(entry.defaultColors)
}
</script>

<template>
  <IconPicker :armed-id="armedIcon.iconType" @pick="handlePick" />
</template>
