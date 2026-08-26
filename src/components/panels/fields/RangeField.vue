<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from 'vue'

// A whole-percent value on a track, with the number beside it.
//
// A native range input, and that is not a styling preference: the hotkey
// dispatcher stands down for any native form control, so suppression of `Del`
// and `Ctrl+Z` comes free. A headless slider renders `role="slider"` on a span,
// which the predicate does not catch, and `Del` pressed while setting a room's
// water level would delete that room.
//
// The events say what happened to the pointer and nothing about what it means:
// whether a sample is a drag or a keypress is decided by whether a gesture is
// live, which is the driver's business. `change` is deliberately not among
// them. It fires on release only when the value changed, so a transaction hung
// off it is never closed by a click on the thumb.
//
// The draft is what `TextField` holds, for a reason that is particular here:
// nothing publishes mid-drag, so the value coming in cannot move while the
// pointer is down. Without a draft the thumb would be the only record of the
// drag, and a rollback would have nothing to put back.

const props = defineProps<{
  id: string
  label: string
  value: number
  // How the number reads beside the track. A function rather than a formatted
  // string, because the readout follows the drag: what it shows is the draft,
  // which only exists in here. Its width is reserved, so the track does not jog
  // as the digits change.
  format: (value: number) => string
}>()

const emit = defineEmits<{
  begin: []
  input: [value: number]
  end: []
  abort: []
  cancel: []
}>()

const draft = ref(0)
const dragging = ref(false)

const shown = computed(() => (dragging.value ? draft.value : props.value))

function handleDown() {
  dragging.value = true
  draft.value = props.value
  emit('begin')
}

// A keypress moves the thumb before anything is asked, and the value bound to
// it does not move when the driver declines to commit. Vue re-renders nothing
// in that case, since what it holds and what it would write are the same
// number, so the correction is made against the element once the model has
// answered. A press that did commit finds the thumb already there.
function handleInput(event: Event) {
  const el = event.target as HTMLInputElement
  const value = Number(el.value)

  if (dragging.value) {
    draft.value = value
    emit('input', value)
    return
  }

  emit('input', value)
  void nextTick(() => {
    el.value = String(shown.value)
  })
}

// Release, however it comes. Dropping the draft is what puts the thumb back on
// the model's value: after a commit that is where it already stands, and after
// a refused start or a cancelled drag it is the correction.
function settle(finish: 'end' | 'abort') {
  if (!dragging.value) return
  dragging.value = false
  if (finish === 'end') emit('end')
  else emit('abort')
}

// Escape reverts the drag but leaves the pointer down, so the release that
// follows must find nothing to end. The dispatcher never sees this press: it
// stands down for the whole element class before the precedence stack is
// reached.
function cancel() {
  if (!dragging.value) return
  dragging.value = false
  emit('cancel')
}

onUnmounted(() => settle('abort'))
</script>

<template>
  <div class="field">
    <label class="field-label" :for="id">{{ label }}</label>
    <div class="field-row">
      <input
        :id="id"
        class="field-range"
        type="range"
        min="0"
        max="100"
        step="1"
        :value="shown"
        @pointerdown="handleDown"
        @input="handleInput"
        @pointerup="settle('end')"
        @pointercancel="settle('abort')"
        @keydown.esc="cancel"
      />
      <output class="field-readout" :for="id">{{ format(shown) }}</output>
    </div>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 0.1875rem;
}

.field-label {
  font-size: 0.6875rem;
  font-weight: 600;
  opacity: 0.7;
  color: var(--fg);
}

.field-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
}

.field-range {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}
.field-range:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Wide enough for "100%", so the track holds still as the number changes. */
.field-readout {
  flex: none;
  width: 2.5rem;
  text-align: right;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  color: var(--fg);
}
</style>
