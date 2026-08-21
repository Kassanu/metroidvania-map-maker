// Wraps the core map model with the state core has no place for: per-tab pan
// and zoom, the active tab id (driven by History, because a tab switch is
// itself an undo step), and name generation. Core takes every name as a
// parameter, so names are rendered here and passed in.
//
// The list, the order, the stored names and the drawn extent all come back out
// of the model through its revision counters.

import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import { PROJECT_SCOPE, dependOn, mapScope, useModelStore } from './model'
import { PAGE_HOME, pageBounds, paddedContentBounds } from '@/canvas/page'
import { centerOn, clampZoom, steppedZoom, type Camera } from '@/canvas/camera'
import { type Bounds, type Pan } from '@/canvas/viewport'
import { contentBounds, type CellBounds } from '@/core/derive/bounds'
import { addMap, deleteMap, duplicateMap, renameMap, reorderMap } from '@/core/ops/maps'
import { t, templateMatcher } from '@/i18n'
import { copyName } from '@/i18n/naming'
import { selectionBounds } from '@/selection/selectionBounds'
import type { MapId } from '@/core/ids'
import type { ObjectRef } from '@/core/types'

// What the tab bar renders. Identity and name both come from the model now, so
// this is a projection rather than a record: there is nothing here to keep in
// step with anything, because there is only one copy.
export interface MapTab {
  id: MapId
  name: string
}

// The active tab, with everything the canvas needs to draw it. Only the active
// one carries a camera and bounds: deriving `pageBounds(contentBounds(map))`
// for every tab on every read would walk every room on every other tab to
// answer a question nothing is asking.
export interface ActiveTab extends MapTab {
  pan: Pan
  zoom: number
  bounds: Bounds
}

// What a tab reads as before it has been looked at. Deliberately not "the
// default view": that is the centred one below, and it cannot be a constant
// because centring is a function of the canvas's size. This is only what the
// maths uses until a size arrives, and it puts world (0,0) at the canvas
// origin.
const UNSEEN_CAMERA: Camera = { pan: { x: 0, y: 0 }, zoom: 1 }

// The canvas's size in CSS pixels, or null until it has one. Held here rather
// than in the component because every camera operation that needs a viewport
// (centring, and Fit) is a camera operation, and the cameras live here.
export interface ViewportSize {
  width: number
  height: number
}

// Generated names are content, not chrome: they're rendered from the active
// locale once, at creation, and then stored as plain text. Reopening under
// another language never rewrites them. The scan below only recognizes names
// in the current locale's shape, so a map named in another language doesn't
// take part in the numbering.
function nextMapName(existingNames: string[]): string {
  const matchMapName = templateMatcher(t('name.map'), { n: '\\d+' })
  const usedNumbers = new Set(
    existingNames
      .map((name) => matchMapName(name)?.n)
      .filter((n): n is string => n !== undefined)
      .map(Number),
  )
  let n = 1
  while (usedNumbers.has(n)) n++
  return t('name.map', { n })
}

