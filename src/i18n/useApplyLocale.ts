import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useLocaleStore } from '@/stores/locale'
import { resolveSystemLocale, setLocale } from './index'

// Resolves the stored preference into the active locale, and keeps it
// resolved: on 'system', the browser firing `languagechange` (the user
// changing their OS or browser language mid-session) re-picks the best
// match, the same way the theme's matchMedia listener handles an OS
// light/dark switch.
export function useApplyLocale() {
  const localeStore = useLocaleStore()

  function apply() {
    const { preference } = localeStore
    setLocale(preference === 'system' ? resolveSystemLocale() : preference)
  }

  watch(() => localeStore.preference, apply, { immediate: true })

  onMounted(() => window.addEventListener('languagechange', apply))
  onBeforeUnmount(() => window.removeEventListener('languagechange', apply))
}
