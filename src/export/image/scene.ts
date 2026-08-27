// The picture an export makes, as a scene the renderer can draw.
//
// It frames the map, never the window: no camera, pan or zoom from anywhere in
// the app reaches this, and the rectangle is derived from what is in the picture
// rather than from what is on screen.
//
// Nothing here files anything, allocates anything or touches the DOM. That is
// what lets a vector producer consume the same scene and paint it differently,
// and it is why the palette arrives resolved rather than being read from the
// theme here.

import { paddedContentBounds } from '@/canvas/page'
import { contentBoundsFor, type CellBounds } from '@/core/derive/bounds'
import { teleportScene } from '@/canvas/teleports'
import { iconArtCatalogue } from '@/icons/registry'
import type { CanvasPalette } from '@/canvas/palette'
import type { MapScene } from '@/canvas/renderMap'
import type { MapId } from '@/core/ids'
import type { MapModel, ProjectModel } from '@/core/types'
import { clamp } from '@/lib/math'
import { MARGIN_MAX, MARGIN_MIN } from './options'

// The reference tile size an export renders against, in CSS pixels.
//
// `renderMap` has no cell-size input: it takes a tile size and a zoom, whose
// product is the drawn cell, and every clamped stroke weight is a function of
// the zoom alone. So the factorisation is not free, and this is the half that
// is pinned: with the tile size fixed here, `zoom` becomes `pxPerCell / 32`,
// the project's own `tileSize` drops out of the picture entirely, and ink
// scales with the cell instead of with somebody's display preference.
export const EXPORT_TILE_SIZE = 32

// Which of the renderer's own layers the picture draws. The list is exactly
// `MapScene`'s flags: rooms and walls have none, because they are what an
// export is of.
export interface ExportLayers {
  grid: boolean
  transitions: boolean
  // Nested under `transitions`, as on the canvas: hiding the layer takes the
  // connecting lines with it whatever this says.
  teleportLines: boolean
  icons: boolean
  lines: boolean
  allLabels: boolean
}

export interface RectangleOptions {
  // Whole cells around the content. Clamped here: see `exportRectangle`.
  margin: number
  layers: Pick<ExportLayers, 'lines'>
}

export interface ExportSceneOptions extends RectangleOptions {
  pxPerCell: number
  layers: ExportLayers
  // Resolved by the caller, appearance and background substitutions already
  // applied. Reading a theme that is not applied means stamping the document
  // element and restoring, which is a DOM operation and does not belong here.
  palette: CanvasPalette
}

// The rectangle the picture covers: what the visible layers draw, plus the
// margin. Null when they draw nothing.
//
// It never unions with `PAGE_HOME`. That floor exists so the canvas has a sheet
// to show when a map is empty, which is a display concern: applied here it would
// export a two-cell map as 21x21 of mostly empty grid, and a map drawn far from
// the origin as a rectangle spanning the void between it and the origin.
//
// The margin is clamped rather than trusted. It arrives from a stored
// preference, and at 0 an outer wall stroked centred on the rectangle's edge
// puts half of every boundary wall off the bitmap.
export function exportRectangle(map: MapModel, options: RectangleOptions): CellBounds | null {
  const margin = clamp(Math.round(options.margin), MARGIN_MIN, MARGIN_MAX)
  return paddedContentBounds(contentBoundsFor(map, { lines: options.layers.lines }), margin)
}

// The bitmap a rectangle needs at a given cell size. Arithmetic on the
// rectangle, so every ticked tab's size is known before any canvas is
// allocated: a batch that fails on the eighth map after drawing seven is the
// worst outcome available and it is entirely avoidable.
export function imageSize(rect: CellBounds, pxPerCell: number): { width: number; height: number } {
  return {
    width: (rect.maxCol - rect.minCol + 1) * pxPerCell,
    height: (rect.maxRow - rect.minRow + 1) * pxPerCell,
  }
}