export const useTabsStore = defineStore('tabs', () => {
  const model = useModelStore()

  // Keyed by MapId and deliberately never pruned. A camera outliving its map is
  // what makes undoing a tab deletion restore your view along with the content;
  // the set is bounded by the maps created in one session, and a camera is two
  // numbers and a point.
  const cameras = reactive(new Map<MapId, Camera>())

  const viewport = ref<ViewportSize | null>(null)

  const activeId = ref<MapId>(model.project.maps[0])
  // Where the active tab sat in the order, so that when it disappears the
  // fallback can be "whatever slid into its place" rather than "the first tab".
  let activeIndex = 0

  function cameraOf(mapId: MapId): Camera {
    return cameras.get(mapId) ?? UNSEEN_CAMERA
  }

  // Membership is the question, not the value: a tab with an entry has been
  // looked at, whatever it says, so anything that writes a camera stops the
  // centring below from ever firing for that tab again.
  function hasBeenSeen(mapId: MapId): boolean {
    return cameras.has(mapId)
  }

  // A canvas with no size reports zero, which is not a viewport to centre in.
  function setViewport(size: ViewportSize): void {
    viewport.value = size.width > 0 && size.height > 0 ? { ...size } : null
  }

  // The default view for a tab: centred on its content, or on the home
  // rectangle when it has none. So a blank map is centred on world (0,0) and
  // an opened file is centred on its rooms.
  //
  // The content rather than the page, because the page always contains home:
  // a map drawn far from the origin has a page spanning the gap between the
  // two, and centring that would look at the empty middle of the gap rather
  // than at the map.
  //
  // Null when there is nothing to compute it against: no canvas size yet, or
  // no such map.
  // The rectangle a tab is framed on: its padded content, or the home rectangle
  // when it has none. Null when there is no such map.
  function framedBounds(mapId: MapId): CellBounds | null {
    const map = model.project.mapsById.get(mapId)
    if (!map) return null
    return paddedContentBounds(contentBounds(map)) ?? PAGE_HOME
  }

  // A camera looking at the middle of `framed` at the given zoom. Null when
  // there is no canvas size to centre in.
  //
  // Zoom first, then centre: what fills the viewport depends on the zoom, so
  // centring a camera at the old one would be centring the wrong rectangle.
  function centeredOn(mapId: MapId, framed: CellBounds, zoom: number): Camera | null {
    const size = viewport.value
    if (!size) return null
    const middle = {
      x: (framed.minCol + framed.maxCol + 1) / 2,
      y: (framed.minRow + framed.maxRow + 1) / 2,
    }
    return centerOn({ pan: cameraOf(mapId).pan, zoom }, middle, size, model.tileSize)
  }

  function defaultCamera(mapId: MapId, zoom: number): Camera | null {
    const framed = framedBounds(mapId)
    return framed ? centeredOn(mapId, framed, zoom) : null
  }

  // Where a tab opens. Zoom is untouched, because where to look and how close
  // are different questions and a project opening at some computed percentage
  // rather than at 100% would make the readout the first thing to interpret.
  function centerIfUnseen(mapId: MapId): void {
    if (cameras.has(mapId)) return
    const camera = defaultCamera(mapId, cameraOf(mapId).zoom)
    if (camera) setCameraOf(mapId, camera)
  }

  // The zoom that makes `framed` fill the canvas: the smaller of the two axis
  // ratios, because the larger one overflows the other axis. Clamped here
  // rather than by the caller, so what gets centred is the zoom that was
  // actually applied.
  function zoomFitting(framed: CellBounds): number | null {
    const size = viewport.value
    if (!size) return null
    const scale = model.tileSize
    const cols = framed.maxCol - framed.minCol + 1
    const rows = framed.maxRow - framed.minRow + 1
    return clampZoom(Math.min(size.width / (cols * scale), size.height / (rows * scale)))
  }

  // Fit frames the same rectangle a tab opens on, at the zoom that fills the
  // canvas. Open, Reset View and Fit are one rectangle and three zooms: the
  // first keeps the zoom, the second sets it to 1, this one computes it.
  function fitToContent(mapId: MapId): void {
    const framed = framedBounds(mapId)
    if (!framed) return
    const zoom = zoomFitting(framed)
    if (zoom === null) return
    const camera = defaultCamera(mapId, zoom)
    if (camera) setCameraOf(mapId, camera)
  }

  // Fit the selection instead of the map. Padded like the page, so a framed
  // selection has the same breathing room a framed map does.
  //
  // Refuses rather than falling back to the map when there is nothing to
  // frame: a command called To Selection that framed something else on an
  // empty selection would be lying about what it did.
  function fitToSelection(mapId: MapId, refs: readonly ObjectRef[]): void {
    const map = model.project.mapsById.get(mapId)
    if (!map) return
    const framed = paddedContentBounds(selectionBounds(refs, map))
    if (!framed) return
    const zoom = zoomFitting(framed)
    if (zoom === null) return
    const camera = centeredOn(mapId, framed, zoom)
    if (camera) setCameraOf(mapId, camera)
  }

  // Reset View is the default view applied on demand, rather than a second
  // idea of where to look: a command that put you somewhere other than where
  // the tab opened would be a third view to learn. Zoom and pan land in one
  // write, so no intermediate frame renders.
  //
  // Zoom still returns to 1 when there is no canvas size to centre against.
  // Half of the command working beats none of it, and the pan is meaningless
  // without a viewport anyway.
  function resetView(mapId: MapId): void {
    const camera = defaultCamera(mapId, 1)
    if (camera) setCameraOf(mapId, camera)
    else setZoom(mapId, 1)
  }

  function setCameraOf(mapId: MapId, camera: Camera): void {
    cameras.set(mapId, { pan: camera.pan, zoom: clampZoom(camera.zoom) })
  }

  const tabs = computed<MapTab[]>(() => {
    dependOn(model.structureRev)
    const project = model.project
    return project.maps.map((id) => ({ id, name: project.mapsById.get(id)!.name }))
  })

  const activeTab = computed<ActiveTab | undefined>(() => {
    // `mapRev` is what makes the canvas repaint. Painting a room inside the
    // existing page bounds moves no bound, no camera value and no id, so a
    // canvas watching only the derived values here would never redraw. The room
    // would not appear, and `CanvasRegion.test.ts` pins exactly that.
    dependOn(model.structureRev, model.mapRev(activeId.value))
    const map = model.project.mapsById.get(activeId.value)
    if (!map) return undefined
    const camera = cameraOf(map.id)
    return {
      id: map.id,
      name: map.name,
      pan: camera.pan,
      zoom: camera.zoom,
      // Derived from the map, never stored.
      bounds: pageBounds(contentBounds(map)),
    }
  })

  // The active tab must always name a live map, and four separate paths can
  // take it away: deleting it, undoing the add that created it, redoing a
  // delete, and opening a different project entirely. Rather than fixing up
  // each one, this runs after any change to the map list. It runs synchronously,
  // so the invalid state is never observable outside this function.
  //
  // `History` has usually already activated the right tab through
  // `applyEffect` by the time this runs, in which case it finds a live id and
  // only refreshes the remembered index.
  function reconcileActive(): void {
    const maps = model.project.maps
    const at = maps.indexOf(activeId.value)
    if (at !== -1) {
      activeIndex = at
      return
    }
    const fallback = maps[Math.min(activeIndex, maps.length - 1)]
    if (!fallback) return
    activeId.value = fallback
    activeIndex = maps.indexOf(fallback)
  }

  // A camera belongs to a session with one project, not to the ids inside it.
  // A file carries its own map ids, so reopening one in the same session would
  // otherwise find its cameras still here, take every tab for one already
  // looked at, and never look at the content. Undo is untouched: it never
  // swaps the project, so a camera still outlives the tab it belongs to.
  watch(
    () => model.projectKey,
    () => cameras.clear(),
  )

  // Watching the project identity as well as its revision, because a swap is
  // the one change a counter cannot report: the incoming project brings its own
  // counters, and a file freshly loaded from disk starts at the same zeroes the
  // outgoing one may still have been sitting on. Watched together so either
  // kind of change lands in the same place.
  watch([() => model.project, () => model.structureRev], reconcileActive, { flush: 'sync' })

  // Undo/redo of a map-scoped step lands here. It must not record a fresh
  // navigation. `History.applyEffect` suppresses that, which is why the seam
  // routes through it rather than calling this directly.
  model.onActivateMap((mapId) => {
    activeId.value = mapId
    activeIndex = model.project.maps.indexOf(mapId)
  })

  function names(): string[] {
    return tabs.value.map((tab) => tab.name)
  }

  // Switching tabs is a user navigation and goes on the undo stack. Selecting
  // the tab you are already on is not a switch.
  function activate(mapId: MapId): void {
    if (mapId === activeId.value) return
    const from = activeId.value
    activeId.value = mapId
    activeIndex = model.project.maps.indexOf(mapId)
    model.pushNavigation(from, mapId)
  }

  // Activating a tab we just created is part of creating it, not a separate
  // navigation the user made. Pushing one would cost a second Ctrl+Z to get
  // past before the add itself came off the stack.
  function activateSilently(mapId: MapId): void {
    activeId.value = mapId
    activeIndex = model.project.maps.indexOf(mapId)
  }

  function addTab(): void {
    const map = model.run(t('history.addMap'), PROJECT_SCOPE, (tx) => {
      const created = addMap(tx, model.project, nextMapName(names()))
      // Retarget the step at the map it created, now that there is an id to
      // name. Redo then returns the user to the tab it brings back, and undo
      // finds it gone and moves nobody (History.liveMap).
      tx.scope = mapScope(created.id)
      return created
    })
    activateSilently(map.id)
  }

  // Inserts the duplicate right after the original (Google-Sheets style) and
  // activates it. Instant and unconfirmed. Drops cross-tab teleports:
  // `linksDroppedByDuplicate` reports how many.
  function duplicateTab(mapId: MapId): void {
    const source = model.project.mapsById.get(mapId)
    if (!source) return
    const copy = model.run(t('history.duplicateMap'), PROJECT_SCOPE, (tx) => {
      const created = duplicateMap(tx, model.project, mapId, copyName(source.name, names()))
      tx.scope = mapScope(created.id)
      return created
    })
    setCameraOf(copy.id, cameraOf(mapId))
    activateSilently(copy.id)
  }

  // Deleting the last remaining tab replaces it with a fresh blank "Map N"
  // rather than leaving the project with zero tabs. Core does that itself, given
  // a name to use. The caller confirms the deletion; by the time this runs the
  // decision is made.
  function deleteTab(mapId: MapId): void {
    if (!model.project.mapsById.has(mapId)) return
    // Scoped to the map being deleted so undo brings the user back to the tab
    // it restores. On redo the map is gone, `History` hands back no tab to
    // activate, and `reconcileActive` picks the neighbour.
    model.run(t('history.deleteMap'), mapScope(mapId), (tx) =>
      deleteMap(tx, model.project, mapId, nextMapName([])),
    )
  }

  function renameTab(mapId: MapId, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    if (!model.project.mapsById.has(mapId)) return
    model.run(t('history.renameMap'), mapScope(mapId), (tx) =>
      renameMap(tx, model.project, mapId, trimmed),
    )
  }

  // `toIndex` is the target's index in the order before removal. Removing the
  // tab and then inserting at that same index lands it on the correct side of
  // the target (after it when dragging forward, before it when dragging
  // backward) without an off-by-one either way.
  function reorderTab(mapId: MapId, toIndex: number): void {
    if (!model.project.mapsById.has(mapId)) return
    model.run(t('history.reorderMap'), mapScope(mapId), (tx) =>
      reorderMap(tx, model.project, mapId, toIndex),
    )
  }

  function setPan(mapId: MapId, pan: Pan): void {
    setCameraOf(mapId, { pan, zoom: cameraOf(mapId).zoom })
  }

  function setZoom(mapId: MapId, value: number): void {
    setCameraOf(mapId, { pan: cameraOf(mapId).pan, zoom: value })
  }

  // Pan and zoom together, for the camera operations that change both. Anything
  // anchored (zoom-to-cursor) moves the pan to hold the anchor still. Applying
  // them separately would render an intermediate frame.
  function setCamera(mapId: MapId, camera: Camera): void {
    setCameraOf(mapId, camera)
  }

  function zoomIn(mapId: MapId): void {
    setZoom(mapId, steppedZoom(cameraOf(mapId).zoom, 1))
  }

  function zoomOut(mapId: MapId): void {
    setZoom(mapId, steppedZoom(cameraOf(mapId).zoom, -1))
  }

  function resetZoom(mapId: MapId): void {
    setZoom(mapId, 1)
  }

  return {
    tabs,
    activeTab,
    activeTabId: computed(() => activeId.value),
    // Read access to any tab's camera, not just the active one. The canvas only
    // ever draws the active tab, but the store owns all of them, and a tab that
    // has never been panned reads as the default rather than as missing.
    cameraOf: computed(() => (mapId: MapId) => cameraOf(mapId)),

    activate,
    addTab,
    duplicateTab,
    deleteTab,
    renameTab,
    reorderTab,

    setViewport,
    centerIfUnseen,
    resetView,
    fitToContent,
    fitToSelection,
    hasBeenSeen,

    setPan,
    setZoom,
    setCamera,
    zoomIn,
    zoomOut,
    resetZoom,
  }
})
