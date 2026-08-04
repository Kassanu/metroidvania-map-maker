<script setup lang="ts">
// A choice from a short fixed list. Commits immediately: a discrete choice has
// no intermediate states to protect, so there is nothing a draft would buy.
//
// A native select, for the same reasons the Draw toolbar's area picker is one:
// keyboard support, a real touch picker, and screen-reader semantics without
// rebuilding any of them.

export interface FieldOption {
  value: string
  label: string
}

defineProps<{
  id: string
  label: string
  value: string
  options: readonly FieldOption[]
}>()

const emit = defineEmits<{ commit: [value: string] }>()
</script>

<template>
  <div class="field">
    <label class="field-label" :for="id">{{ label }}</label>
    <div class="field-row">
      <slot name="before" />
      <select
        :id="id"
        class="field-select"
        :value="value"
        @change="emit('commit', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="option in options" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
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

.field-select {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 0.8125rem;
  padding: 0.25rem 0.375rem;
}
.field-select:focus {
  outline: none;
  border-color: var(--accent);
}
</style>
