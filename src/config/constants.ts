// Build constants: fixed at compile time, never user-editable. Distinct
// from preferences.ts, which holds the settings the user can change and
// that persist to localStorage.
//
// Domain-specific constants stay colocated with their domain instead. Zoom
// limits in canvas/camera.ts, page padding in canvas/page.ts, tick and wall
// weights in the renderer that draws them. This file is for the chrome values
// that no single module owns.
//
// The test for "does it belong here" is ownership, not type: a number used by
// exactly one module lives with that module, however constant it looks.

// Outer sidebar width, in px. MIN/MAX bound the resize drag.
export const SIDEBAR_DEFAULT_WIDTH = 256
export const SIDEBAR_MIN_WIDTH = 160
export const SIDEBAR_MAX_WIDTH = 480

// Smallest a panel may be squeezed to by the inner height-resize drag, in px.
export const PANEL_MIN_HEIGHT = 60

// Pointer travel, in px, before a press counts as a drag rather than a
// click. Shared by every chrome drag-to-reorder gesture so they all feel the
// same, and by Door mode's press, which is the first canvas gesture where the
// distinction decides which gesture happens (click = teleport, drag = box).
//
// This is half of the click-vs-drag rule. The canvas adds the other half
// via the cell-boundary test in `handleDoorPress`. Measured in CSS pixels
// for device independence. Written to become input-mode-dependent (larger
// for touch) without changing its readers' signatures, following the same
// pattern as `GRAB_MARGIN_PX`.
export const DRAG_DEAD_ZONE = 5
