// Getting a picture of one or several maps out of the app.
//
// Two halves, and the split is the point. `planExport` is arithmetic: it
// answers every ticked tab's rectangle, its size and whether it can be drawn at
// all, without allocating a bitmap. `exportImages` is the run, and it starts
// only once the plan says every ticked tab is fine. Failing in the middle of a
// batch after seven of eight maps have been drawn is the worst outcome
// available here and it is entirely avoidable, because the dimensions are
// arithmetic on the bounds and the cell size.
//
// Nothing here names a format. The descriptor carries the media type, the
// extension, the encode quality and the size estimate; this file branches on
// none of them, which is what makes adding a format one table entry.
//
// Maps render one at a time: `deliverArchive` awaits each source in turn and
// the producer releases its canvas before returning, so twenty ticked tabs
// never hold twenty bitmaps at once.
//
// Bytes leave through `deliver` and nothing above it reaches a provider.

import { readCanvasPaletteAs } from '@/canvas/palette'
import type { MapId } from '@/core/ids'
import type { ProjectModel } from '@/core/types'
import { wasRefused } from '@/core/outcome'
import { t } from '@/i18n'
import { deliverArchive, deliverFile } from '../deliver'
import type { ExportResult } from '../deliver'
import { mapEntryName, uniqueNames } from '../names'
import type { EmptyPredicate } from '../scopeTree'
import { imageCeiling, withinCeiling } from './ceiling'
import { exportPalette } from './palette'
import { buildExportScene, exportRectangle, imageSize } from './scene'
import type { ExportLayers } from './scene'
import { MARGIN_MIN } from './options'
import { renderToBlob } from './raster'
import type { RasterFailure } from './raster'
import type { ImageFormat } from './formats'

export type ExportAppearance = 'light' | 'dark'

export interface ImageExportOptions {
  pxPerCell: number
  margin: number
  layers: ExportLayers
  // Whether the picture carries its background at all. The colour behind a
  // solid one is the project's, resolved here rather than in the dialog:
  // `backgroundColor` and `gridColor` are project settings the exporter has
  // always been said to default from, and the dialog's control is the choice,
  // not the colour.
  transparent: boolean
  appearance: ExportAppearance
}

export interface ImageSize {
  width: number
  height: number
}

// Why a ticked tab cannot be drawn. `draws-nothing` is the case the tickability
// predicate and the rectangle disagree on: a tab holding lines and no rooms is
// tickable, and with the Lines layer off there is nothing left to frame.
export type TabRefusal = 'draws-nothing' | 'too-large'

export interface TabPlan {
  mapId: MapId
  name: string
  // Null exactly when the tab draws nothing at these layers.
  size: ImageSize | null
  refusal: TabRefusal | null
  // Whether the margin is one of the levers on this tab's refusal: true when
  // the same tab fits at the smallest margin. A refusal that names the margin
  // is a refusal naming a control inside a collapsed container, so the dialog
  // opens that container rather than describing something the user cannot see.
  marginIsALever: boolean
}

export interface ExportPlan {
  // Every ticked tab, in tab order, which is also the order the archive's
  // entries take and so the order a `-2` suffix lands in.
  tabs: TabPlan[]
  // The first tab that cannot be drawn, or null when every one can. Nothing is
  // rendered while this is set.
  refused: TabPlan | null
  // The biggest picture the run would produce, which is the one the ceiling
  // bites on first, and what the dialog's dimensions readout shows.
  largest: ImageSize | null
  // What the artefact might weigh, from the format's own per-pixel figure. An
  // approximation shown as one, never checked against a file.
  estimatedBytes: number
}

// A tab with nothing to draw. Rooms or lines: an icon cannot exist without a
// room under it, so it needs no term of its own. Read by the menu entries that
// enable themselves and by the dialog that builds its tree, so an enabled
// entrance cannot open onto a dead picker.
export const imageScopeEmpty: EmptyPredicate = (map) => map.rooms.size === 0 && map.lines.size === 0

