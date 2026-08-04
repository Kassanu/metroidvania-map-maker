<script setup lang="ts">
// The glyph in front of a tree row, one per kind of thing the tree can list.
//
// Separate from `icons/registry.ts`, which is the map's icon catalogue: those
// ids are the save-file format and those glyphs are drawn to canvas. These are
// chrome, drawn as inline SVG in the DOM, and adding a kind here costs one
// entry and no migration.
//
// Paths are in a 16x16 viewBox and inherit the row's colour, so a selected row
// tints its icon with its text rather than needing a second palette.

export type TreeIconKind = 'area' | 'room'

const PATHS: Record<TreeIconKind, string> = {
  // A folder: an area groups rooms and is not a thing on the map of its own.
  // Deliberately not a bracket pair, which reads as a control beside the twisty.
  area: 'M2 13.5V3.5h4l1.5 2h6.5v8z',
  // A room is its cells, so a plain outlined box.
  room: 'M2.5 3.5h11v9h-11z',
}

defineProps<{ kind: TreeIconKind }>()
</script>

<template>
  <svg
    class="tree-icon"
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="1.25"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="PATHS[kind]" />
  </svg>
</template>

<style scoped>
.tree-icon {
  flex: none;
  opacity: 0.85;
}
</style>
