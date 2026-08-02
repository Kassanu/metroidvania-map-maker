import { defineStore } from 'pinia'
import { prefDefault } from '@/config/preferences'

export type ThemeMode = 'system' | 'light' | 'dark'

export const useThemeStore = defineStore('theme', {
  state: () => prefDefault('theme'),
  actions: {
    setMode(mode: ThemeMode) {
      this.mode = mode
    },
  },
  persist: { key: 'theme' },
})
