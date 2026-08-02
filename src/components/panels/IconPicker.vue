<script setup lang="ts">
import { onMounted, ref } from 'vue'
import IconBadge from './IconBadge.vue'
import { useIconCatalog } from '@/composables/useIconCatalog'
import { startPointerDrag } from '@/composables/pointerDrag'
import { dropIconAt } from '@/gestures/iconDropTarget'
import { DRAG_DEAD_ZONE } from '@/config/constants'
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

// Whether the press that is ending became a drag. Read by the click handler,
// which fires afterwards: a drag onto the canvas must not also arm the icon it
// was dragged from.
//
// Reset on every press rather than after the click, because a drag that ends
// off the button produces no click at all: the synthetic one is dispatched to
// the common ancestor of press and release, which by then is not this button.
let dragged = false

// Pointer events rather than HTML5 drag-and-drop: see `iconDropTarget.ts` for
// why.
//
// Capture is taken at press, not deferred. The drag primitive listens on the
// element the press began on, and this drag leaves that element immediately by
// definition: without capture the pointer stops reporting to the button the
// moment it crosses onto the canvas, so the dead zone is never passed and no
// drag ever starts. Deferring is right for a drag that stays near its handle,
// which every other caller is.
//
// Capturing does not cost the click, because press and release share this
// element once it is capturing, so `click` still fires here and the flag above
// is what keeps a drag from also arming.
function startDrag(event: PointerEvent, entry: IconRegistryEntry) {
  if (event.button !== 0) return
  dragged = false
  startPointerDrag(event, {
    deadZone: DRAG_DEAD_ZONE,
    onStart: () => {
      dragged = true
    },
    onEnd: (context) => {
      if (!context.dragged) return
      dropIconAt({ clientX: context.event.clientX, clientY: context.event.clientY }, entry)
    },
  })
}

// Still the pick route for a plain click, and the only route the keyboard has:
// `Enter` and `Space` on a focused option raise `click` with no pointer events
// at all.
function handleClick(entry: IconRegistryEntry) {
  if (dragged) {
    dragged = false
    return
  }
  emit('pick', entry)
}
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
          @pointerdown="startDrag($event, entry)"
          @click="handleClick(entry)"
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
