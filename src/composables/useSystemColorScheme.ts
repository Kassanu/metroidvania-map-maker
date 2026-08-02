import { onBeforeUnmount, onMounted, ref } from 'vue'

// The OS's light/dark preference as a reactive boolean.
//
// Distinct from the theme store, which holds the user's choice of
// system/light/dark. This is the "system" half of that choice: needed
// wherever an OS-level switch has to trigger work that CSS can't do on its
// own, like repainting the canvas (its colours are read from the resolved
// theme, not applied by a stylesheet).
export function useSystemColorScheme() {
  const prefersDark = ref(false)
  let query: MediaQueryList | null = null

  function update() {
    prefersDark.value = query?.matches ?? false
  }

  onMounted(() => {
    query = window.matchMedia('(prefers-color-scheme: dark)')
    update()
    query.addEventListener('change', update)
  })

  onBeforeUnmount(() => {
    query?.removeEventListener('change', update)
    query = null
  })

  return { prefersDark }
}
