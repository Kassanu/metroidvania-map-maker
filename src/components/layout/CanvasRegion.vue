<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { useTabsStore } from '@/stores/tabs'
import { mapScope, useModelStore } from '@/stores/model'
import { useThemeStore } from '@/stores/theme'
import { useCanvasViewStore } from '@/stores/canvasView'
import { useModeStore } from '@/stores/mode'
import { useToolsStore } from '@/stores/tools'
import { usePendingTeleportStore } from '@/stores/pendingTeleport'
import { useArmedIconStore } from '@/stores/armedIcon'
import { useMarkupDefaultsStore } from '@/stores/markupDefaults'
import { useSelectionStore } from '@/stores/selection'
import { resolveZone, zoneTolerances, type DrawZone } from '@/canvas/drawZone'
import { pushEscHandler } from '@/hotkeys/escStack'
import { useHotkeyAction } from '@/hotkeys/useHotkeyAction'
import { DEFAULT_PAN, screenToWorld, worldToScreen, type ScreenPoint } from '@/canvas/viewport'
import { pageBounds } from '@/canvas/page'
import { centerOn, panByScreen, wheelZoom } from '@/canvas/camera'
import {
  doorCursor,
  doorRefOf,
  gestureOriginCell,
  resolveDoorTarget,
  type DoorTarget,
} from '@/canvas/doorTarget'
import {
  armedPlacementAt,
  markupCursor,
  markupRefOf,
  resolveMarkupTarget,
  type MarkupTarget,
} from '@/canvas/markupTarget'
import IconPickerPopover from './IconPickerPopover.vue'
import { beginBoxDrag, type BoxDrag } from '@/gestures/boxDrag'
import { beginLineStroke, type LineStroke } from '@/gestures/lineStroke'
import { beginIconDrag, type IconDrag } from '@/gestures/iconDrag'
import { beginLinePeel } from '@/gestures/linePeel'
import { registerIconDropTarget } from '@/gestures/iconDropTarget'
import { movesOnDrag } from '@/gestures/moveOnDrag'
import { deleteTransition } from '@/core/ops/doors'
import { deleteRooms } from '@/core/ops/rooms'
import {
  createLine,
  deleteIcon,
  deleteLine,
  extendLine,
  peelLine,
  placeIcon,
  repositionIcon,
  translateLine,
} from '@/core/ops/markup'
import { cellCentre, teleportScene } from '@/canvas/teleports'
import { RULER_THICKNESS } from '@/canvas/renderRuler'
import { brushOffset } from '@/canvas/brush'
import { iconArtCatalogue } from '@/icons/registry'
import { beginPaintStroke } from '@/gestures/paintStroke'
import { beginEraseStroke } from '@/gestures/eraseStroke'
import { beginRunResize, handleGrabAllowed } from '@/gestures/runResize'
import { beginInnerWallStroke, beginInnerWallErase } from '@/gestures/innerWallStroke'
import { strokeActionFor, type StrokeAction } from '@/gestures/strokeAction'
import { liveRows, visibleHandles } from '@/gestures/subMode'
import { startPointerDrag } from '@/composables/pointerDrag'
import { DRAG_DEAD_ZONE } from '@/config/constants'
import { cellKey, parseCell } from '@/core/cell'
import type { GhostGesture } from '@/gestures/ghostGesture'
import type { MapModel } from '@/core/types'
import type { BrushPreview, HoveredHandle } from '@/canvas/renderMap'
import type { WorldPoint } from '@/canvas/stroke'
import type { IconId, LineId, MapId, RoomId, TransitionId } from '@/core/ids'
import type { CellKey } from '@/core/cell'
import type { IconRegistryEntry } from '@/icons/registry'
import { useCanvasRenderer } from '@/composables/useCanvasRenderer'
import { useResizeObserver } from '@/composables/useResizeObserver'
import { useSystemColorScheme } from '@/composables/useSystemColorScheme'
import { t } from '@/i18n'

// Thin adapter: holds the canvas refs, turns DOM events into camera
// operations, and asks the renderer to repaint. All drawing and coordinate
// maths lives in src/canvas/ (pure, testable without jsdom); the scheduling
// and device-pixel sizing live in useCanvasRenderer.

const tabsStore = useTabsStore()
const model = useModelStore()
const themeStore = useThemeStore()
const canvasView = useCanvasViewStore()
const modeStore = useModeStore()
const tools = useToolsStore()
const pendingTeleport = usePendingTeleportStore()
const armedIcon = useArmedIconStore()
const markupDefaults = useMarkupDefaultsStore()
const selection = useSelectionStore()

const container = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const topRulerCanvas = ref<HTMLCanvasElement | null>(null)
const leftRulerCanvas = ref<HTMLCanvasElement | null>(null)

const cursorCell = ref<{ col: number; row: number } | null>(null)

// Where the brush would land, or null when there is nothing to show. A plain
// `let` rather than a ref: the canvas is not driven by Vue reactivity, and the
// pointer handler decides for itself when this is worth a repaint, see
// `updateBrushPreview`.
let brushPreview: BrushPreview | null = null
// The last pointer position over the canvas, kept so a tool change (resizing
// the brush with `[`/`]`, locking the sub-mode) can update what is under the
// cursor without waiting for the pointer to twitch. Both coordinate spaces,
// because the brush preview works in world units and the zone resolver in
// screen pixels.
let hoverWorld: WorldPoint | null = null
let hoverScreen: ScreenPoint | null = null
// Which of the active room's handles the pointer is over. Idle handles are
// faint hints; this one is drawn at full grab size.
let hoveredHandle: HoveredHandle | null = null
// The markup object whose label is showing because the pointer is on it, or
// null. Another plain `let` gated by its own updater, see `updateHoveredLabel`.
let hoveredLabel: string | null = null
// The cell the vertex targets are revealed around. Tracked separately from
// `hoverWorld` because it is what the repaint is gated on.
let revealCell: { x: number; y: number } | null = null
// The resize cursor for an edge-run hover. A ref rather than a plain `let`
// because unlike everything else on this pointer path it is DOM state, so Vue
// does have to notice it change.
const zoneCursor = ref<string | null>(null)

// The gesture in progress: paint, erase or resize. A plain `let`, not a ref: it
// holds core objects (an open transaction, a live cell set) that must not be
// wrapped in reactive proxies, and nothing here needs Vue to notice it change,
// since the gesture calls `draw()` itself when there is something new to show.
// Typed as the shared `GhostGesture`, so the scene below never has to know
// which one is live: all three answer the ghost question, two of them with
// "nothing".
let gesture: GhostGesture | null = null
// The same gesture again when it is a box drag, kept separately because its
// preview is the one thing `GhostGesture` deliberately does not expose: every
// other gesture's pending result is visible in the speculative model, and this
// one's rectangle is not.
let boxDrag: BoxDrag | null = null
// The icon a drag is currently moving, or null. A ref rather than a plain
// `let` because the cursor is DOM state: unlike the gestures above, this one
// has to make Vue re-evaluate the binding while the pointer is down.
const draggingIconId = ref<IconId | null>(null)

