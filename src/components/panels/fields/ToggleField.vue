<script setup lang="ts">
// An on/off property. Commits immediately: there is no intermediate state a
// draft would protect, and a checkbox that needed confirming would be the only
// control in the app that did.
//
// A checkbox rather than the toolbar's pressed-button, because these sit in a
// column of labelled fields rather than in a strip of tools, and a checkbox is
// what carries "this property is on" to a screen reader without an aria-pressed
// of its own.

defineProps<{
  id: string
  label: string
  value: boolean
}>()

const emit = defineEmits<{ commit: [value: boolean] }>()
</script>

<template>
  <div class="field toggle">
    <input
      :id="id"
      class="field-checkbox"
      type="checkbox"
      :checked="value"
      @change="emit('commit', ($event.target as HTMLInputElement).checked)"
    />
    <label class="field-label" :for="id">{{ label }}</label>
  </div>
</template>

<style scoped>
.field.toggle {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.375rem;
}

.field-label {
  font-size: 0.6875rem;
  font-weight: 600;
  opacity: 0.7;
  color: var(--fg);
}

.field-checkbox {
  flex: none;
  margin: 0;
  cursor: pointer;
}
</style>
