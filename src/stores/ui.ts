import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import { clamp } from '@/lib/math'
import type { ImageFormat } from '@/export/image/formats'
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '@/config/constants'
import { prefDefault } from '@/config/preferences'
import { appliedTheme } from '@/theme/appliedTheme'
import {
  DEFAULT_TRANSPARENT,
  DEFAULT_LAYERS,
  DEFAULT_MARGIN,
  DEFAULT_PX_PER_CELL,
} from '@/export/image/options'

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
    // Session-only, and deliberately not persisted with the scope it was last
    // opened with: a remembered subset would quietly omit a tab the user had
    // forgotten was unticked.
    exportOpen: false,
    // Which format the image dialog is open for, and so whether it is open at
    // all. The descriptor itself rather than an id: an id stored anywhere is an
    // id a later build has to validate, and the whole point of picking the
    // format in the menu is that there is none to get wrong.
    imageExportFormat: null as ImageFormat | null,
    // What the image dialog is set to. Held here rather than in the dialog
    // because these survive an opening, which is what makes "disabling a
    // control does not discard its value" true across two openings for two
    // formats. Persisting them across sessions is #319, and this is the state
    // that entry will save.
    //
    // Appearance is null until the first opening seeds it from the theme that
    // is actually applied. It seeds once: nothing re-seeds it after that, and
    // nothing re-seeds while the dialog is open.
    imageExport: {
      pxPerCell: DEFAULT_PX_PER_CELL as number,
      margin: DEFAULT_MARGIN as number,
      layers: { ...DEFAULT_LAYERS },
      transparent: DEFAULT_TRANSPARENT,
      appearance: null as 'light' | 'dark' | null,
      // Null means the format's own encode quality. Only a format whose
      // descriptor says the quality is adjustable ever shows the control.
      quality: null as number | null,
    },
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
    openExport() {
      this.exportOpen = true
    },
    // `markRaw` because a descriptor is a constant, not state: proxying one
    // would make the table's entry and the store's copy two objects that are
    // equal and not identical.
    openImageExport(format: ImageFormat) {
      this.imageExport.appearance ??= appliedTheme()
      this.imageExportFormat = markRaw(format)
    },
    closeImageExport() {
      this.imageExportFormat = null
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