const { draw, resize, repaintForTheme } = useCanvasRenderer(
  { container, main: canvas, topRuler: topRulerCanvas, leftRuler: leftRulerCanvas },
  () => {
    const tab = tabsStore.activeTab
    return {
      camera: { pan: tab?.pan ?? DEFAULT_PAN, zoom: tab?.zoom ?? 1 },
      tileSize: model.tileSize,
      // The model is outside Vue reactivity, so these are read fresh on every
      // draw rather than watched. What triggers the draw is the revision
      // counters the tabs store depends on: see the watch below.
      map: tab ? (model.project.mapsById.get(tab.id) ?? null) : null,
      areas: model.project.areas,
      lockTypes: model.project.lockTypes,
      // The whole catalogue, not just the types in use: resolving per icon here
      // would put the lookup on the draw path for no gain, and the map is built
      // once.
      iconArt: iconArtCatalogue(),
      // Both ends of every teleport touching this tab, including the far end of
      // one stored on another map. Prepared here because it is the only layer
      // that needs the whole project: see `MapScene.teleports`.
      teleports: tab ? teleportScene(model.project, tab.id) : { ends: [], lines: [] },
      // Cells a live gesture is about to take. Everything else about the
      // pending result is already in `map` above: a gesture applies
      // speculatively, so mid-drag the model is what release would produce.
      ghost: gesture ? { absorbing: gesture.absorbing } : null,
      brushPreview,
      boxPreview: boxDrag?.preview ?? null,
      // Asked per-map rather than read as a flag, because the pending origin
      // survives tab switches: it is exactly the state that can be pending on
      // another tab while this one draws, and a marker on the wrong map would
      // be a teleport endpoint that is not there.
      pendingTeleport: tab ? pendingTeleport.originOn(tab.id) : null,
      // Only the transitions in the selection, and only when the selection
      // belongs to this tab: the store is per-tab, so a stale id from another
      // map must not halo whatever happens to share it here. Rooms, icons and
      // lines can be in the same selection; the renderer takes transitions.
      selected: selectedTransitions(),
      // Handles are drawn at the size `drawZone` grabs them at: the tolerances
      // come from there rather than being chosen here, so the handle and the
      // thing it grabs cannot disagree.
      handleRoom: (() => {
        // A handle is drawn exactly when a press on it would do something,
        // applied to the mode rather than the sub-mode lock: in Door mode a
        // press on a resize handle resizes nothing.
        if (!tab || modeStore.active !== 'draw') return null
        const roomId = handleRoomId()
        const room = roomId ? model.project.mapsById.get(tab.id)?.rooms.get(roomId) : null
        if (!room) return null
        const camera = { pan: tab.pan, zoom: tab.zoom }
        return {
          room,
          ...zoneTolerances({ camera, tileSize: model.tileSize }),
          hovered: hoveredHandle,
          pointerCell: revealCell,
          handles: visibleHandles(tools.subMode),
        }
      })(),
      // The page the active map draws on, derived from its content. The
      // fallbacks here are for the unreachable no-active-tab case only: the
      // store keeps `activeTabId` on a live map, so they match what a blank
      // map would give rather than collapsing the page to a single cell.
      bounds: tab?.bounds ?? pageBounds(null),
      // Door mode overrides the master toggle: entering Door mode means you are
      // working on transitions, so they stay visible there regardless of the
      // toggle. Hiding them instead would leave the objects live but invisible:
      // a press on a hidden door would miss it, start a teleport instead, and
      // be refused by the one-per-cell rule with nothing on screen to explain
      // why.
      //
      // Only the master is overridden. A teleport line is not a target in any
      // mode, so the sub-toggle for lines stays honoured.
      showTransitions: canvasView.showTransitions || modeStore.active === 'door',
      showTeleportLines: canvasView.showTeleportLines,
      // The same override for the same reason, but reaching further: Markup
      // mode forces the master *and* both sub-toggles, because unlike a
      // teleport line each of these gates something a press lands on.
      showIcons: markupForced() || (canvasView.showMarkup && canvasView.showIcons),
      showLines: markupForced() || (canvasView.showMarkup && canvasView.showLines),
      showAllLabels: canvasView.showAllLabels,
      hoveredLabel,
      selectedMarkup: selectedMarkup(),
      showGrid: canvasView.showGrid,
      showRulers: canvasView.showRulers,
      rulerUnits: canvasView.rulerUnits,
    }
  },
)

// The room whose handles are drawn, hovered and grabbed: exactly one room
// selected on the tab being looked at. Every reader goes through here, so the
// renderer, the hit-test and the touch two-step cannot disagree about which
// room that is, and a multi-room selection answers null for all three.
function handleRoomId(): RoomId | null {
  const tab = tabsStore.activeTab
  return tab ? selection.soleRoomOn(tab.id) : null
}

// Whether Markup mode is overriding the markup layer toggles. A function rather
// than a computed because the scene above is already recomputed per draw, and
// this is one comparison.
function markupForced(): boolean {
  return modeStore.active === 'markup'
}

// The selected transitions on the tab being drawn, as a set for the renderer.
// The store's selectors answer only for the map asked about, so a selection
// belonging to another tab halos nothing here.
const EMPTY_SELECTION: ReadonlySet<TransitionId> = new Set()
const EMPTY_MARKUP_SELECTION: ReadonlySet<string> = new Set()

function selectedTransitions(): ReadonlySet<TransitionId> {
  const tab = tabsStore.activeTab
  if (!tab) return EMPTY_SELECTION
  const ids = selection.transitionsOn(tab.id)
  return ids.length === 0 ? EMPTY_SELECTION : new Set(ids)
}

// Icons and lines in one set, because the renderer takes the markup layer as a
// unit. Kept separate from the transitions above rather than widened into one
// set, since the two are gated behind different layer toggles and would have to
// be split apart again there.
function selectedMarkup(): ReadonlySet<string> {
  const tab = tabsStore.activeTab
  if (!tab) return EMPTY_MARKUP_SELECTION
  const ids: string[] = [...selection.iconsOn(tab.id), ...selection.linesOn(tab.id)]
  return ids.length === 0 ? EMPTY_MARKUP_SELECTION : new Set(ids)
}

