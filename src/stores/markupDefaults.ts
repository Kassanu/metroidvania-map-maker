// Defaults for creating markup: held by the Markup toolbar, never read or
// edited from elsewhere.
//
// The same doctrine as `doorDefaults`. This is an intent for the next icon
// only. Selecting an icon never updates it; changing it never touches the
// selection. Editing an existing icon is the Inspector's job, so there is
// exactly one place to do it.
//
// The one thing that writes here without the user touching a control is
// arming: picking an icon loads that icon's own colours, so the grid shows
// what will land on the map. That is still creation-only, since what it writes
// is the next placement's colours and never the selection's.

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { IconColors } from '@/core/ops/markup'

// The pair a placement gets before any icon has been picked. Neutral rather
// than borrowed from an icon: no icon is armed yet, so nothing has a claim.
const INITIAL_PLATE = '#e0e0e0'
const INITIAL_GLYPH = '#202020'

export const useMarkupDefaultsStore = defineStore('markupDefaults', () => {
  const plateColor = ref(INITIAL_PLATE)
  const glyphColor = ref(INITIAL_GLYPH)

  // Markup's own collision option. Placing on an occupied cell is blocked by
  // default; this opts into overwriting, and `placeIcon` refuses
  // `cell-occupied` distinguishably so the toolbar can be what resolves it.
  //
  // Deliberately not a shared setting: room move, merge and resize are all
  // unconditionally destructive through the ghosting model, so there is no
  // app-wide collision toggle for this to mirror.
  const replace = ref(false)

  function setPlateColor(value: string): void {
    plateColor.value = value
  }

  function setGlyphColor(value: string): void {
    glyphColor.value = value
  }

  function setReplace(value: boolean): void {
    replace.value = value
  }

  // Picking an icon loads its canonical pair, which the user may then override
  // before placing. Both at once, so a half-loaded pair cannot be placed.
  function loadColors(colors: IconColors): void {
    plateColor.value = colors.plateColor
    glyphColor.value = colors.glyphColor
  }

  return {
    plateColor: computed(() => plateColor.value),
    glyphColor: computed(() => glyphColor.value),
    replace: computed(() => replace.value),
    setPlateColor,
    setGlyphColor,
    setReplace,
    loadColors,

    // What a placement should be handed.
    colors: computed<IconColors>(() => ({
      plateColor: plateColor.value,
      glyphColor: glyphColor.value,
    })),
  }
})
