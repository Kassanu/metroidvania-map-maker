<script setup lang="ts">
import IconPicker from './IconPicker.vue'

// The docked half of the library: the same component the canvas opens as a
// popup, in a different home and without the focus grab.
//
// Picking here places nothing yet. Placement from the panel is by arming an
// icon and then clicking cells, which is state that outlives the click.
</script>

<template>
  <IconPicker />
</template>
