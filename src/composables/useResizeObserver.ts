import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

// The onMounted/observe/disconnect dance, once. Recurs on every canvas-ish
// surface, so it's worth not re-typing.
//
// The element is a ref rather than a raw node so it can arrive late or be
// swapped (a `v-if` toggling the observed element re-targets the observer
// instead of silently watching a detached node).
export function useResizeObserver(target: Ref<HTMLElement | null>, callback: () => void) {
  let observer: ResizeObserver | null = null

  function observe(el: HTMLElement | null) {
    observer?.disconnect()
    if (el) observer?.observe(el)
  }

  onMounted(() => {
    observer = new ResizeObserver(callback)
    observe(target.value)
  })

  watch(target, observe)

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })
}