// Pointer position within the canvas: what anchored zoom and cell tracking
// both work from.
function localPoint(event: MouseEvent): ScreenPoint | null {
  const rect = container.value?.getBoundingClientRect()
  if (!rect) return null
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function handleWheel(event: WheelEvent) {
  const tab = tabsStore.activeTab
  const anchor = localPoint(event)
  if (!tab || !anchor) return
  event.preventDefault()

  // Ctrl/Cmd + wheel = zoom; a trackpad pinch also arrives as ctrl+wheel:
  // browsers synthesize ctrlKey on pinch specifically so apps can tell it
  // apart from two-finger scroll.
  if (event.ctrlKey || event.metaKey) {
    tabsStore.setCamera(tab.id, wheelZoom(tab, event.deltaY, anchor, model.tileSize))
    return
  }

  // Plain wheel / trackpad two-finger scroll pans both axes (Figma/draw.io
  // convention).
  tabsStore.setCamera(tab.id, panByScreen(tab, event.deltaX, event.deltaY, model.tileSize))
}

// The world point under the pointer: where a gesture works, as opposed to the
// cell under it, which is only what the coords overlay reports.
function worldPoint(event: PointerEvent) {
  const point = localPoint(event)
  const tab = tabsStore.activeTab
  if (!point || !tab) return null
  return screenToWorld(point.x, point.y, tab, model.tileSize)
}

// Door mode's press resolves to a click or a drag only once the pointer comes
// back up: a drag once it has left the origin cell and crossed the pixel
// dead-zone, a click on the origin cell short of either. `startPointerDrag`'s
// dead-zone keeps `onMove` silent until crossed, and `leftCell` below latches
// once the pointer leaves the cell, so it can only trip after the dead-zone
// already has: one flag is the conjunction. A drag that leaves the cell and
// returns to it is still a drag that classified to nothing, not a click.
//
// A drag from any room cell always starts a box gesture, even from an existing
// door or a teleport endpoint, and always creates a new transition. A press on
// no room at all (bare grid, or the gap side of an elevator's facing edge)
// starts no box; see `gestureOriginCell`. It is still tracked as a potential
// click, because a click on bare grid matters while a teleport is pending:
// `handleDoorClick` leaves it pending rather than treating it as a no-op.
function handleDoorPress(event: PointerEvent) {
  // Which route this press belongs to: right button, stylus eraser end, or the
  // primary button while the erase toggle is on, the same three routes Draw
  // mode's strokes use. Reusing `strokeActionFor` rather than checking
  // `button !== 0` here is what gives Door mode the toggle and the eraser end
  // for free, and the toggle is the only erase route touch has at all.
  //
  // `null` is the middle button, which must start nothing rather than fall
  // through to a box.
  const action = strokeActionFor(event, tools.erase)
  if (!action) return

  const tab = tabsStore.activeTab
  const local = localPoint(event)
  if (!tab || !local) return
  // Resolved once, at press time, and reused on release: that is what a click
  // on the origin cell means. Re-resolving on pointerup would read wherever the
  // pointer drifted to inside the dead-zone.
  const target = doorTargetAt(local)
  if (!target) return
  // Read at press time with the target, so a click means the modifier the user
  // was holding when they pressed rather than whatever they let go of first.
  const additive = event.shiftKey
  event.preventDefault()

  if (action === 'erase') {
    deleteTransitionAt(tab.id, target)
    return
  }

  const origin = gestureOriginCell(target)
  const box = origin ? beginBoxDrag(tab.id, origin, draw) : null
  if (box) {
    gesture = box
    boxDrag = box
  }

  // The left-the-cell half of the rule. Latched rather than compared on release,
  // because "has left" is a fact about the whole drag, not about where it ended.
  let leftCell = false

  const accepted = startPointerDrag(event, {
    buttons: [event.button],
    // The dead-zone half. The value is the primitive's business, not this
    // file's: see `DRAG_DEAD_ZONE`.
    deadZone: DRAG_DEAD_ZONE,
    resolveTarget: () => container.value,
    onMove: (context) => {
      const point = worldPoint(context.event)
      if (!point) return
      if (cellKey(Math.floor(point.x), Math.floor(point.y)) !== target.cell) leftCell = true
      box?.moveTo(point)
    },
    // Commits rather than aborts on pointercancel, like every other gesture: the
    // OS taking the pointer is not the user changing their mind. A box that
    // classified to nothing commits an empty transaction, which the seam drops,
    // so no undo step appears.
    onEnd: () => {
      if (box) {
        // Cancelled rather than committed when it was a click: the box never
        // moved, so the transaction is empty either way and the seam would drop
        // it, but a click is not a drag that did nothing, and saying so here
        // keeps the two columns of the table distinguishable in this file.
        if (leftCell) box.commit()
        else box.cancel()
        if (gesture === box) gesture = null
        if (boxDrag === box) boxDrag = null
      }
      if (!leftCell) handleDoorClick(target, additive)
      draw()
    },
  })

  if (!accepted && box) {
    box.cancel()
    gesture = null
    boxDrag = null
  }
}

// The Erase column of the Door table: two rows doing something, two doing
// nothing at all.
//
// Erase or right-click on a non-transition does nothing, the deliberate
// opposite of Draw mode's erase-priority rule, where a right-press that misses
// an inner wall still erases the cell under it. Here a miss is a miss: Door
// mode never destroys a room, so a right-drag across the map is harmless in a
// way the same drag in Draw mode is not.
//
// Deletes on press rather than on release: there is no click-vs-drag question
// to answer since erase has only one gesture, and it matches Draw mode's
// erase, which also takes effect under the pointer immediately. `Ctrl+Z` is
// the safety net there too.
function deleteTransitionAt(mapId: MapId, target: DoorTarget) {
  if (target.kind !== 'door' && target.kind !== 'teleport') return
  const map = model.project.mapsById.get(mapId)
  if (!map) return

  // Scoped to the tab the user acted on, not to the map that stores the
  // transition, which differs from `pendingTeleport.complete` on purpose. A
  // cross-tab teleport can be deleted from its far end, where the marker is
  // derived rather than stored; undo should put that marker back in front of
  // the person who removed it, rather than jumping to a tab they may never have
  // opened. `deleteTransition` finds the owning map itself.
  model.run(t('history.deleteTransition'), mapScope(mapId), (tx) =>
    deleteTransition(tx, model.project, map, target.id),
  )
}

// The Click column of the Door table, in precedence order.
//
// A pending teleport takes the click before anything else does. A valid
// completion is a click in a different room, on the same tab or another; an
// invalid second click is ignored and the teleport stays pending, uniformly on
// the origin tab and any other tab. Without that precedence, every row below
// would claim some of those clicks instead: bare grid would do nothing, a far
// marker would navigate, a room cell would start a second teleport, so the same
// misclick would answer differently depending on where it landed.
//
// The cost is that far-marker navigation is unavailable while a teleport is
// pending. Switching tabs by the tab bar is still allowed and is the route that
// stays open.
//
// Below that, select beats create: every row hands its ref to the shared
// policy, and only a plain click that found nothing goes on to start a
// teleport. A shift-click edits the selection and starts nothing.
function handleDoorClick(target: DoorTarget, additive: boolean) {
  const tab = tabsStore.activeTab
  if (!tab) return

  if (pendingTeleport.isPending) {
    pendingTeleport.complete(tab.id, target.cell)
    return
  }

  const ref = doorRefOf(target)
  selection.clickSelect(ref, tab.id, additive)
  if (ref || additive) return
  // All gestures start on a room cell; clicking bare grid deselects and does
  // nothing else.
  if (target.kind === 'room') pendingTeleport.start(tab.id, target.cell)
}

// The far end shows a marker cell with the destination tab's first letter;
// double-clicking it opens that tab centred on the other end.
//
// Double-click rather than single, since a single click already selects the
// transition and one click cannot also navigate. Double-click is the
// conventional "open" gesture, and putting navigation there means every
// transition behaves identically on a single click.
//
// A plain DOM `dblclick` rather than a row of the press dispatch: it fires only
// after two clicks that were already classified as clicks by the pointer path
// above, so the click-vs-drag rule is honoured before this is ever reached.
function handleDoubleClick(event: MouseEvent) {
  if (modeStore.active !== 'door') return
  const local = localPoint(event)
  const target = local && doorTargetAt(local)
  // Only a teleport end whose other end is on another tab leads anywhere; a
  // same-map one has both ends on screen already.
  if (target?.kind !== 'teleport' || !target.leadsTo) return

  event.preventDefault()
  openTeleportEnd(target.leadsTo)
}

// Markup's drag column, as one row-to-gesture decision.
//
// A drag from a line's end extends that line; a drag from anywhere else draws a
// new one, including from the body of an existing line, which is what makes
// overlapping lines drawable at all. An icon cell starts nothing here: dragging
// an icon moves it, which is a gesture of its own.
//
// Lines have no room owner, so no row is refused for standing on bare grid.
// The icon row of the drag column: a drag moves the icon, anywhere in a room
// including into another one. Ownership follows the cell, so there is no
// cascade and nothing to re-validate.
//
// The block/replace rule is the same one placement uses, and `repositionIcon`
// applies it: the icon's own cell never counts as occupied, so a drag out and
// back is a no-op rather than a collision with itself.
function beginMarkupIconDrag(target: MarkupTarget): IconDrag | null {
  const tab = tabsStore.activeTab
  const map = tab ? model.project.mapsById.get(tab.id) : undefined
  if (!tab || !map || target.kind !== 'icon') return null

  const iconId = target.id
  return beginIconDrag({
    mapId: tab.id,
    from: target.cell,
    label: t('history.moveIcon'),
    onChange: draw,
    apply: (tx, to) => {
      repositionIcon(tx, map, iconId, to, { replace: markupDefaults.replace })
    },
  })
}

// The line-body row of the drag column, for a line that is already selected:
// the drag translates the whole line rather than drawing a new one over it.
// Unselected, the row still draws, which is what makes overlapping lines
// drawable at all, so starting a new line from a selected body needs a deselect
// first.
//
// A cell drag rather than a stroke: the quantity is the delta between the
// origin cell and the pointer's, replaced on every move, so backtracking to the
// origin translates by nothing. `translateLine` guards that case itself, which
// is why the gesture does not.
function beginMarkupLineDrag(target: MarkupTarget): IconDrag | null {
  const tab = tabsStore.activeTab
  const map = tab ? model.project.mapsById.get(tab.id) : undefined
  if (!tab || !map || target.kind !== 'line-body') return null
  if (!movesOnDrag({ kind: 'line', id: target.id })) return null

  const lineId = target.id
  const origin = parseCell(target.cell)
  return beginIconDrag({
    mapId: tab.id,
    from: target.cell,
    label: t('history.moveLine'),
    onChange: draw,
    apply: (tx, to) => {
      const at = parseCell(to)
      translateLine(tx, map, lineId, at.x - origin.x, at.y - origin.y)
    },
  })
}

function beginMarkupLine(target: MarkupTarget): LineStroke | null {
  const tab = tabsStore.activeTab
  const map = tab ? model.project.mapsById.get(tab.id) : undefined
  if (!tab || !map) return null
  if (target.kind === 'icon') return null

  if (target.kind === 'line-end') {
    const { id, atStart } = target
    return beginLineStroke({
      mapId: tab.id,
      // The line's own endpoint, not the pressed cell: the grab radius reaches
      // beyond the cell the endpoint sits in, so a press near it must extend
      // from the end rather than from wherever the pointer landed.
      origin: endpointCellOf(map, id, atStart),
      label: t('history.extendLine'),
      onChange: draw,
      apply: (tx, points) => {
        extendLine(tx, map, id, atStart, [...points].slice(1))
      },
    })
  }

  const defaults = markupDefaults.lineDefaults
  return beginLineStroke({
    mapId: tab.id,
    origin: target.cell,
    label: t('history.drawLine'),
    onChange: draw,
    apply: (tx, points) => {
      createLine(tx, map, [...points], defaults)
    },
  })
}

function endpointCellOf(map: MapModel, id: LineId, atStart: boolean): CellKey {
  const points = map.lines.get(id)!.points
  return atStart ? points[0] : points[points.length - 1]
}

// Markup's erase column. All three erase routes reach it, because they all
// resolve through `strokeActionFor` first: right-click, the pen's eraser end,
// and the primary button while the toggle is on.
//
// Two rows act. An icon deletes on the press, with no drag to wait for. A
// line's end starts a peel. A line's body erases nothing at all: peeling
// works from an end and a line cannot be split, so the only thing left to fall
// through to would be deleting the whole line, and a right-click aimed a cell
// wide of an end would then destroy it. Room cells and bare grid hold nothing.
function beginMarkupErase(event: PointerEvent, target: MarkupTarget) {
  const tab = tabsStore.activeTab
  const map = tab ? model.project.mapsById.get(tab.id) : undefined
  if (!tab || !map) return

  if (target.kind === 'icon') {
    const iconId = target.id
    model.run(t('history.deleteIcon'), mapScope(tab.id), (tx) => deleteIcon(tx, map, iconId))
    return
  }
  if (target.kind !== 'line-end') return

  const { id, atStart } = target
  const line = map.lines.get(id)
  if (!line) return

  const peel = beginLinePeel({
    mapId: tab.id,
    points: line.points,
    atStart,
    label: t('history.peelLine'),
    onChange: draw,
    apply: (tx, count) => {
      peelLine(tx, map, id, atStart, count)
    },
  })
  gesture = peel

  // No dead zone and no click/drag latch, unlike the paint column above. A
  // press that never moves peels nothing, so there is no click hiding here that
  // has to be told apart from a drag that did nothing.
  const accepted = startPointerDrag(event, {
    buttons: [event.button],
    resolveTarget: () => container.value,
    onMove: (context) => {
      const point = worldPoint(context.event)
      if (point) peel.moveTo(point)
    },
    onEnd: () => {
      peel.commit()
      if (gesture === peel) gesture = null
      draw()
    },
  })

  if (!accepted) {
    peel.cancel()
    gesture = null
  }
}

// Markup's press dispatch: the erase column above, or the click and drag
// columns below.
//
// Erase is decided first and takes the press outright, so an armed icon does
// not place while the toggle is on and a right-click never draws.
//
// On the paint side, click and drag are told apart the way Door mode tells them
// apart: the drag primitive's dead zone, plus a latch for having left the origin
// cell. A press that wandered is not a click, even if it came back, and a drag
// that never left the cell draws no line and must not open the picker on the
// way out.
function handleMarkupPress(event: PointerEvent) {
  const action = strokeActionFor(event, tools.erase)
  if (!action) return

  const local = localPoint(event)
  const target = local && markupTargetAt(local)
  if (!target) return
  // Read at press time with the target, so a click means the modifier the user
  // was holding when they pressed rather than whatever they let go of first.
  const additive = event.shiftKey
  event.preventDefault()

  if (action === 'erase') {
    beginMarkupErase(event, target)
    return
  }

  const tab = tabsStore.activeTab

  // Resolved at press time and reused on release, so a click means the cell it
  // started in rather than wherever the pointer drifted inside the dead zone.
  let leftCell = false

  // The drag column, opened at press time so the first move already has
  // somewhere to go. Null on the rows that have no drag yet: an armed icon
  // takes the press whatever is under it, and dragging an icon moves it, which
  // is its own gesture.
  const iconDrag = armedIcon.isArmed ? null : beginMarkupIconDrag(target)
  const lineDrag = armedIcon.isArmed || iconDrag ? null : beginMarkupLineDrag(target)
  // Both are cell-to-cell drags with identical plumbing below. Only the icon
  // one names a dragged icon for the renderer to leave out from under itself.
  const cellDrag = iconDrag ?? lineDrag
  const line = armedIcon.isArmed || cellDrag ? null : beginMarkupLine(target)
  const dragging = cellDrag ?? line
  if (dragging) gesture = dragging
  if (iconDrag && target.kind === 'icon') draggingIconId.value = target.id

  startPointerDrag(event, {
    buttons: [event.button],
    deadZone: DRAG_DEAD_ZONE,
    resolveTarget: () => container.value,
    onMove: (context) => {
      const point = worldPoint(context.event)
      if (!point) return
      const cell = cellKey(Math.floor(point.x), Math.floor(point.y))
      if (cell !== target.cell) leftCell = true
      line?.extendTo(point)
      cellDrag?.moveTo(cell)
    },
    onEnd: () => {
      if (cellDrag) {
        draggingIconId.value = null
        // Out and back is a no-op rather than an undo step: every re-apply runs
        // against the pristine model, so returning to the origin cell restores
        // it rather than reconstructing it, and the empty transaction is
        // dropped by the seam.
        if (leftCell) cellDrag.commit()
        else cellDrag.cancel()
        if (gesture === cellDrag) gesture = null
        draw()
      }
      if (line) {
        // Cancelled rather than committed when it was a click, exactly as the
        // box drag is: a one-cell path makes no line either way, since
        // `createLine` refuses anything under two cells and the seam drops the
        // empty transaction. Saying so here keeps the two columns of the table
        // distinguishable in this file.
        if (leftCell) line.commit()
        else line.cancel()
        if (gesture === line) gesture = null
        draw()
      }
      if (leftCell) return
      // An armed icon replaces the click column for every row: it places here
      // rather than selecting, and the picker does not open. Selecting or
      // editing an existing object requires disarming first.
      const armed = armedIcon.iconType
      if (armed !== null) {
        if (armedPlacementAt(target, markupDefaults.replace) === 'not-in-a-room') return
        placeIconAt(armed, target.cell)
        return
      }
      // The selection column, which every row answers through the shared
      // policy. Select beats create, the rule Door mode already follows: a
      // click that found an object selects it rather than offering to put a new
      // one on top of it.
      if (!tab) return
      const ref = markupRefOf(target)
      selection.clickSelect(ref, tab.id, additive)
      if (ref || additive) return
      // Clicking off everything deselects, which the picker opening on top of
      // is fine: the picker is about the cell, not about the selection. A
      // shift-click edits the selection and opens nothing.
      if (target.kind !== 'room') return
      openIconPicker(target.cell)
    },
  })
}

function handlePointerDown(event: PointerEvent) {
  if (modeStore.active === 'markup') {
    handleMarkupPress(event)
    return
  }
  if (modeStore.active === 'door') {
    handleDoorPress(event)
    return
  }
  if (modeStore.active !== 'draw') return

  // The three erase routes and the one paint route, as a table: see
  // `gestures/strokeAction.ts`. `null` is a press that starts nothing (middle
  // button, pen barrel); it must not fall through to painting.
  const action = strokeActionFor(event, tools.erase)
  if (!action) return

  const tab = tabsStore.activeTab
  const world = worldPoint(event)
  const local = localPoint(event)
  const map = tab ? model.project.mapsById.get(tab.id) : undefined
  if (!tab || !world || !local || !map) return
  event.preventDefault()

  // Pressing any room cell selects it, a rule that cuts across every gesture,
  // so it happens before the paint/erase/resize split regardless of which one
  // this press turns into. On press rather than on click, which is where Draw
  // differs from every other mode: a press that becomes a paint stroke still
  // selected the room it started on, and the touch two-step below depends on
  // that having happened by the time the finger moves.
  const zone = resolveZone(local, {
    map,
    camera: { pan: tab.pan, zoom: tab.zoom },
    tileSize: model.tileSize,
  })
  // Read before selecting. The touch two-step asks whether this room was
  // already the one showing handles when the press landed, and selecting first
  // would make every press look like the second one.
  const wasArmed = zone.kind !== 'empty' && handleRoomId() === zone.roomId
  // No shift-click here: a press in Draw is a paint stroke, so a room cell
  // replaces the selection rather than adding to it. Re-pressing the room that
  // already holds the selection alone leaves it untouched, which keeps a paint
  // press off the selection watch that repaints the canvas.
  if (zone.kind !== 'empty' && !wasArmed) {
    selection.set([{ kind: 'room', id: zone.roomId }], tab.id)
  }

  const started = beginGestureFor(tab.id, action, zone, world, event, wasArmed)
  if (!started) return
  gesture = started.gesture

  // No dead zone, for any of the three. Paint and erase do not need the
  // click/drag distinction because a click is just a stroke whose union is one
  // cell; resize does not need it because a press starts at distance 0 and a
  // zero-distance resize is an empty transaction the seam drops. A click on a
  // handle just sets the active room, which follows from that rather than from
  // a separate threshold.
  const accepted = startPointerDrag(event, {
    // Whichever button opened the gesture is the one that closes it. Passing it
    // through rather than listing the accepted buttons twice means the drag
    // primitive can never disagree with the classifier above about what
    // started this.
    buttons: [event.button],
    resolveTarget: () => container.value,
    onMove: (context) => {
      const point = worldPoint(context.event)
      if (point) started.move(point)
    },
    // Fires for pointercancel too, which commits rather than aborts: the OS
    // taking the pointer away is not the user changing their mind, and one
    // Ctrl+Z undoes a committed gesture where nothing recovers a discarded one.
    // `Esc` is the abort, and it reaches the gesture through the shared
    // precedence stack.
    onEnd: () => {
      started.gesture.commit()
      if (gesture === started.gesture) gesture = null
    },
  })

  if (!accepted) {
    started.gesture.cancel()
    gesture = null
  }
}

// The press half of the precedence table: which gesture this press opens, and
// how the pointer drives it. Every row of the Auto sub-mode passes through
// here, so the order below is the table's precedence.
//
// The `move` closure is what lets the caller above run one drag loop for all of
// them: a cell stroke accumulates world points, an edge stroke accumulates
// lattice steps, and a resize replaces a distance, with nothing outside the
// gesture layer knowing which.
function beginGestureFor(
  mapId: MapId,
  action: StrokeAction,
  zone: DrawZone,
  world: WorldPoint,
  event: PointerEvent,
  wasArmed: boolean,
): { gesture: GhostGesture; move: (point: WorldPoint) => void } | null {
  // The sub-mode lock, filtering the table. Everything below asks it whether a
  // row is live before reaching for the row's gesture; nothing else here knows
  // which lock is set.
  const rows = liveRows(tools.subMode)

  // Erase priority: on an inner-wall segment, delete the segment; otherwise
  // erase the cell. The one row of the erase column that reads its zone;
  // everywhere else erase outranks the zone entirely, so a right-drag along a
  // wall run or across a vertex still erases cells.
  //
  // Not gated on the two-step, unlike the draw branches below: a drawn wall is
  // on the canvas whether or not its room is armed, so there is no invisible
  // target to protect a finger from.
  if (action === 'erase' && zone.kind === 'innerWall' && rows.innerWall) {
    const erase = beginInnerWallErase(mapId, zone.roomId, world, draw, [zone.edge])
    if (erase) return { gesture: erase, move: (point) => erase.extendTo(point) }
  }

  // The two draw-side rows that need a visible target to aim at, and so are the
  // two the touch two-step covers: a subsequent press on a now-visible handle
  // performs the resize or the inner-wall stroke.
  if (action === 'paint' && handleGrabAllowed(event.pointerType, wasArmed)) {
    if (zone.kind === 'edgeRun' && rows.resize) {
      const resize = beginRunResize(mapId, zone.roomId, zone.run, draw)
      // Falls through to a stroke rather than returning null, so a gesture that
      // could not start behaves like the press that opened it: the map being
      // gone is the only way that happens, and then nothing else can start
      // either.
      if (resize) return { gesture: resize, move: (point) => resize.moveTo(point) }
    }

    // Drawing from a vertex and re-styling by drawing over a segment are one
    // gesture: `drawInnerWall` sets the style at an edge whatever was there, so
    // drawing over an existing wall differs only in starting with that wall in
    // the union. The seed is what makes a press on a segment re-style it
    // without waiting for the drag to reach the next vertex.
    if ((zone.kind === 'vertex' || zone.kind === 'innerWall') && rows.innerWall) {
      const seed = zone.kind === 'innerWall' ? [zone.edge] : undefined
      const wall = beginInnerWallStroke(mapId, zone.roomId, world, tools.wallStyle, draw, seed)
      if (wall) return { gesture: wall, move: (point) => wall.extendTo(point) }
    }
  }

  // Other presses just set the active room; the arming already happened, in the
  // caller, before any of this. So a lock that switches the cell gestures off
  // needs nothing more than declining to start one.
  //
  // This is also what makes Cells-only differ from the other two locks without
  // a branch of its own: there the cell gestures are live, so a press that
  // found an edge run or a vertex falls through to here and paints the cell it
  // landed in, growing edge runs and leaving vertices inert.
  if (!rows.cells) return null

  const stroke =
    action === 'erase' ? beginEraseStroke(mapId, world, draw) : beginPaintStroke(mapId, world, draw)
  return stroke && { gesture: stroke, move: (point) => stroke.extendTo(point) }
}

// What Door mode's pointer is over, as a row of the table. One call, and every
// Door-mode reader goes through it: the cursor below, the click here, and the
// gestures.
function doorTargetAt(point: ScreenPoint): DoorTarget | null {
  const tab = tabsStore.activeTab
  const map = tab ? model.project.mapsById.get(tab.id) : undefined
  if (!tab || !map) return null
  return resolveDoorTarget(point, {
    project: model.project,
    map,
    camera: { pan: tab.pan, zoom: tab.zoom },
    tileSize: model.tileSize,
  })
}

// The picker popup's anchor: the cell it was opened at, and that cell's centre
// in viewport pixels. Null when it is closed.
//
// Position is captured once, at open. The popup dismisses rather than follows
// when the map moves, so there is nothing to recompute; the watch below is what
// enforces that.
const pickerCell = ref<CellKey | null>(null)
const pickerAt = ref<{ x: number; y: number } | null>(null)

function openIconPicker(cell: CellKey) {
  const tab = tabsStore.activeTab
  if (!tab) return
  const centre = cellCentre(cell)
  // Viewport pixels, which is the anchor element's own coordinate space.
  pickerAt.value = worldToScreen(centre.x, centre.y, tab, model.tileSize)
  pickerCell.value = cell
}

function closeIconPicker() {
  pickerAt.value = null
  pickerCell.value = null
}

// The popup was opened at a cell, so picking there places rather than arms: one
// icon, in the cell you clicked, and the popup has done its job.
//
// The entry's own colours, loaded into the toolbar on the way through, so the
// swatches agree with what just landed and a later armed placement matches it.
function handleIconPicked(entry: IconRegistryEntry) {
  const cell = pickerCell.value
  closeIconPicker()
  if (!cell) return
  markupDefaults.loadColors(entry.defaultColors)
  placeIconAt(entry.id, cell)
}

// The end of a drag that started in the sidebar. The picker cannot resolve a
// cell (it knows nothing about cameras) and the canvas cannot hear the release
// (the pointer is captured by the button the drag began on), so the two meet
// through the registry: see `gestures/iconDropTarget.ts`.
//
// A release outside the viewport, or on a cell that refuses the icon, places
// nothing and says so, which is what stops the picker treating every drag as a
// success.
function dropIconFromLibrary(
  point: { clientX: number; clientY: number },
  entry: IconRegistryEntry,
) {
  const box = container.value?.getBoundingClientRect()
  if (!box) return false
  const local = { x: point.clientX - box.left, y: point.clientY - box.top }
  if (local.x < 0 || local.y < 0 || local.x > box.width || local.y > box.height) return false

  const target = markupTargetAt(local)
  if (!target) return false
  const placement = armedPlacementAt(target, markupDefaults.replace)
  if (placement === 'blocked' || placement === 'not-in-a-room') return false

  // The entry's own colours, as the grid showed them, and loaded into the
  // toolbar so the swatches agree with what just landed.
  markupDefaults.loadColors(entry.defaultColors)
  placeIconAt(entry.id, target.cell)
  return true
}

// Both placement routes end here: the popup's pick and a click while armed.
// One op, differing only in the chrome that led to it.
//
// Colours come from the toolbar rather than the registry, because the user may
// have overridden a swatch since the icon was armed.
function placeIconAt(iconType: string, cell: CellKey) {
  const tab = tabsStore.activeTab
  const map = tab ? model.project.mapsById.get(tab.id) : undefined
  if (!tab || !map) return

  model.run(t('history.placeIcon'), mapScope(tab.id), (tx) =>
    placeIcon(tx, map, cell, iconType, markupDefaults.colors, {
      replace: markupDefaults.replace,
    }),
  )
  draw()
}

// What Markup mode's pointer is over, as a row of its table. The same shape as
// `doorTargetAt`, against its own resolver: Markup's priority is the reverse of
// `hitTest`'s, so the two modes cannot share one.
function markupTargetAt(point: ScreenPoint): MarkupTarget | null {
  const tab = tabsStore.activeTab
  const map = tab ? model.project.mapsById.get(tab.id) : undefined
  if (!tab || !map) return null
  return resolveMarkupTarget(point, {
    project: model.project,
    map,
    camera: { pan: tab.pan, zoom: tab.zoom },
    tileSize: model.tileSize,
  })
}

// The cross-tab teleport's other half: double-clicking it opens that tab
// centred on the other end. The only place in the app where the canvas changes tabs, and
// navigation rather than selection: it does not select the teleport.
//
// Reached only through `handleDoubleClick`, by a press that never left its
// cell, so the click-vs-drag rule is already honoured by the time this runs.
function openTeleportEnd(to: { mapId: MapId; cell: CellKey }) {
  // Undoable, like every other tab switch: arriving somewhere unexpected is
  // exactly when a user reaches for Ctrl+Z.
  tabsStore.activate(to.mapId)

  const box = container.value?.getBoundingClientRect()
  if (!box) return
  const centre = cellCentre(to.cell)
  tabsStore.setCamera(to.mapId, centerOn(tabsStore.cameraOf(to.mapId), centre, box, model.tileSize))
}

function handlePointerMove(event: PointerEvent) {
  const tab = tabsStore.activeTab
  const point = localPoint(event)
  if (!tab || !point) return
  const world = screenToWorld(point.x, point.y, tab, model.tileSize)
  cursorCell.value = { col: Math.floor(world.x), row: Math.floor(world.y) }
  updateBrushPreview(world)
  updateHoveredHandle(point, world)
}

function handlePointerLeave() {
  cursorCell.value = null
  updateBrushPreview(null)
  updateHoveredHandle(null, null)
}

// The pointer-driven half of Draw mode's hover: which of the active room's
// handles is under the pointer (drawn at full grab size), which cell the
// vertex targets are revealed around, and the resize cursor.
//
// The three come from one `resolveZone` per pointer move, run on every move
// regardless of whether a room is armed: desktop keeps its one-gesture
// hover-resize on any room, so the cursor is the only thing telling you the
// press will resize rather than grow. It is pure arithmetic over four corners
// and four edges, and unlike the two below it costs no repaint.
//
// Both repaints stay gated on the answer actually changing, the same
// discipline the brush preview uses: sweeping within one handle, or within one
// cell, is free. That the reveal window is keyed on the pointer's cell rather
// than its exact position is what makes the second gate possible.
function updateHoveredHandle(point: ScreenPoint | null, world: WorldPoint | null) {
  hoverScreen = point
  // Every zone below is Draw mode's: its handles, its reveal window, its
  // cursor. Door mode resolves its own target instead (see `cursorAt`), and
  // running the zone resolver for it would be work whose answer nothing reads.
  const drawing = modeStore.active === 'draw'
  const zone = drawing && point ? zoneAt(point) : null
  const nextHandle = drawing ? handleFor(zone) : null
  const nextCell = drawing && world ? { x: Math.floor(world.x), y: Math.floor(world.y) } : null
  // Resolved once here and handed to both readers below. Markup's row is what
  // the cursor is drawn from and what a hovered label is looked up from, and
  // resolving it twice per move would be the same answer computed twice.
  const markupTarget = modeStore.active === 'markup' && point ? markupTargetAt(point) : null

  zoneCursor.value = cursorAt(point, zone, markupTarget)

  const handleChanged = !sameHandle(hoveredHandle, nextHandle)
  const cellChanged = !sameCell(revealCell, nextCell)
  const labelChanged = updateHoveredLabel(markupTarget)
  hoveredHandle = nextHandle
  revealCell = nextCell
  // The reveal window only matters when there is a room showing handles.
  if (handleChanged || labelChanged || (cellChanged && handleRoomId() !== null)) draw()
}

// The label the pointer is currently showing, and the second reason hover costs
// a repaint at all. It stays free unless there is a label to show:
//
//   - Markup mode only, like the brush preview is Draw mode only. Reading a map
//     from another mode is what the show-all toggle is for.
//   - Nothing while that toggle is on: every label is drawn already, so hover
//     could only re-draw the same picture.
//   - Nothing for an object whose label is empty, which is every object until
//     the Inspector can set one. Without that check, sweeping across a plain
//     icon would cost a repaint that changes no pixel.
//   - And the repaint is gated on the answer changing, so crossing one icon
//     costs one redraw rather than one per pointer sample.
//
// Returns whether the answer changed, because the caller owns the repaint.
function updateHoveredLabel(target: MarkupTarget | null): boolean {
  const next = canvasView.showAllLabels ? null : labelledIdOf(target)
  if (next === hoveredLabel) return false
  hoveredLabel = next
  return true
}

function labelledIdOf(target: MarkupTarget | null): string | null {
  const tab = tabsStore.activeTab
  const map = tab ? model.project.mapsById.get(tab.id) : undefined
  if (!target || !map) return null
  switch (target.kind) {
    case 'icon':
      return map.icons.get(target.id)?.label ? target.id : null
    // Either row means the pointer is on the line, and a line carries one label
    // wherever it is drawn: which end you are near does not change it.
    case 'line-end':
    case 'line-body':
      return map.lines.get(target.id)?.label ? target.id : null
    case 'room':
    case 'empty':
      return null
  }
}

function sameCell(a: { x: number; y: number } | null, b: { x: number; y: number } | null): boolean {
  if (!a || !b) return a === b
  return a.x === b.x && a.y === b.y
}

function zoneAt(point: ScreenPoint): DrawZone | null {
  const tab = tabsStore.activeTab
  const map = tab ? model.project.mapsById.get(tab.id) : undefined
  if (!tab || !map) return null
  return resolveZone(point, {
    map,
    camera: { pan: tab.pan, zoom: tab.zoom },
    tileSize: model.tileSize,
  })
}

function handleFor(zone: DrawZone | null): HoveredHandle | null {
  const armed = handleRoomId()
  if (!zone || !armed) return null
  // Only that room's handles are drawn, so only its handles can be hovered:
  // pointing at a run of some other room highlights nothing, even though
  // pressing it would still resize.
  if (zone.kind === 'empty' || zone.roomId !== armed) return null

  // A handle the lock has hidden cannot be hovered either. Reading the same
  // record the renderer does, rather than a second copy of the rule.
  const shown = visibleHandles(tools.subMode)
  if (zone.kind === 'edgeRun' && shown.runs) return { kind: 'run', edge: zone.run.edges[0] }
  if (zone.kind === 'vertex' && shown.vertices) return { kind: 'vertex', vertex: zone.vertex }
  return null
}

// The cursor for whatever is under the pointer, in whichever mode is active.
//
// Both modes answer it from the same record their own dispatch reads (Draw
// mode's zone, Door mode's target), so neither can promise a gesture it does
// not have. Door mode inherits that discipline from the sub-mode lock without
// a lock of its own.
function cursorAt(
  point: ScreenPoint | null,
  zone: DrawZone | null,
  markupTarget: MarkupTarget | null,
): string | null {
  if (!point) return null
  if (modeStore.active === 'door') {
    const target = doorTargetAt(point)
    if (!target) return null
    // While a teleport is pending the table's rows do not apply: every click is
    // a completion attempt, so a "select" pointer over a door would promise
    // something the dispatch has already given away. The crosshair marks
    // exactly where a click would complete, the second click's equivalent of
    // the box drag's red rectangle.
    const tab = tabsStore.activeTab
    // Erase outranks the pending state, because it outranks the whole primary
    // column: while the toggle is on, a left click deletes rather than
    // completes, so a crosshair over a valid destination would promise a
    // completion that will not happen.
    if (tools.erase) return doorCursor(target, true)
    if (pendingTeleport.isPending) {
      return tab && pendingTeleport.canCompleteAt(tab.id, target.cell) ? 'crosshair' : null
    }
    return doorCursor(target)
  }
  if (modeStore.active === 'markup') {
    const target = markupTarget
    if (!target) return null
    // A live icon drag outranks everything: while one is running the only
    // question is whether the cell under the pointer will take it. A refused
    // move applies nothing, so without this "did not move" and "cannot move
    // here" are the same picture.
    if (draggingIconId.value) {
      const placement = armedPlacementAt(target, markupDefaults.replace, draggingIconId.value)
      return placement === 'blocked' || placement === 'not-in-a-room' ? 'not-allowed' : 'grabbing'
    }
    // The armed state changes what every row's click does, and a selected line
    // changes what its body's drag does, so both reach the cursor: one source,
    // read by dispatch and cursor alike.
    return markupCursor(
      target,
      tools.erase,
      armedIcon.isArmed ? { replace: markupDefaults.replace } : null,
      target.kind === 'line-body' && movesOnDrag({ kind: 'line', id: target.id }),
    )
  }
  return cursorFor(zone)
}

// What the press under the pointer would do, as a cursor. Only in Draw mode,
// because only there do these zones mean anything.
//
// An edge run gets a resize cursor along the wall's own axis, so a north or
// south run reads as vertical movement. A vertex or an existing inner-wall
// segment both get the crosshair: pressing either draws a wall, and pressing
// the segment re-styles it. Gated on the same sub-mode lock the dispatch
// reads, so a cursor never promises a gesture the lock has switched off.
function cursorFor(zone: DrawZone | null): string | null {
  if (modeStore.active !== 'draw' || !zone) return null
  const rows = liveRows(tools.subMode)
  if ((zone.kind === 'vertex' || zone.kind === 'innerWall') && rows.innerWall) return 'crosshair'
  if (zone.kind !== 'edgeRun' || !rows.resize) return null
  return zone.run.side === 'N' || zone.run.side === 'S' ? 'ns-resize' : 'ew-resize'
}

function sameHandle(a: HoveredHandle | null, b: HoveredHandle | null): boolean {
  if (!a || !b) return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === 'run' && b.kind === 'run') return a.edge === b.edge
  if (a.kind === 'vertex' && b.kind === 'vertex') {
    return a.vertex.x === b.vertex.x && a.vertex.y === b.vertex.y
  }
  return false
}

