import { defineStore } from 'pinia'
import { prefDefault } from '@/config/preferences'

export type RulerUnits = 'cells' | 'px'

export const useCanvasViewStore = defineStore('canvasView', {
  state: () => prefDefault('canvasView'),
  getters: {
    // Whether the sub-toggle should present as disabled. A checkbox that still
    // ticks while doing nothing on screen is worse than one that cannot act.
    //
    // No "lines are effectively visible" getter here. The renderer draws
    // teleport lines inside the transitions layer's gate, so the layer being
    // off already hides them, and a second expression of that could only
    // drift. The two flags stay independent state: forcing `showTeleportLines`
    // off with the master would lose the user's choice, and turning the layer
    // back on would restore lines they had hidden.
    teleportLinesDisabled(): boolean {
      return !this.showTransitions
    },
    // Both markup sub-toggles, which are disabled together: the same reasoning
    // as above, and one getter because they share one master.
    markupLayersDisabled(): boolean {
      return !this.showMarkup
    },
  },
  actions: {
    toggleGrid() {
      this.showGrid = !this.showGrid
    },
    toggleRulers() {
      this.showRulers = !this.showRulers
    },
    toggleCoords() {
      this.showCoords = !this.showCoords
    },
    setRulerUnits(units: RulerUnits) {
      this.rulerUnits = units
    },
    toggleTransitions() {
      this.showTransitions = !this.showTransitions
    },
    // Refuses while the master is off rather than storing a change nobody can
    // see. The menu item is disabled, so this only fires from a keyboard or a
    // future shortcut. The honest answer is "that control is not available".
    toggleTeleportLines() {
      if (!this.showTransitions) return
      this.showTeleportLines = !this.showTeleportLines
    },
    toggleMarkup() {
      this.showMarkup = !this.showMarkup
    },
    // Both refuse while the master is off, for the reason `toggleTeleportLines`
    // gives: the control is not available, and storing a change nothing can
    // show is worse than declining it.
    toggleIcons() {
      if (!this.showMarkup) return
      this.showIcons = !this.showIcons
    },
    toggleLines() {
      if (!this.showMarkup) return
      this.showLines = !this.showLines
    },
    // No master to answer to. Labels belong to the objects that carry them, so
    // hiding the markup layer already hides them, and this stays free to be
    // toggled from anywhere for the same reason the sub-toggles are not.
    toggleAllLabels() {
      this.showAllLabels = !this.showAllLabels
    },
  },
  persist: { key: 'canvasView' },
})
