import { watch } from 'vue'
import { useThemeStore } from '@/stores/theme'

// Stamps (or clears) the `data-theme` override on <html> that style.css's
// `:root[data-theme="light"|"dark"]` rules key off of. 'system' clears the
// attribute entirely so the `@media (prefers-color-scheme)` rule takes over
// instead of a stale explicit override.
export function useApplyTheme() {
  const theme = useThemeStore()

  watch(
    () => theme.mode,
    (mode) => {
      if (mode === 'system') document.documentElement.removeAttribute('data-theme')
      else document.documentElement.setAttribute('data-theme', mode)
    },
    { immediate: true },
  )
}
