// Panning the canvas by dragging it.
//
// Two rules, and the second is the one that is easy to get backwards.
//
// The camera is captured at press, and every move applies the drag's *total*
// travel to that snapshot rather than the frame's delta to the live camera.
// Absolute from an origin cannot drift; accumulated deltas can, and the error
// only ever shows up as a pan that ends a pixel or two off where it was
// grabbed.
//
// The sign follows from the projection rather than from taste. `screenToWorld`
// is `screen / scale + pan`, so for the world point under the pointer to still
// be under it after the pointer has moved by `dx`, `pan` must change by
// `-dx / scale`. That is what grabbing the map and moving it means, and it is
// what holds at every zoom without a second constant.
//
// The camera is view state on the tab, not model state, so a pan journals
// nothing, needs no `Esc` tier and cannot be undone.

import { startPointerDrag, MIDDLE_BUTTON } from './pointerDrag'
import { panByScreen } from '@/canvas/camera'
import type { Camera } from '@/canvas/camera'

export interface CanvasPanSpec {
  // The camera at press. Held for the life of the drag; see above.
  camera: Camera
  tileSize: number
  onPan(camera: Camera): void
  onEnd?(): void
  // Defaults to the middle button. Space-armed panning passes the primary one.
  buttons?: readonly number[]
}

// Returns true when the press was taken, so the caller can put up the grabbing
// cursor and decline to start anything else with the same press.
export function beginCanvasPan(event: PointerEvent, spec: CanvasPanSpec): boolean {
  const origin = spec.camera
  return startPointerDrag(event, {
    buttons: spec.buttons ?? [MIDDLE_BUTTON],
    onMove: ({ dx, dy }) => spec.onPan(panByScreen(origin, -dx, -dy, spec.tileSize)),
    onEnd: () => spec.onEnd?.(),
  })
}
