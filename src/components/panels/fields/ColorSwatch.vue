<script setup lang="ts">
// A read-only colour, shown beside the control it describes.
//
// Read-only is the point rather than a limitation: colour lives on the area and
// applies to every room in it, so there is no per-room override to offer. The
// tooltip is what carries that, since a swatch with no control beside it
// otherwise reads as one that failed to load.

defineProps<{
  color: string
  title: string
}>()
</script>

<template>
  <span
    class="color-swatch"
    :style="{ background: color }"
    :title="title"
    role="img"
    :aria-label="title"
  />
</template>

<style scoped>
.color-swatch {
  flex: none;
  width: 1rem;
  height: 1rem;
  border-radius: 0.1875rem;
  border: 1px solid var(--border);
}
</style>