export function planExport(
  project: ProjectModel,
  selected: ReadonlySet<MapId>,
  options: ImageExportOptions,
  format: ImageFormat,
): ExportPlan {
  const ceiling = imageCeiling()
  const tabs: TabPlan[] = []

  for (const mapId of orderedIds(project, selected)) {
    const map = project.mapsById.get(mapId)!
    const rect = exportRectangle(map, options)
    if (!rect) {
      tabs.push({
        mapId,
        name: map.name,
        size: null,
        refusal: 'draws-nothing',
        marginIsALever: false,
      })
      continue
    }

    const size = imageSize(rect, options.pxPerCell)
    if (withinCeiling(size, ceiling)) {
      tabs.push({ mapId, name: map.name, size, refusal: null, marginIsALever: false })
      continue
    }

    const tightest = exportRectangle(map, { ...options, margin: MARGIN_MIN })
    tabs.push({
      mapId,
      name: map.name,
      size,
      refusal: 'too-large',
      marginIsALever:
        tightest !== null && withinCeiling(imageSize(tightest, options.pxPerCell), ceiling),
    })
  }

  return {
    tabs,
    refused: tabs.find((tab) => tab.refusal !== null) ?? null,
    largest: largestOf(tabs),
    estimatedBytes: tabs.reduce((total, tab) => total + pixelsOf(tab) * format.bytesPerPixel, 0),
  }
}

export async function exportImages(
  project: ProjectModel,
  selected: ReadonlySet<MapId>,
  options: ImageExportOptions,
  format: ImageFormat,
): Promise<ExportResult> {
  const ids = orderedIds(project, selected)

  // Read once for the whole run. It stamps `data-theme` on the document and
  // restores it, which is two style recalculations however many maps follow.
  const palette = exportPalette(readCanvasPaletteAs(options.appearance), {
    background: options.transparent
      ? { kind: 'transparent' }
      : { kind: 'opaque', color: project.settings.backgroundColor },
    gridColor: project.settings.gridColor,
  })

  const produce = (mapId: MapId) => () => renderOne(project, mapId, options, palette, format)

  // One tab is a bare file named for the map; several are one zip named for the
  // project. The count does not decide the packaging, the caller does: what
  // leaves is named here at both counts and never split back out of an entry
  // name.
  if (ids.length === 1) {
    const map = project.mapsById.get(ids[0]!)!
    return deliverFile(produce(ids[0]!), {
      stem: map.name,
      extension: format.extension,
      mediaType: format.mediaType,
    })
  }

  const names = uniqueNames(
    ids.map((mapId) =>
      mapEntryName(project.mapsById.get(mapId)!.name, project.name, format.extension),
    ),
  )

  return deliverArchive(
    ids.map((mapId, index) => ({ name: names[index]!, produce: produce(mapId) })),
    { stem: project.name },
  )
}

// The bytes for one map. Throws rather than answering a refusal, because
// `deliver` owns all-or-nothing and a rejected producer is how a batch is
// abandoned with nothing written. The message names the map, since a batch that
// failed somewhere is unactionable without knowing where.
async function renderOne(
  project: ProjectModel,
  mapId: MapId,
  options: ImageExportOptions,
  palette: ReturnType<typeof exportPalette>,
  format: ImageFormat,
): Promise<Uint8Array<ArrayBuffer>> {
  const name = project.mapsById.get(mapId)!.name
  const scene = buildExportScene(project, mapId, { ...options, palette })
  if (!scene) throw new Error(failure(name, 'draws-nothing'))

  const outcome = await renderToBlob(scene, format)
  if (wasRefused(outcome)) throw new Error(failure(name, outcome.refused))

  return new Uint8Array(await outcome.arrayBuffer())
}

const REASON_KEYS = {
  'draws-nothing': 'export.image.reason.drawsNothing',
  'too-large': 'export.image.reason.tooLarge',
  'blob-null': 'export.image.reason.blobNull',
  'type-substituted': 'export.image.reason.typeSubstituted',
  'no-context': 'export.image.reason.noContext',
} as const

function failure(map: string, reason: RasterFailure | 'draws-nothing'): string {
  return t('export.image.mapFailed', { map, reason: t(REASON_KEYS[reason]) })
}

// Tab order, whatever order the selection was built in. It is what the archive's
// entries are ordered by, and so what decides which of two maps sharing a name
// takes the `-2`.
function orderedIds(project: ProjectModel, selected: ReadonlySet<MapId>): MapId[] {
  return project.maps.filter((mapId) => selected.has(mapId))
}

function pixelsOf(tab: TabPlan): number {
  return tab.size ? tab.size.width * tab.size.height : 0
}

// Across every tab that has a size, refused ones included: the readout is what
// the refusal message's numbers are read against, so it must not shrink at the
// moment a tab becomes too large.
function largestOf(tabs: TabPlan[]): ImageSize | null {
  let largest: TabPlan | null = null
  for (const tab of tabs) {
    if (!tab.size) continue
    if (!largest || pixelsOf(tab) > pixelsOf(largest)) largest = tab
  }
  return largest?.size ?? null
}