// The aiming aid for a sized brush, and the one thing in this component that
// repaints on hover.
//
// Only for N > 1, deliberately: a 1×1 brush needs no preview to aim, and giving
// it one would put a canvas repaint on every pointer move over the canvas for
// the common case, so nothing happens on a bare move. Even at N > 1 the redraw
// is gated on the footprint actually moving a whole cell, so travelling within
// one cell is still free.
function updateBrushPreview(world: WorldPoint | null) {
  hoverWorld = world
  const next = previewAt(world, tools.brushSize)
  if (samePreview(brushPreview, next)) return
  brushPreview = next
  draw()
}

function previewAt(world: WorldPoint | null, size: number): BrushPreview | null {
  // Draw mode only. The preview says "a press lands here", which is false in
  // every other mode, and gating it here rather than in the scene also stops
  // the repaint it would cost on every cell crossed in Door mode.
  if (modeStore.active !== 'draw') return null
  if (!world || size <= 1) return null
  const offset = brushOffset(world, size)
  return {
    col: Math.floor(world.x) + offset.dc,
    row: Math.floor(world.y) + offset.dr,
    size,
  }
}

function samePreview(a: BrushPreview | null, b: BrushPreview | null): boolean {
  if (!a || !b) return a === b
  return a.col === b.col && a.row === b.row && a.size === b.size
}