// Every field of `MapScene` that describes the map rather than somebody looking
// at it. The split is declared this way round on purpose: `SceneInteractionField`
// below is the complement, so a field added to `MapScene` lands in the
// interaction half by default and fails to compile until somebody classifies it.
type SceneContentField =
  | 'camera'
  | 'bounds'
  | 'tileSize'
  | 'dpr'
  | 'annotationScale'
  | 'palette'
  | 'showPage'
  | 'showGrid'
  | 'map'
  | 'showTransitions'
  | 'showTeleportLines'
  | 'showIcons'
  | 'showLines'
  | 'showAllLabels'
  | 'areas'
  | 'lockTypes'
  | 'iconArt'
  | 'teleports'

type SceneInteractionField = Exclude<keyof MapScene, SceneContentField>

// Every trace of interaction, at rest. Spread into the built scene, so the rule
// holds by construction rather than by a builder remembering to blank things.
//
// A hand-written list is exactly what must not be trusted here: `hoveredLabel`
// and `selectedMarkup` are the two a hand-written list drops, and
// `drawMarkupSelection` is called unconditionally and gates only on
// `selectedMarkup` being empty, so a test that selects a room and finds no halo
// passes green while a selected icon still exports one. The type above is what
// makes this list complete; `scene.test.ts` reads it back and counts.
const EMPTY_INTERACTION: Pick<MapScene, SceneInteractionField> = {
  ghost: null,
  brushPreview: null,
  boxPreview: null,
  pendingTeleport: null,
  selected: new Set(),
  selectedRooms: new Set(),
  selectedCells: new Set(),
  handleRoom: null,
  marquee: null,
  hoveredLabel: null,
  selectedMarkup: new Set(),
}

export const INTERACTION_FIELDS = Object.keys(EMPTY_INTERACTION) as SceneInteractionField[]

// The scene for one map's export, or null when that map draws nothing at these
// layer settings.
//
// It takes the project and not the map, and all four of the reasons are the
// canvas's own: a cross-tab teleport is stored once under its origin map and the
// far end is rebuilt from a project-scope index, and areas, lock types and icon
// art are project or catalogue inputs. A builder handed only a map exports
// cross-tab teleport markers as missing.
export function buildExportScene(
  project: ProjectModel,
  mapId: MapId,
  options: ExportSceneOptions,
): MapScene | null {
  const map = project.mapsById.get(mapId)
  if (!map) return null
  const rect = exportRectangle(map, options)
  if (!rect) return null

  const zoom = options.pxPerCell / EXPORT_TILE_SIZE

  return {
    ...EMPTY_INTERACTION,
    // The rectangle lands on the bitmap's top-left corner, which with the zoom
    // above puts its bottom-right corner exactly on `imageSize`.
    camera: { pan: { x: rect.minCol, y: rect.minRow }, zoom },
    tileSize: EXPORT_TILE_SIZE,
    // `bounds` means "the page" to every other consumer, and here it is the
    // export rectangle. That is what makes the page toggle a no-op rather than
    // a missing control: `pageBounds` would union `PAGE_HOME` and break as soon
    // as the margin exceeded `PAGE_PADDING`, painting pasteboard with no grid
    // along the right and bottom edges and grid to the edge on the left and top.
    bounds: rect,
    // A file has no display, so a CSS pixel, a device pixel and an image pixel
    // are the same thing here and every device-pixel rule reads directly onto
    // the output with no translation.
    dpr: 1,
    annotationScale: zoom,
    palette: options.palette,
    // False rather than true. With `bounds` filling the bitmap the two paint
    // the same pixels, since a hidden page lays the page colour down over the
    // whole canvas and spans the grid across it; but this branch does not
    // depend on the camera arithmetic landing exactly on the far edge, so it
    // cannot leave a hairline of pasteboard down the right.
    showPage: false,
    showGrid: options.layers.grid,
    map,
    showTransitions: options.layers.transitions,
    showTeleportLines: options.layers.teleportLines,
    showIcons: options.layers.icons,
    showLines: options.layers.lines,
    showAllLabels: options.layers.allLabels,
    areas: project.areas,
    lockTypes: project.lockTypes,
    iconArt: iconArtCatalogue(),
    teleports: teleportScene(project, mapId),
  }
}
