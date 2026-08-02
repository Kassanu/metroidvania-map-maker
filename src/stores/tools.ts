import { defineStore } from 'pinia'
import { DEFAULT_BRUSH_SIZE, clampBrushSize } from '@/canvas/brush'
import type { WallStyle } from '@/core/types'
import type { SubMode } from '@/gestures/subMode'

// The tool state the per-mode toolbar section owns.
//
// Erase is deliberately one flag across modes, not one per mode. It is an input
// modifier: the primary pointer erases/deletes instead of doing its normal
// thing. A user who turns erasing on, switches to Door to delete a transition
// and comes back would be surprised to find it had silently reverted.
//
// Nothing here persists. There is no `persist` option, which is the whole
// opt-in, so both fields reset every session. A tool left in a destructive
// state across restarts is a trap, not a convenience. Brush size resets to the
// default (square, size 1) each session. The erase toggle follows the same
// pattern. (Saved shape/size presets are a separate backlog item.)
export const useToolsStore = defineStore('tools', {
  state: () => ({
    erase: false,
    // Square N×N. Shape is not a field yet: v1 is square-only, and circle
    // plus a shape toggle are backlog, so inventing `shape: 'square'` now
    // would be a setting with one legal value.
    brushSize: DEFAULT_BRUSH_SIZE,
    // The style an inner-wall drag applies, per segment. Solid by default.
    // Dotted and doorway both mean something specific (secret, passage), so
    // the plain wall is the one to reach for without thinking.
    wallStyle: 'solid' as WallStyle,
    // Which rows of the Draw/Edit precedence table are live. Auto is the full
    // context-sensitive behaviour and the default; the other three remove
    // inference for focused work.
    //
    // Per-session like everything else here, and this one would be the worst to
    // persist: a user who locked to Resize-only, closed the app and came back
    // would find painting silently broken with no memory of why.
    subMode: 'auto' as SubMode,
  }),
  actions: {
    setWallStyle(style: WallStyle) {
      this.wallStyle = style
    },
    setSubMode(subMode: SubMode) {
      this.subMode = subMode
    },
    toggleErase() {
      this.erase = !this.erase
    },
    // Clamped rather than guarded at the call site, so `[` at size 1 and `]`
    // at the ceiling are quiet no-ops from the keymap, toolbar stepper, or a
    // future preset.
    setBrushSize(size: number) {
      this.brushSize = clampBrushSize(size)
    },
    growBrush() {
      this.setBrushSize(this.brushSize + 1)
    },
    shrinkBrush() {
      this.setBrushSize(this.brushSize - 1)
    },
  },
})
