// Where a library icon dragged out of the sidebar can land.
//
// This is the one gesture that starts in the DOM and ends on the canvas, and it
// is **pointer events, not HTML5 drag-and-drop**, deliberately:
//
//   - every other gesture in the app is `startPointerDrag`, so DnD would be a
//     second input model with its own lifecycle, its own cancel semantics and
//     its own idea of what is being dragged;
//   - DnD's drop target is an element. The canvas is one element holding
//     thousands of cells, so the cell still has to be computed from client
//     coordinates by hand, which is the only part that was ever hard;
//   - DnD's drag image is the browser's, and its touch support is poor, where
//     pointer capture already works for mouse, pen and touch alike.
//
// The registry shape is `escStack`'s: a module-level slot a component fills
// while it is mounted and empties when it is not. The picker cannot import the
// canvas (it would be a cycle, and the panel has no business knowing about
// cameras), and the canvas cannot listen for the release itself, because the
// pointer is captured by the button the drag started on.

import type { IconRegistryEntry } from '@/icons/registry'

export interface DropPoint {
  clientX: number
  clientY: number
}

// Returns whether the drop landed on something. A release outside the canvas,
// or on a cell that refuses the icon, places nothing.
export type IconDropHandler = (point: DropPoint, entry: IconRegistryEntry) => boolean

let handler: IconDropHandler | null = null

// One target, not a stack: there is exactly one map canvas, and a second
// registration would mean two canvases competing for the same drop.
export function registerIconDropTarget(next: IconDropHandler): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

export function dropIconAt(point: DropPoint, entry: IconRegistryEntry): boolean {
  return handler?.(point, entry) ?? false
}
