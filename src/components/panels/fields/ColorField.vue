<script setup lang="ts">
// A colour, committed on `change` and never on `input`.
//
// That is the whole reason this exists rather than a raw input at each call
// site. A native colour picker fires `input` continuously while the user drags
// around the gamut, so an `input` handler writing to the model would put one
// undo entry on the stack per pixel of that drag. `change` fires once, when the
// picker closes on the colour actually chosen.
//
// The Markup toolbar's swatches do use `input`, correctly: they write to a
// defaults store that has no undo stack behind it.

withDefaults(
  defineProps<{
    id: string
    label: string
    value: string
    disabled?: boolean
    reason?: string
  }>(),
  { disabled: false, reason: '' },
)

const emit = defineEmits<{ commit: [value: string] }>()
</script>

<template>
  <div class="field">
    <label class="field-label" :for="id">{{ label }}</label>
    <input
      :id="id"
      class="field-color"
      type="color"
      :value="value"
      :disabled="disabled"
      :title="disabled ? reason : undefined"
      @change="emit('commit', ($event.target as HTMLInputElement).value)"
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

.field-color {
  width: 3rem;
  height: 1.5rem;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  background: var(--bg);
  cursor: pointer;
}
</style>
