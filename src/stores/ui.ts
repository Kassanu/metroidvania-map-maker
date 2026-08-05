import { defineStore } from 'pinia'
import { clamp } from '@/lib/math'
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '@/config/constants'
import { prefDefault } from '@/config/preferences'

export const useUiStore = defineStore('ui', {
  state: () => ({
    ...prefDefault('sidebarLayout'),
    ...prefDefault('welcome'),
    cheatSheetOpen: false,
    // Session-only state, not part of the durable prefs list. Always starts
    // off on reload rather than silently reopening in a chrome-free view.
    zenMode: false,
    // Shown on startup unless the user opts out via the modal's checkbox.
    // Session-only itself; the durable half is hideWelcomeOnStartup, which
    // the persist entry below derives this from on load.
    welcomeOpen: true,
    aboutOpen: false,
  }),
  actions: {
    toggleLeftSidebar() {
      this.leftSidebarCollapsed = !this.leftSidebarCollapsed
    },
    toggleRightSidebar() {
      this.rightSidebarCollapsed = !this.rightSidebarCollapsed
    },
    // Live-updated during a resize drag. The persistence plugin's debounce
    // coalesces the drag's stream of writes into one, so there's no separate
    // commit-on-release call for the caller to make.
    setLeftSidebarWidth(px: number) {
      this.leftSidebarWidth = clamp(px, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
    },
    setRightSidebarWidth(px: number) {
      this.rightSidebarWidth = clamp(px, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
    },
    resetSidebarLayout() {
      this.$patch(prefDefault('sidebarLayout'))
    },
    toggleCheatSheet() {
      this.cheatSheetOpen = !this.cheatSheetOpen
    },
    toggleZenMode() {
      this.zenMode = !this.zenMode
    },
    openWelcome() {
      this.welcomeOpen = true
    },
    closeWelcome() {
      this.welcomeOpen = false
    },
    setHideWelcomeOnStartup(hide: boolean) {
      this.hideWelcomeOnStartup = hide
    },
    openAbout() {
      this.aboutOpen = true
    },
  },
  persist: [
    {
      key: 'sidebarLayout',
      paths: [
        'leftSidebarCollapsed',
        'rightSidebarCollapsed',
        'leftSidebarWidth',
        'rightSidebarWidth',
      ],
    },
    {
      key: 'welcome',
      paths: ['hideWelcomeOnStartup'],
      // welcomeOpen is session state derived from the pref, so it has to be
      // recomputed after the saved flag lands. Otherwise the modal would
      // still open on a run where the user had opted out.
      hydrate(saved, state) {
        state.hideWelcomeOnStartup = saved.hideWelcomeOnStartup ?? false
        state.welcomeOpen = !state.hideWelcomeOnStartup
      },
    },
  ],
})
