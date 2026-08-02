import { ref, type Ref } from 'vue'
import { readCanvasPalette, type CanvasPalette } from '@/canvas/palette'
import {
  renderMap,
  type ActiveRoomScene,
  type BrushPreview,
  type GhostScene,
  type MapScene,
} from '@/canvas/renderMap'
import { RULER_THICKNESS, renderRuler, type RulerUnits } from '@/canvas/renderRuler'
import type { Camera } from '@/canvas/camera'
import type { IconArt } from '@/canvas/iconBadge'
import type { TeleportScene } from '@/canvas/teleports'
import type { BoxPreview } from '@/gestures/boxDrag'
import type { Bounds } from '@/canvas/viewport'
import type { CellKey } from '@/core/cell'
import type { AreaId, LockTypeId, TransitionId } from '@/core/ids'
import type { Area, LockType, MapModel } from '@/core/types'

// Owns the imperative half of the canvas: device-pixel sizing, the cached
// palette, and driving the pure render functions. The component above keeps
// refs and translates DOM events; modules below are pure. The model stays out
// of Vue reactivity and nothing here reads a store.

export interface CanvasTargets {
  container: Ref<HTMLElement | null>
  main: Ref<HTMLCanvasElement | null>
  topRuler: Ref<HTMLCanvasElement | null>
  leftRuler: Ref<HTMLCanvasElement | null>
}

export interface SceneInput {
  camera: Camera
  bounds: Bounds
  // From `settings.tileSize`. Passed down rather than imported, so this
  // composable reads no store.
  tileSize: number
  // The map being drawn, the areas its rooms take their colours from, and the
  // lock types its doors take theirs from. Both are project-scope, which is why
  // neither is reachable from the map alone.
  map: MapModel | null
  areas: ReadonlyMap<AreaId, Area>
  lockTypes: ReadonlyMap<LockTypeId, LockType>
  // Art for every icon type this build knows. Resolved by the caller, so the
  // renderer stays independent of where icon art comes from.
  iconArt: ReadonlyMap<string, IconArt>
  // Both ends of every teleport on this map, near and far. Project-scoped,
  // so it arrives already prepared.
  teleports: TeleportScene

  // The live gesture's overlay, or null when nothing is being dragged.
  ghost: GhostScene | null
  // The brush footprint under the pointer, or null when there is none to show.
  brushPreview: BrushPreview | null
  // Door mode's rubber-band box, or null when no box drag is live.
  boxPreview: BoxPreview | null
  // The origin cell of a half-finished teleport on *this* map, or null.
  pendingTeleport: CellKey | null
  // Transitions selected on this map, drawn as a halo behind each.
  selected: ReadonlySet<TransitionId>
  // Draw/Edit's active room and its handles, or null when nothing is armed.
  activeRoom: ActiveRoomScene | null
  showGrid: boolean
  showRulers: boolean
  rulerUnits: RulerUnits
  // The transitions layer and its nested teleport-lines sub-toggle, already
  // resolved against the active mode by the caller.
  showTransitions: boolean
  showTeleportLines: boolean
  // The markup layer's two halves and the label rule, resolved against their
  // master and the active mode by the caller, like the pair above.
  showIcons: boolean
  showLines: boolean
  showAllLabels: boolean
  hoveredLabel: string | null
}

// Backing-store pixels for a CSS-pixel box, so lines land on device pixels
// instead of being resampled into a blur on a HiDPI screen.
function sizeToDpr(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number) {
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.round(cssWidth * ratio)
  canvas.height = Math.round(cssHeight * ratio)
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`
}

// Every draw starts from a clean transform scaled to the device ratio, so the
// render functions can work in CSS pixels and stay resolution-agnostic.
function context2d(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  const ctx = canvas?.getContext('2d')
  if (!ctx) return null
  const ratio = window.devicePixelRatio || 1
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  return ctx
}

export function useCanvasRenderer(targets: CanvasTargets, scene: () => SceneInput) {
  // Resolved once per theme change rather than per draw.
  const palette = ref<CanvasPalette | null>(null)

  function refreshPalette() {
    palette.value = readCanvasPalette()
  }

  function draw() {
    if (!palette.value) refreshPalette()
    const current = scene()
    const main = targets.main.value
    if (!main) return

    const ratio = window.devicePixelRatio || 1
    const width = main.width / ratio
    const height = main.height / ratio

    const mainCtx = context2d(main)
    if (!mainCtx) return

    const mapScene: MapScene = {
      camera: current.camera,
      bounds: current.bounds,
      tileSize: current.tileSize,
      map: current.map,
      areas: current.areas,
      lockTypes: current.lockTypes,
      iconArt: current.iconArt,
      teleports: current.teleports,
      ghost: current.ghost,
      brushPreview: current.brushPreview,
      boxPreview: current.boxPreview,
      pendingTeleport: current.pendingTeleport,
      selected: current.selected,
      activeRoom: current.activeRoom,
      palette: palette.value!,
      showGrid: current.showGrid,
      showTransitions: current.showTransitions,
      showTeleportLines: current.showTeleportLines,
      showIcons: current.showIcons,
      showLines: current.showLines,
      showAllLabels: current.showAllLabels,
      hoveredLabel: current.hoveredLabel,
    }
    renderMap(mainCtx, width, height, mapScene)

    if (!current.showRulers) return

    const topCtx = context2d(targets.topRuler.value)
    if (topCtx) {
      renderRuler(topCtx, {
        axis: 'x',
        length: width,
        camera: current.camera,
        tileSize: current.tileSize,
        palette: palette.value!,
        units: current.rulerUnits,
      })
    }

    const leftCtx = context2d(targets.leftRuler.value)
    if (leftCtx) {
      renderRuler(leftCtx, {
        axis: 'y',
        length: height,
        camera: current.camera,
        tileSize: current.tileSize,
        palette: palette.value!,
        units: current.rulerUnits,
      })
    }
  }

  // Re-sizes every canvas to the container and redraws. Sizing a canvas
  // clears it, so a resize always implies a draw.
  function resize() {
    const container = targets.container.value
    const main = targets.main.value
    if (!container || !main) return

    const { width, height } = container.getBoundingClientRect()
    sizeToDpr(main, width, height)
    if (targets.topRuler.value) sizeToDpr(targets.topRuler.value, width, RULER_THICKNESS)
    if (targets.leftRuler.value) sizeToDpr(targets.leftRuler.value, RULER_THICKNESS, height)
    draw()
  }

  // Theme changed: the cached colours are stale, so re-read then repaint.
  function repaintForTheme() {
    refreshPalette()
    draw()
  }

  return { draw, resize, repaintForTheme }
}
