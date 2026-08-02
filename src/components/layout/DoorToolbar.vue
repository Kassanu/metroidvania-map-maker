<script setup lang="ts">
import { computed } from 'vue'
import { useToolsStore } from '@/stores/tools'
import { useDoorDefaultsStore } from '@/stores/doorDefaults'
import { useModelStore, dependOn } from '@/stores/model'
import { OPEN_LOCK_ID } from '@/core/ids'
import type { LockTypeId } from '@/core/ids'
import { t } from '@/i18n'

// Door mode's half of the toolbar's dynamic (per-mode) section. This toggle is
// the only erase route on touch: right-click and the stylus eraser end are
// the other two, and touch has neither.
//
// A component per mode rather than a branch inside `Toolbar.vue`, following
// `DrawToolbar`: further Door mode controls belong next to this rather than
// inside a switch.
//
// Shares `tools.erase` with Draw mode deliberately: the flag means "the
// primary pointer erases", one intent carried between modes, while each mode
// decides for itself what erasing means, which is why the title below is
// Door's own.
const tools = useToolsStore()

// The creation strip. Every control here says what the next transition gets;
// none of them touches the selected one, which is why there is no readback in
// this file. Editing an existing transition is the Inspector's job.
const doorDefaults = useDoorDefaultsStore()
const model = useModelStore()

// Every lock type in the project, `Open` first because it is the default and the
// fallback. `dependOn` is the subscription to the plain-TS model: lock types are
// project structure, so adding or recolouring one moves `structureRev`.
//
// A fresh project seeds two: `Open` and a coloured `Locked`, so this picker
// has real content with no lock-type management UI built yet.
const lockTypes = computed(() => {
  dependOn(model.structureRev)
  const all = [...model.project.lockTypes.values()]
  return [
    ...all.filter((lock) => lock.id === OPEN_LOCK_ID),
    ...all.filter((lock) => lock.id !== OPEN_LOCK_ID),
  ]
})

// The swatch beside the picker, so a lock reads as the colour it will paint on
// the map. `Open` is permanently colourless: that is not a missing value but
// the whole point, and it shows here as the same neutral the canvas draws a
// colourless transition in.
const selectedColor = computed(
  () => model.project.lockTypes.get(doorDefaults.lockTypeId)?.color ?? 'var(--canvas-transition)',
)
</script>

<template>
  <div class="toolbar-group dynamic" role="group" :aria-label="t('toolbar.door.label')">
    <!-- A native select, like Draw mode's area picker and for the same reasons:
         one choice from a short list gets keyboard support, a real touch picker
         and screen-reader semantics for free. Lock types are created in the
         Hierarchy: this only picks from what exists, which is why there is no
         "New lock…" entry. -->
    <label class="lock-label" for="door-lock">{{ t('toolbar.lock.label') }}</label>
    <span class="lock-swatch" :style="{ background: selectedColor }" aria-hidden="true" />
    <select
      id="door-lock"
      class="lock-select"
      :title="t('toolbar.lock.title')"
      :value="doorDefaults.lockTypeId"
      @change="doorDefaults.selectLock(($event.target as HTMLSelectElement).value as LockTypeId)"
    >
      <option v-for="lock in lockTypes" :key="lock.id" :value="lock.id">{{ lock.name }}</option>
    </select>

    <span class="toolbar-divider" aria-hidden="true" />

    <!-- Two-way or one-way, not the Inspector's three-way selector: `B→A` means
         "swap the ends of a transition that has them", and at creation the ends
         do not exist yet, so the gesture decides which is A. The only direction
         a default can express is "one-way, the way I am about to draw it". -->
    <button
      type="button"
      class="toolbar-button one-way-button"
      :title="t('toolbar.oneWayTitle')"
      :aria-pressed="doorDefaults.oneWay"
      :class="{ active: doorDefaults.oneWay }"
      @click="doorDefaults.setOneWay(!doorDefaults.oneWay)"
    >
      {{ t('toolbar.oneWay') }}
    </button>

    <span class="toolbar-divider" aria-hidden="true" />

    <button
      type="button"
      class="toolbar-button erase-toggle-button"
      :title="t('toolbar.door.eraseTitle')"
      :aria-pressed="tools.erase"
      @click="tools.toggleErase()"
    >
      {{ t('toolbar.erase') }}
    </button>
  </div>
</template>

<style scoped>
/* Everything else is Toolbar.vue's :deep rules on .toolbar-button and
 * .toolbar-group, so these cannot drift away from Draw mode's. The picker and
 * swatch deliberately match the area picker's metrics for the same reason. */
.erase-toggle-button,
.one-way-button {
  font-size: 0.8125rem;
}
/* Pressed, not merely focused: `active` tracks aria-pressed, so the visual and
 * the accessible state cannot drift. */
.one-way-button.active {
  background: var(--accent-soft, var(--surface-raised));
  font-weight: 600;
}
.lock-label {
  font-size: 0.8125rem;
  opacity: 0.75;
}
.lock-swatch {
  width: 0.75rem;
  height: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.125rem;
}
.lock-select {
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
