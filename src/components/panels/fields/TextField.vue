<script setup lang="ts">
import { computed, ref } from 'vue'

// A single-line inspector field. Commits on Enter and on blur, abandons on
// Escape, and emits only when the value actually changed, so tabbing through a
// panel leaves no undo entries behind.
//
// The input is uncontrolled between edits: `display` follows the model until
// the first keystroke and follows the draft afterwards. That is what makes a
// value changed underneath the field (undo, another client of the same op)
// visible without stamping over what the user is halfway through typing.
//
// `allowEmpty` separates the two kinds of text this kit carries. A name is
// mandatory, so blanking one abandons rather than committing: silently erasing
// a room's name is worse than refusing the edit. A label is optional, and
// clearing it is a thing the user means.

const props = withDefaults(
  defineProps<{
    id: string
    label: string
    value: string
    allowEmpty?: boolean
  }>(),
  { allowEmpty: false },
)

const emit = defineEmits<{ commit: [value: string] }>()

const draft = ref('')
const dirty = ref(false)

const display = computed(() => (dirty.value ? draft.value : props.value))

function handleInput(event: Event) {
  draft.value = (event.target as HTMLInputElement).value
  dirty.value = true
}

function commit() {
  if (!dirty.value) return
  dirty.value = false
  const trimmed = draft.value.trim()
  if (!trimmed && !props.allowEmpty) return
  if (trimmed === props.value) return
  emit('commit', trimmed)
}

// Escape only reverts the field. The global dispatcher stands down while a
// text target has focus, so nothing below this reads the same press.
function cancel() {
  dirty.value = false
}
</script>

<template>
  <div class="field">
    <label class="field-label" :for="id">{{ label }}</label>
    <input
      :id="id"
      class="field-input"
      type="text"
      :value="display"
      @input="handleInput"
      @keydown.enter="commit"
      @keydown.esc="cancel"
      @blur="commit"
    />
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

.field-input {
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 0.8125rem;
  padding: 0.25rem 0.375rem;
  min-width: 0;
}
.field-input:focus {
  outline: none;
  border-color: var(--accent);
}
</style>
