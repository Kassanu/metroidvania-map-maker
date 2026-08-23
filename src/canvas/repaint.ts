// The repaint tick: how a gesture driven from outside the canvas asks for a
// redraw.
//
// It lives here rather than on the model store because it signals that
// something *uncommitted* changed. Those counters are a projection of committed
// state that nothing but `sync()` writes, and an invariant with one exception
// is one nothing can check.
//
// `requestRepaint()` is for callers that do not own `draw()`. `CanvasRegion`
// owns it and calls it directly: the tick is a watch, so it lands a microtask
// later, and a tick per pointer sample would put a flush between the sample and
// the paint.
//
// The tick is exposed read-only; only `requestRepaint()` writes it.
//
// There is no reset, deliberately. The counter is monotonic and Vue records the
// current value when a watch starts, so a mount that comes later still reacts
// to the next bump; a reset is what would leave it watching a value that has
// already gone by.

import { computed, ref } from 'vue'

const tick = ref(0)

export const repaintTick = computed(() => tick.value)

// The canvas is showing speculative state that no revision counter describes.
export function requestRepaint(): void {
  tick.value++
}
