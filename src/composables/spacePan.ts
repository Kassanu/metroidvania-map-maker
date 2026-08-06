// Holding Space arms the canvas for panning.
//
// A held key, not a shortcut, which is why it is here and not in
// `hotkeys/keymap.ts`. That dispatcher listens for keydown only and matches a
// whole combo to an action; arming is transient state with a release, and
// registering it as an action would also make the dispatcher `preventDefault`
// every plain Space in the app.
//
// Three ways to disarm, and only the first is the one users notice:
//
//   - keyup, the ordinary release.
//   - losing the window. `keyup` is never delivered if focus leaves mid-hold,
//     so alt-tabbing away while holding Space would otherwise come back to a
//     hand cursor and no way to clear it.
//   - unmounting, which releases the listeners with it.
//
// Auto-repeat fires keydown continuously while the key is down. Arming is
// idempotent, so the repeat is harmless in itself, but `onArm` fires once per
// press rather than once per repeat.

import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import { isTextEntryTarget } from '@/hotkeys/combo'

// `event.code`, not `event.key`: the physical key, so a layout that puts
// something else on the space bar still arms, and a dead key never does.
const SPACE = 'Space'

export interface SpacePanOptions {
  // Whether the canvas currently owns the keyboard. Space belongs to a focused
  // button before it belongs to the canvas, which is what keeps a keyboard-only
  // user able to press one.
  hasFocus(): boolean
  // Armed presses must not interrupt a gesture already running.
  isBusy?(): boolean
}

export interface SpacePan {
  armed: Ref<boolean>
}

export function useSpacePan(options: SpacePanOptions): SpacePan {
  const armed = ref(false)

  function onKeyDown(event: KeyboardEvent) {
    if (event.code !== SPACE || event.repeat) return
    if (isTextEntryTarget(event.target) || !options.hasFocus()) return
    if (options.isBusy?.()) return
    // Claimed so the page does not scroll, and only once the canvas has been
    // established as the owner: an unclaimed Space elsewhere still reaches
    // whatever is focused.
    event.preventDefault()
    armed.value = true
  }

  function onKeyUp(event: KeyboardEvent) {
    if (event.code !== SPACE) return
    armed.value = false
  }

  function disarm() {
    armed.value = false
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', disarm)
  })
  onUnmounted(() => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', disarm)
  })

  return { armed }
}
