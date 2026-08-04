<script setup lang="ts">
import { computed, ref } from 'vue'

// Free-form notes. Same draft model as TextField with one difference that is
// forced rather than chosen: Enter inserts a newline here, so blur is the only
// commit. Escape still abandons.
//
// Empty is a legitimate value: clearing notes is something the user means, so
// there is no `allowEmpty` to set. The draft is trimmed at the edges only,
// which keeps interior blank lines the user typed on purpose.

const props = defineProps<{
  id: string
  label: string
  value: string
}>()

const emit = defineEmits<{ commit: [value: string] }>()

const draft = ref('')
const dirty = ref(false)

const display = computed(() => (dirty.value ? draft.value : props.value))

function handleInput(event: Event) {
  draft.value = (event.target as HTMLTextAreaElement).value
  dirty.value = true
}

function commit() {
  if (!dirty.value) return
  dirty.value = false
  const trimmed = draft.value.trim()
  if (trimmed === props.value) return
  emit('commit', trimmed)
}

function cancel() {
  dirty.value = false
}
</script>

<template>
  <div class="field">
    <label class="field-label" :for="id">{{ label }}</label>
    <textarea
      :id="id"
      class="field-textarea"
      rows="3"
      :value="display"
      @input="handleInput"
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

.field-textarea {
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 0.8125rem;
  padding: 0.25rem 0.375rem;
  min-width: 0;
  resize: vertical;
}
.field-textarea:focus {
  outline: none;
  border-color: var(--accent);
}
</style>