const coordsLabel = computed(() =>
  cursorCell.value ? `${cursorCell.value.col}, ${cursorCell.value.row}` : '-, -',
)

// Redraws on any pan/zoom/bounds change, or switching to a different tab.
// A redraw is idempotent and cheap at this scale, so this is deliberately a
// little more eager than strictly necessary.
watch(
  () => {
    const tab = tabsStore.activeTab
    if (!tab) return null
    return [
      tab.id,
      tab.zoom,
      tab.pan.x,
      tab.pan.y,
      tab.bounds.minCol,
      tab.bounds.minRow,
      tab.bounds.maxCol,
      tab.bounds.maxRow,
    ]
  },
  () => draw(),
)

// The active room's handles are drawn, so arming or clearing it is a repaint.
// It also has to redraw when the room changes shape under it (growing a room
// moves its runs), which `model.rev` covers.
//
// `structureRev` is here because the scene above reads two project-scope maps,
// areas and lock types, and neither touches a map's revision: recolouring an
// area or a lock type bumps only the structure counter, so watching `rev` alone
// would leave every room fill and door marker on screen stale until the next
// unrelated edit.
//
// `pendingTeleport.isPending` is here for the origin marker, which is drawn
// from state no model revision moves: starting and cancelling a pending
// teleport changes nothing in the project, so without this the marker would
// appear and disappear only on the next unrelated edit. It also has to catch up
// what the pointer is over, because while pending the cursor answers a
// different question (see `cursorAt`) without the pointer having moved.
// The picker is anchored to a point on the map, and its position is captured
// once at open, so anything that moves the map under it makes that position a
// lie. Closing on the camera itself rather than on the wheel and drag handlers
// catches every route there is: the zoom control, fit-to-screen, keyboard pan,
// a tab switch restoring another camera.
//
// Dismiss rather than follow, deliberately: a popup that chases its cell ends
// up off the edge of the viewport, still open and pointing at nothing.
watch(
  () => {
    const tab = tabsStore.activeTab
    return tab ? [tab.id, tab.zoom, tab.pan.x, tab.pan.y].join(':') : null
  },
  () => closeIconPicker(),
)

