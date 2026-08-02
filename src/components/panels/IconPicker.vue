<script setup lang="ts">
import { onMounted, ref } from 'vue'
import IconBadge from './IconBadge.vue'
import { useIconCatalog } from '@/composables/useIconCatalog'
import { PLATE_ROUNDED_SQUARE } from '@/canvas/iconBadge'
import { t } from '@/i18n'
import type { IconRegistryEntry } from '@/icons/registry'

// The icon library, and the only component that draws it. It has two homes: the
// docked panel and the popup the canvas opens at a cell. They differ in where
// they sit and whether they take focus, never in what they show.
//
// Icons render in their own canonical colours, so the grid says what will land
// on the map rather than showing a wall of one colour.

// `armedId` marks the icon whose next click places it. The popup never passes
// one: it places on pick and closes, so nothing there is ever left armed.
const props = withDefaults(defineProps<{ autofocus?: boolean; armedId?: string | null }>(), {
  autofocus: false,
  armedId: null,
})
const emit = defineEmits<{ pick: [entry: IconRegistryEntry] }>()

const { query, results } = useIconCatalog()
const search = ref<HTMLInputElement | null>(null)

// The popup is opened by a canvas gesture, so the pointer is nowhere near the
// search box: it takes focus on open, and typing narrows the grid immediately.
// The docked panel does not steal focus from whatever the user was doing.
onMounted(() => {
  if (props.autofocus) search.value?.focus()
})
</script>

<template>
  <div class="icon-picker">
    <input
      ref="search"
      v-model="query"
      type="search"
      class="icon-search"
      :placeholder="t('iconPicker.search')"
      :aria-label="t('iconPicker.search')"
    />
    <ul v-if="results.length > 0" class="icon-grid" :aria-label="t('panel.iconLibrary')">
      <li v-for="entry in results" :key="entry.id">
        <button
          type="button"
          class="icon-option"
          :class="{ armed: entry.id === props.armedId }"
          :aria-pressed="props.armedId === null ? undefined : entry.id === props.armedId"
          :title="entry.name"
          @click="emit('pick', entry)"
        >
          <IconBadge
            :art="{ plate: entry.plate ?? PLATE_ROUNDED_SQUARE, glyph: entry.glyph }"
            :colors="entry.defaultColors"
          />
          <span class="visually-hidden">{{ entry.name }}</span>
        </button>
      </li>
    </ul>
    <p v-else class="icon-empty">{{ t('iconPicker.empty', { query }) }}</p>
  </div>
</template>

<style scoped>
.icon-picker {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.icon-search {
  width: 100%;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  background: var(--surface);
  color: var(--fg);
  font-size: 0.8125rem;
}

/* Fills whatever width it is given, so the docked panel and the popup lay the
   same grid out at their own sizes. */
.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(2.25rem, 1fr));
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 16rem;
  overflow-y: auto;
}

.icon-option {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 0.25rem;
  border: 1px solid transparent;
  border-radius: 0.25rem;
  background: none;
  cursor: pointer;
}
.icon-option:hover {
  background: var(--surface-active);
}
.icon-option:focus-visible {
  border-color: var(--accent);
  outline: none;
}
/* Armed, not merely hovered: this icon is what the next click on the map
   places, and once the popup closes there is nothing else showing that. */
.icon-option.armed {
  border-color: var(--accent);
  background: var(--accent-soft, var(--surface-active));
}

.icon-empty {
  margin: 0;
  color: var(--fg);
  opacity: 0.6;
  font-size: 0.8125rem;
}
</style>
