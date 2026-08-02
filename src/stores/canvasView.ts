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
  },
  persist: { key: 'canvasView' },
})