// Leaving Markup takes its chrome with it: nothing else in the app can open
// this, so a popup outliving the mode would be unreachable and unexplained.
watch(
  () => modeStore.active,
  () => closeIconPicker(),
)

watch([() => model.rev, () => model.structureRev], () => draw())
watch(
  () => pendingTeleport.isPending,
  () => {
    updateHoveredHandle(hoverScreen, hoverWorld)
    draw()
  },
)

// The halo and the resize handles are both drawn from the selection, and
// selecting changes no model revision, so like the pending marker it needs a
// watch of its own or it would appear only on the next unrelated edit. Watching
// the store's own array rather than a count, because swapping one object for
// another leaves the length alone.
watch(() => selection.selected, draw, { deep: true })

// `Esc` cancels a pending teleport, in the gesture tier: tier 3 aborts an
// in-progress gesture, which is a ghosted drag (paint, resize, move, door box),
// a pending teleport, or an active marquee. Those three are not actually
// mutually exclusive: a box drag can start while a teleport is pending.
//
// LIFO inside the tier resolves that correctly. The pending handler is pushed
// on the first click; a box drag pushes its own on press, which is necessarily
// later, so `Esc` mid-drag aborts the box and the teleport stays pending: the
// thing the pointer is holding open dies first. When the drag ends it pops
// itself and the pending handler is top again, so a second `Esc` cancels the
// teleport.
//
// Registered only while something is pending, for the reason the active room's
// is: a permanently registered handler would sit in the gesture tier
// swallowing every `Esc` that should have fallen through to the tiers below.
// Same `flush: 'sync'`, same reason: a click followed immediately by `Esc`
// must find it already there.
let popPendingTeleportEsc: (() => void) | null = null
watch(
  () => pendingTeleport.isPending,
  (pending) => {
    if (pending && !popPendingTeleportEsc) {
      popPendingTeleportEsc = pushEscHandler('gesture', () => pendingTeleport.cancel())
      return
    }
    if (!pending && popPendingTeleportEsc) {
      popPendingTeleportEsc()
      popPendingTeleportEsc = null
    }
  },
  { flush: 'sync' },
)

