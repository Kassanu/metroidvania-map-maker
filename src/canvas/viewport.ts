// Screen-px ↔ world-cell conversions shared by grid rendering, the rulers,
// and the coords overlay: the one place that math lives.

// Type-only, so the cycle with camera.ts (which imports these functions) is
// erased at build time and never exists at runtime.
import type { Camera } from './camera'

// The tile size is not here. It is `settings.tileSize` in the model
// (project-wide, saved with the file, and editable), so every conversion
// takes it as a parameter rather than reading a module constant.

// The model owns this shape: a map's drawn extent is a property of its rooms,
// not of the renderer. Re-exported under the name the canvas code already uses
// instead of declaring a second, identical interface here.
export type { CellBounds as Bounds } from '@/core/derive/bounds'

// World-cell coordinate (can be fractional) visible at the canvas's
// top-left pixel: the "camera position." Absolute world coordinates, not
// relative to the page bounds, so they can go negative.
export interface Pan {
  x: number
  y: number
}

// A little negative padding so a fresh map doesn't open with the page flush
// against the canvas's top-left corner.
export const DEFAULT_PAN: Pan = { x: -4, y: -3 }

export interface ScreenPoint {
  x: number
  y: number
}

// Pan and zoom are taken together as a `Camera` rather than as two arguments:
// they always travel together.
//
// `tileSize * zoom` is the screen size of one cell, and it is the only place
// either value is used, so a project's tile size and the user's zoom compose
// exactly as you would expect, and neither has a privileged position.
export function worldToScreen(
  worldX: number,
  worldY: number,
  camera: Camera,
  tileSize: number,
): ScreenPoint {
  const scale = tileSize * camera.zoom
  return {
    x: (worldX - camera.pan.x) * scale,
    y: (worldY - camera.pan.y) * scale,
  }
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  camera: Camera,
  tileSize: number,
): ScreenPoint {
  const scale = tileSize * camera.zoom
  return {
    x: screenX / scale + camera.pan.x,
    y: screenY / scale + camera.pan.y,
  }
}
