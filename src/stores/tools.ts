import { defineStore } from 'pinia'
import { DEFAULT_BRUSH_SIZE, clampBrushSize } from '@/canvas/brush'
import { useSelectionStore } from './selection'
import type { WallStyle } from '@/core/types'
import type { SubMode } from '@/gestures/subMode'

// What Select mode selects. A hard branch, not a filter: the two arms reach
// different targets, hold different things, move by different ops and delete by
// different ops. It shares a word with Draw's `SubMode` and nothing else, which
// is why it is a separate field rather than more members of that union.
export type SelectSubMode = 'rooms' | 'cells'

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
    // Whole rooms by default: it is the granularity the mode is named after,
    // and the one where every gesture has an obvious meaning.
    selectSubMode: 'rooms' as SelectSubMode,
  }),
  actions: {
    setWallStyle(style: WallStyle) {
      this.wallStyle = style
    },
    setSubMode(subMode: SubMode) {
      this.subMode = subMode
    },
    // Switching granularity clears the selection, because `Delete` means
    // something different on each side: Rooms removes the objects, Cells erases
    // cells and can split or destroy a room through the usual cascade. Carrying
    // a selection across would leave a destructive key pointed at something the
    // user never selected in the granularity they are now in.
    //
    // The clear lives here rather than in the toolbar so every future caller
    // gets it, and re-selecting the granularity already in use is a no-op:
    // pressing the active half of a toggle must not wipe a selection.
    setSelectSubMode(subMode: SelectSubMode) {
      if (this.selectSubMode === subMode) return
      this.selectSubMode = subMode
      useSelectionStore().clear()
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