// `Esc` disarms, in the tier between a live gesture and the selection. That
// ordering is the peeling order the stack exists for: a drag in progress aborts
// first, then the thing the next click would do, then what is selected.
//
// The tier has been reserved since the Esc stack was written and this is what
// fills it. Registered only while armed, like the two above, so it never
// swallows an `Esc` meant for a lower tier.
let popArmedIconEsc: (() => void) | null = null
watch(
  () => armedIcon.isArmed,
  (armed) => {
    if (armed && !popArmedIconEsc) {
      popArmedIconEsc = pushEscHandler('armedIcon', () => armedIcon.disarm())
      return
    }
    if (!armed && popArmedIconEsc) {
      popArmedIconEsc()
      popArmedIconEsc = null
    }
  },
  { flush: 'sync' },
)

// `Esc` clears the selection, in the selection tier: tier 5 deselects
// everything. It sits below the pending teleport deliberately: a half-drawn
// gesture is more urgent than a selection, which is exactly the peeling order
// tier 3 above tier 5 encodes.
//
// One handler for the whole tier, in every mode, because there is one
// selection: clearing it is also what puts Draw mode's resize handles away.
//
// `flush: 'sync'` because this is input precedence, not rendering: the handler
// has to be on the stack the instant something is selected, or a press followed
// immediately by `Esc` would find an empty tier. The store's prune makes the
// same call for the same reason.
let popSelectionEsc: (() => void) | null = null
watch(
  () => selection.isEmpty,
  (empty) => {
    if (!empty && !popSelectionEsc) {
      popSelectionEsc = pushEscHandler('selection', () => selection.clear())
      return
    }
    if (empty && popSelectionEsc) {
      popSelectionEsc()
      popSelectionEsc = null
    }
  },
  { flush: 'sync' },
)

onUnmounted(() => {
  popPendingTeleportEsc?.()
  popArmedIconEsc?.()
  popSelectionEsc?.()
})

// Resizing the brush redraws the outline where the pointer already is, so
// `[`/`]` reads as changing the thing under your cursor rather than as
// something that takes effect the next time you move.
watch(
  () => tools.brushSize,
  () => updateBrushPreview(hoverWorld),
)

