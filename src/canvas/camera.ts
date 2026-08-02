// The view onto a map (where it's looking and how far in), plus every limit
// and step size that governs it. Plain TS and pure: each operation takes a
// camera and returns a new one, so the store is a thin reactive holder rather
// than the place the maths lives.
import { screenToWorld, type Pan, type ScreenPoint } from './viewport'
import { clamp } from '@/lib/math'

// Step per keyboard/button zoom. Wheel and pinch zoom continuously instead
// (see wheelZoom) so a trackpad's many small deltas feel proportional rather
// than jumping a whole step per event.
export const ZOOM_FACTOR = 1.25
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8
// No canonical "right" value: tuned by feel.
export const WHEEL_ZOOM_SENSITIVITY = 0.002

export interface Camera {
  pan: Pan
  zoom: number
}

export function clampZoom(zoom: number): number {
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM)
}

// Zoom while holding one screen point still (zoom to the cursor). Without the
// anchor the view drifts away from whatever the user was pointing at, which is
// why the anchor is a required parameter rather than an option: every caller
// has to decide what stays put (the pointer for wheel/pinch, the viewport
// centre for keyboard zoom).
export function zoomAt(
  camera: Camera,
  nextZoom: number,
  anchor: ScreenPoint,
  tileSize: number,
): Camera {
  const zoom = clampZoom(nextZoom)
  // The world point under the anchor before the change...
  const world = screenToWorld(anchor.x, anchor.y, camera, tileSize)
  // ...has to land on the same screen point after it.
  return {
    zoom,
    pan: {
      x: world.x - anchor.x / (tileSize * zoom),
      y: world.y - anchor.y / (tileSize * zoom),
    },
  }
}

// One keyboard/button step. `direction` is 1 to zoom in, -1 to zoom out.
export function steppedZoom(zoom: number, direction: 1 | -1): number {
  return clampZoom(direction === 1 ? zoom * ZOOM_FACTOR : zoom / ZOOM_FACTOR)
}

// Continuous zoom from a wheel/pinch delta, anchored on the pointer.
export function wheelZoom(
  camera: Camera,
  deltaY: number,
  anchor: ScreenPoint,
  tileSize: number,
): Camera {
  const scale = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)
  return zoomAt(camera, camera.zoom * scale, anchor, tileSize)
}

// Put a world point in the middle of a viewport of the given size, at the
// current zoom.
//
// The inverse of the pan convention rather than a special case of it: pan is
// the world coordinate at the viewport's top-left corner, so centring is that
// point less half a viewport, converted to world units. Zoom is untouched:
// "centred on the other end" says where to look, not how close.
export function centerOn(
  camera: Camera,
  at: { x: number; y: number },
  viewport: { width: number; height: number },
  tileSize: number,
): Camera {
  const scale = tileSize * camera.zoom
  return {
    zoom: camera.zoom,
    pan: {
      x: at.x - viewport.width / 2 / scale,
      y: at.y - viewport.height / 2 / scale,
    },
  }
}

// Pan by a screen-pixel delta. Pan is stored in world cells, so the delta is
// converted at the current zoom: that's what keeps a drag tracking the
// pointer at any zoom level.
export function panByScreen(
  camera: Camera,
  dxScreen: number,
  dyScreen: number,
  tileSize: number,
): Camera {
  const scale = tileSize * camera.zoom
  return {
    zoom: camera.zoom,
    pan: {
      x: camera.pan.x + dxScreen / scale,
      y: camera.pan.y + dyScreen / scale,
    },
  }
}
