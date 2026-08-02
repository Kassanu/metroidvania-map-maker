import { ref, type Ref } from 'vue'
import { useResizeObserver } from './useResizeObserver'

// Scroll affordances for a strip that can outgrow its container: is it
// overflowing at all, and is there anything further to scroll to in either
// direction? Kept in sync from both the element's own scroll events and a
// ResizeObserver, since content changing (a tab added) and the container
// changing (window resized) both move the answer.
//
// Untestable in jsdom, which has no layout. scrollWidth/clientWidth are
// always 0, so this needs a real browser to verify.
export function useOverflowScroll(target: Ref<HTMLElement | null>) {
  const isOverflowing = ref(false)
  const canScrollBack = ref(false)
  const canScrollForward = ref(false)

  function update() {
    const el = target.value
    if (!el) return
    // The ±1 absorbs sub-pixel rounding, which otherwise leaves the
    // "scroll further" affordance enabled at either end.
    isOverflowing.value = el.scrollWidth > el.clientWidth + 1
    canScrollBack.value = el.scrollLeft > 0
    canScrollForward.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
  }

  // A page at a time, less a sliver of overlap for context.
  function scrollByPage(direction: 1 | -1) {
    const el = target.value
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  useResizeObserver(target, update)

  return { isOverflowing, canScrollBack, canScrollForward, update, scrollByPage }
}
