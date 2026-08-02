// The preferences registry: one typed source of truth for every durable,
// per-user, cross-project setting. Its key, shape, and default are all
// defined here. Stores initialize from here rather than each declaring its
// own literal, giving us defaults in one place, a single version to migrate
// against, and a settings modal that can reset to a known-good baseline.
//
// Each key mirrors the store's field names, since that's the slice the
// persistence plugin reads and writes (see stores/persistPrefs.ts).
//
// Not in here: build constants (constants.ts) and project data like rooms,
// areas, tile size, and map colors, which persist to the project file
// instead of localStorage.
//
// Type-only imports: each domain still owns its own types; this file just
// enumerates the persisted set. Erased at compile time, so no import cycle
// with the stores that read PREF_DEFAULTS.
import type { PanelDef } from '@/stores/panels'
import type { RulerUnits } from '@/stores/canvasView'
import type { ThemeMode } from '@/stores/theme'
import type { LocalePreference } from '@/i18n'
import { SIDEBAR_DEFAULT_WIDTH } from './constants'

// Bump when a stored shape changes incompatibly, and add the matching
// migration in persistPrefs.ts's read().
export const PREFS_VERSION = 1

export interface ThemePrefs {
  mode: ThemeMode
}

export interface LocalePrefs {
  preference: LocalePreference
}

export interface SidebarLayoutPrefs {
  leftSidebarCollapsed: boolean
  rightSidebarCollapsed: boolean
  leftSidebarWidth: number
  rightSidebarWidth: number
}

export interface WelcomePrefs {
  hideWelcomeOnStartup: boolean
}

export interface CanvasViewPrefs {
  showGrid: boolean
  showRulers: boolean
  showCoords: boolean
  rulerUnits: RulerUnits
  // Per-layer visibility. `showTeleportLines` is a *sub*-toggle of
  // `showTransitions` and is stored independently of it on purpose: turning the
  // master off and back on has to restore the sub-toggle to what the user last
  // chose, not reset it. See stores/canvasView.ts for the nesting rule.
  showTransitions: boolean
  showTeleportLines: boolean
}

export interface PanelsPrefs {
  panels: PanelDef[]
}

export interface Preferences {
  theme: ThemePrefs
  locale: LocalePrefs
  sidebarLayout: SidebarLayoutPrefs
  welcome: WelcomePrefs
  canvasView: CanvasViewPrefs
  panels: PanelsPrefs
}

export const PREF_DEFAULTS: Preferences = {
  theme: { mode: 'system' },
  // Follow the browser's language list until the user says otherwise.
  locale: { preference: 'system' },
  sidebarLayout: {
    leftSidebarCollapsed: false,
    rightSidebarCollapsed: false,
    leftSidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    rightSidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  },
  welcome: { hideWelcomeOnStartup: false },
  canvasView: {
    showGrid: true,
    showRulers: true,
    showCoords: true,
    rulerUnits: 'cells',
    // Both default on: a layer toggle is for temporarily getting something out
    // of the way, so the state you have never touched is "everything visible".
    showTransitions: true,
    showTeleportLines: true,
  },
  // Listed for completeness, but empty: a panel's real defaults (side,
  // order) are derived from PANEL_REGISTRY and merged per-entry over what
  // was saved, so panel types added or removed later never leave stale or
  // missing state behind. See stores/panels.ts.
  panels: { panels: [] },
}

// Returns a fresh copy. Pinia's reactive() wraps the object it is handed
// rather than cloning it, so passing PREF_DEFAULTS straight through would
// let one store instance's mutations leak into every other instance that
// also fell back to defaults.
export function prefDefault<K extends keyof Preferences>(key: K): Preferences[K] {
  return structuredClone(PREF_DEFAULTS[key])
}