// Switching modes changes which chrome belongs on the canvas (handles and the
// brush preview are Draw mode's), and changes what the pointer is over without
// the pointer moving, exactly like the sub-mode lock below.
watch(
  () => modeStore.active,
  () => {
    updateBrushPreview(hoverWorld)
    updateHoveredHandle(hoverScreen, hoverWorld)
    draw()
  },
)

// Locking the sub-mode changes which handles are drawn, so it is a repaint,
// and it changes what the pointer is over without the pointer moving, so the
// hover state and the cursor have to be recomputed from where it already is.
watch(
  () => tools.subMode,
  () => {
    updateHoveredHandle(hoverScreen, hoverWorld)
    draw()
  },
)

// The erase toggle changes what a press would do without the pointer moving, so
// the cursor has to catch up from where it already is, the same rule the mode
// and the sub-mode lock follow. Toggled from the toolbar, so the pointer is
// somewhere else entirely when it happens.
watch(
  () => tools.erase,
  () => updateHoveredHandle(hoverScreen, hoverWorld),
)

// Grid/rulers/units toggles go through resize() rather than draw(): showing
// or hiding the ruler strips changes the main viewport's on-screen size via
// the CSS grid template.
watch(
  () => [canvasView.showGrid, canvasView.showRulers, canvasView.rulerUnits],
  () => resize(),
)

// The layer toggles are a plain repaint: unlike the rulers above, they change
// nothing about the viewport's size, only what is painted into it.
watch(
  () => [
    canvasView.showTransitions,
    canvasView.showTeleportLines,
    canvasView.showMarkup,
    canvasView.showIcons,
    canvasView.showLines,
  ],
  () => draw(),
)

// The show-all toggle both repaints and changes what hover means: with it on
// there is no hovered label, and turning it back off has to re-find the one
// under a pointer that has not moved.
watch(
  () => canvasView.showAllLabels,
  () => {
    updateHoveredHandle(hoverScreen, hoverWorld)
    draw()
  },
)

// Explicit theme changes (View ▸ Appearance) and, for a System Default user,
// the OS switching light/dark: the latter never touches themeStore.mode, so
// it needs watching separately. Either way the cached palette is stale.
const { prefersDark } = useSystemColorScheme()
watch([() => themeStore.mode, prefersDark], () => repaintForTheme())

// `Delete`/`Backspace` on the selection: rooms, transitions, icons and lines,
// whichever the selection holds, in every mode.
//
// Goes through the same ops the right-click routes do, so no two delete routes
// can disagree about what deleting means.
//
// Draw mode then has two destructive granularities: erase removes cells, this
// removes the whole room. It is also the *only* way to delete a whole line in
// one step, since erase on a line's body does nothing by design and a line
// could otherwise only be peeled away segment by segment.
useHotkeyAction('deleteSelection', () => {
  const tab = tabsStore.activeTab
  const map = tab ? model.project.mapsById.get(tab.id) : undefined
  if (!tab || !map) return

  // The selectors answer for this tab only, so a selection left on another tab
  // deletes nothing here.
  const transitions = selection.transitionsOn(tab.id)
  const rooms = selection.roomsOn(tab.id)
  const icons = selection.iconsOn(tab.id)
  const lines = selection.linesOn(tab.id)
  if (rooms.length + transitions.length + icons.length + lines.length === 0) return

  // One transaction for the whole selection, not one each: deleting three doors
  // with one keypress must undo as one step.
  //
  // Rooms go last. Deleting a room cascades to the transitions on its edges and
  // the icons in its cells, so taking the named ones first means each id is
  // still there when its own op runs rather than having been swept up already.
  model.run(deleteSelectionLabel(), mapScope(tab.id), (tx) => {
    for (const id of transitions) deleteTransition(tx, model.project, map, id)
    for (const id of icons) deleteIcon(tx, map, id)
    for (const id of lines) deleteLine(tx, map, id)
    if (rooms.length > 0) deleteRooms(tx, model.project, map, rooms)
  })
})

// The undo entry for the key above. A selection of one kind names that kind, so
// the entry reads the same as the right-click that deletes the same object; a
// mixed selection has no truthful specific name and says so.
function deleteSelectionLabel(): string {
  const kinds = new Set(selection.selected.map((item) => item.kind))
  if (kinds.size > 1) return t('history.deleteSelection')
  const [kind] = kinds
  if (kind === 'room') return t('history.deleteRoom')
  if (kind === 'icon') return t('history.deleteIcon')
  if (kind === 'line') return t('history.deleteLine')
  return t('history.deleteTransition')
}

useResizeObserver(container, resize)

onMounted(resize)

// The canvas is the one place a library icon can be dropped, and it says so
// only while it is mounted. Same lifecycle discipline as the Esc handlers
// above: register on mount, release on unmount, never leave a stale target
// pointing at a torn-down component.
let releaseIconDropTarget: (() => void) | null = null
onMounted(() => {
  releaseIconDropTarget = registerIconDropTarget(dropIconFromLibrary)
})
onUnmounted(() => {
  releaseIconDropTarget?.()
  releaseIconDropTarget = null
})
</script>

<template>
  <section
    class="canvas-region"
    :class="{ 'no-rulers': !canvasView.showRulers }"
    :style="{ '--ruler-thickness': `${RULER_THICKNESS}px` }"
    :aria-label="t('canvas.label')"
  >
    <canvas ref="topRulerCanvas" class="ruler ruler-top" />
    <canvas ref="leftRulerCanvas" class="ruler ruler-left" />
    <div class="ruler-corner" />
    <!-- The browser menu is suppressed on the viewport only, because
         right-drag is erase here. Everywhere else in the app the native menu
         still works. -->
    <div
      ref="container"
      class="canvas-viewport"
      :style="zoneCursor ? { cursor: zoneCursor } : undefined"
      @wheel="handleWheel"
      @contextmenu.prevent
      @dblclick="handleDoubleClick"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerleave="handlePointerLeave"
    >
      <canvas ref="canvas" class="canvas" />
      <!-- After the first click the origin endpoint shows a marker on the
           canvas; this is the accompanying prompt. `aria-live` because it
           appears without focus moving and without the user having asked for
           it: it is the app telling you it is waiting. `pointer-events: none`,
           like the coords readout: it sits over the canvas and every click on
           the canvas belongs to the gesture it is prompting for. -->
      <div v-if="pendingTeleport.isPending" class="pending-prompt" role="status" aria-live="polite">
        {{ t('canvas.pickTeleportDestination') }}
      </div>
      <div v-if="canvasView.showCoords" class="coords-overlay">{{ coordsLabel }}</div>
      <!-- Anchored to a map cell rather than to a control, so it lives inside
           the viewport whose coordinate space its anchor is positioned in. -->
      <IconPickerPopover
        :at="pickerAt"
        :cell="pickerCell"
        @pick="handleIconPicked"
        @close="closeIconPicker"
      />
    </div>
  </section>
</template>

<style scoped>
/* Track sizes come from --ruler-thickness, bound above from the renderer's
 * RULER_THICKNESS, so the CSS and the canvas it sizes cannot drift. */
.canvas-region {
  display: grid;
  grid-template-columns: var(--ruler-thickness) 1fr;
  grid-template-rows: var(--ruler-thickness) 1fr;
}
.canvas-region.no-rulers {
  grid-template-columns: 0 1fr;
  grid-template-rows: 0 1fr;
}
.canvas-region.no-rulers .ruler,
.canvas-region.no-rulers .ruler-corner {
  display: none;
}

.ruler {
  display: block;
}
.ruler-top {
  grid-column: 2;
  grid-row: 1;
  border-bottom: 1px solid var(--border);
}
.ruler-left {
  grid-column: 1;
  grid-row: 2;
  border-right: 1px solid var(--border);
}
.ruler-corner {
  grid-column: 1;
  grid-row: 1;
  background: var(--canvas-ruler);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.canvas-viewport {
  grid-column: 2;
  grid-row: 2;
  position: relative;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

.canvas {
  display: block;
}

/* Top-centre, where the eye goes when the app is waiting on you, and clear of
 * the coords readout in the opposite corner, which stays useful while picking. */
.pending-prompt {
  position: absolute;
  top: 0.5rem;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.25rem 0.625rem;
  font-size: 0.8125rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  white-space: nowrap;
  pointer-events: none;
}

.coords-overlay {
  position: absolute;
  right: 0.5rem;
  bottom: 0.5rem;
  padding: 0.125rem 0.375rem;
  font-size: 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  opacity: 0.85;
  pointer-events: none;
}
</style>
