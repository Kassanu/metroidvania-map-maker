// The icon the next click will place, or null when clicks mean what the table
// says they mean.
//
// The same shape as `pendingTeleport`, and a slot for the same reasons: it
// holds no transaction, because arming applies nothing to the model, and it
// outlives the pointer that set it, because the whole point is to place several
// icons with several clicks. A gesture that survives a tab switch and applies
// nothing is not a gesture.
//
// Unlike the other slots it does not prune, and that is the difference worth
// naming: `activeRoom`, `drawArea` and `pendingTeleport` all name something in
// the model that an edit, an undo or a file load can take away. This names a
// registry id, which no model edit can touch. It is only ever cleared by the
// user disarming or by leaving the mode.
//
// Why the mode watch is here rather than in the canvas: the same argument
// `pendingTeleport` makes. "Armed only exists in Markup mode" is a property of
// the state, true whatever is mounted. `Esc` stays with the component that owns
// input wiring, as the other slots' does.

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useModeStore } from './mode'

export const useArmedIconStore = defineStore('armedIcon', () => {
  const mode = useModeStore()

  // The registry id, not an entry: what the placement op takes is the id, and
  // holding the entry would pin a snapshot of art that the catalogue owns.
  const iconType = ref<string | null>(null)

  function arm(type: string): void {
    iconType.value = type
  }

  function disarm(): void {
    iconType.value = null
  }

  // Clicking the armed icon in the library again disarms it, which is one of
  // the three routes out. A different icon re-arms rather than toggling off.
  function toggle(type: string): void {
    iconType.value = iconType.value === type ? null : type
  }

  watch(
    () => mode.active,
    (active) => {
      if (active !== 'markup') disarm()
    },
    { flush: 'sync' },
  )

  return {
    iconType: computed(() => iconType.value),
    isArmed: computed(() => iconType.value !== null),
    arm,
    disarm,
    toggle,
  }
})
