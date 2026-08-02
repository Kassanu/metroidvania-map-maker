import { defineStore } from 'pinia'
import { prefDefault } from '@/config/preferences'
import type { LocalePreference } from '@/i18n'

// Holds the user's choice only; i18n/useApplyLocale.ts turns it into the
// active locale. Same split as the theme store and useApplyTheme. The store
// never resolves 'system', so a language change at the OS level is picked up
// live rather than baked in at first load.
export const useLocaleStore = defineStore('locale', {
  state: () => prefDefault('locale'),
  actions: {
    setPreference(preference: LocalePreference) {
      this.preference = preference
    },
  },
  persist: { key: 'locale' },
})
