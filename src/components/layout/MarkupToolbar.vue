<script setup lang="ts">
import { useToolsStore } from '@/stores/tools'
import { useMarkupDefaultsStore } from '@/stores/markupDefaults'
import { useArmedIconStore } from '@/stores/armedIcon'
import { t } from '@/i18n'

// Markup mode's half of the toolbar's dynamic section, following `DoorToolbar`.
//
// A creation strip: every control says what the next icon gets, and none of
// them reads or writes the selection. Editing an existing icon is the
// Inspector's job.
//
// The two swatches load themselves when an icon is armed, so the pair shown
// here is the pair the grid showed. Overriding one afterwards sticks until the
// next icon is armed.
const tools = useToolsStore()
const markupDefaults = useMarkupDefaultsStore()
const armedIcon = useArmedIconStore()
</script>

<template>
  <div class="toolbar-group dynamic" role="group" :aria-label="t('toolbar.markup.label')">
    <label class="swatch-label" for="markup-plate">{{ t('toolbar.markup.plate') }}</label>
    <input
      id="markup-plate"
      class="color-input"
      type="color"
      :title="t('toolbar.markup.plate')"
      :value="markupDefaults.plateColor"
      @input="markupDefaults.setPlateColor(($event.target as HTMLInputElement).value)"
    />

    <label class="swatch-label" for="markup-glyph">{{ t('toolbar.markup.glyph') }}</label>
    <input
      id="markup-glyph"
      class="color-input"
      type="color"
      :title="t('toolbar.markup.glyph')"
      :value="markupDefaults.glyphColor"
      @input="markupDefaults.setGlyphColor(($event.target as HTMLInputElement).value)"
    />

    <span class="toolbar-divider" aria-hidden="true" />

    <!-- Line style. One colour, because a line is not a badge, and an arrowhead
         per end, because either end may carry one. All three say what the next
         line gets and none of them restyles the selected one. -->
    <label class="swatch-label" for="markup-line">{{ t('toolbar.markup.line') }}</label>
    <input
      id="markup-line"
      class="color-input"
      type="color"
      :title="t('toolbar.markup.line')"
      :value="markupDefaults.lineColor"
      @input="markupDefaults.setLineColor(($event.target as HTMLInputElement).value)"
    />
    <button
      type="button"
      class="toolbar-button arrow-button"
      :title="t('toolbar.markup.arrowStartTitle')"
      :aria-pressed="markupDefaults.arrowStart"
      :class="{ active: markupDefaults.arrowStart }"
      @click="markupDefaults.setArrowStart(!markupDefaults.arrowStart)"
    >
      {{ t('toolbar.markup.arrowStart') }}
    </button>
    <button
      type="button"
      class="toolbar-button arrow-button"
      :title="t('toolbar.markup.arrowEndTitle')"
      :aria-pressed="markupDefaults.arrowEnd"
      :class="{ active: markupDefaults.arrowEnd }"
      @click="markupDefaults.setArrowEnd(!markupDefaults.arrowEnd)"
    >
      {{ t('toolbar.markup.arrowEnd') }}
    </button>

    <span class="toolbar-divider" aria-hidden="true" />

    <!-- Markup's own collision option, and the only one in the app: room edits
         are unconditionally destructive through the ghosting model, so there is
         no shared toggle for this to mirror. -->
    <button
      type="button"
      class="toolbar-button replace-button"
      :title="t('toolbar.markup.replaceTitle')"
      :aria-pressed="markupDefaults.replace"
      :class="{ active: markupDefaults.replace }"
      @click="markupDefaults.setReplace(!markupDefaults.replace)"
    >
      {{ t('toolbar.markup.replace') }}
    </button>

    <!-- Shown only while something is armed: it is the one piece of state here
         that a click on the canvas acts on, and it has no other indicator once
         the popup has closed. -->
    <button
      v-if="armedIcon.isArmed"
      type="button"
      class="toolbar-button disarm-button"
      :title="t('toolbar.markup.disarmTitle')"
      @click="armedIcon.disarm()"
    >
      {{ t('toolbar.markup.disarm') }}
    </button>

    <span class="toolbar-divider" aria-hidden="true" />

    <button
      type="button"
      class="toolbar-button erase-toggle-button"
      :title="t('toolbar.markup.eraseTitle')"
      :aria-pressed="tools.erase"
      @click="tools.toggleErase()"
    >
      {{ t('toolbar.erase') }}
    </button>
  </div>
</template>

<style scoped>
/* Everything else comes from Toolbar.vue's :deep rules, so these cannot drift
 * away from Draw and Door mode's. */
.erase-toggle-button,
.replace-button,
.disarm-button,
.arrow-button {
  font-size: 0.8125rem;
}
.replace-button.active,
.arrow-button.active {
  background: var(--accent-soft, var(--surface-raised));
  font-weight: 600;
}
.swatch-label {
  font-size: 0.8125rem;
  opacity: 0.75;
}
.color-input {
  width: 1.75rem;
  height: 1.25rem;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  background: none;
  cursor: pointer;
}
</style>
