import { worldToScreen, type Bounds } from './viewport'
import type { Camera } from './camera'
import type { CanvasPalette } from './palette'
import { doorOpening, doorRuns, wallGaps, type DoorRun, type OpenSpan } from './doorRuns'
import { elevatorShafts, type ElevatorShaft } from './elevators'
import { drawIconBadge, drawIconPlate, UNKNOWN_ICON_ART, type IconArt } from './iconBadge'
import { cellCentre, type TeleportEnd, type TeleportScene } from './teleports'
import { parseCell, segmentFromEdge } from '@/core/cell'
import type { CellKey, EdgeKey } from '@/core/cell'
import { interiorVertices, outerWalls, resizableRuns } from '@/core/derive/walls'
import { clamp } from '@/lib/math'
import type { AreaId, LockTypeId, RoomId, TransitionId } from '@/core/ids'
import type { Area, LockType, MapModel, Room, WallStyle } from '@/core/types'
import type { BoxPreview } from '@/gestures/boxDrag'

// Pure drawing: everything it needs arrives in `scene`, and it touches no
// store, no ref, and no DOM beyond the context it's handed. That's what makes
// the grid/page maths testable without jsdom, and what keeps the component a
// thin adapter as selection and ghost overlays land on top.
//
// The geometry of the three transition kinds is not here. `doorRuns.ts`,
// `elevators.ts` and `teleports.ts` each turn a model into the shapes it draws
// as, and this file only paints them: that is what keeps the wall's hole and
// the door's marker one measurement rather than two constants that agree until
// somebody moves one.

export interface MapScene {
  camera: Camera
  // The map's drawn extent: the draw.io-style "page" the user works on.
  bounds: Bounds
  // `settings.tileSize`: the on-screen size of one cell at zoom 1.
  tileSize: number
  palette: CanvasPalette
  showGrid: boolean
  // The map to draw. Null renders an empty page, which is what the canvas
  // shows before a project is available.
  map: MapModel | null
  // The transitions layer's visibility, and the teleport-lines sub-toggle
  // nested under it. Both arrive as plain instructions: the policy (which
  // includes Door mode overriding the master, since Door mode acts on exactly
  // these objects) is the scene builder's, not this file's.
  //
  // The nesting is structural rather than a conjunction computed anywhere: the
  // lines are drawn inside the master's gate, so "if the transitions layer is
  // off, teleport lines are already hidden" cannot be got wrong.
  //
  // Hiding the layer also closes the doorway gaps: see `renderMap`.
  showTransitions: boolean
  showTeleportLines: boolean
  // The markup layer's two halves, already resolved against their master by
  // the scene builder, exactly like the pair above. There is no `showMarkup`
  // here: the master has no rendering of its own, so passing it would be a
  // third flag this file could only get wrong.
  showIcons: boolean
  showLines: boolean
  // When to draw the label an icon or a line carries. `showAllLabels` draws
  // every non-empty one; otherwise only `hoveredLabel` shows, which is the id
  // of the object under the pointer or null. Both are gated by the two layer
  // flags above: a hidden object's label goes with it.
  showAllLabels: boolean
  hoveredLabel: string | null
  // Icons and lines currently selected on this map, as a halo behind each.
  //
  // Its own set rather than a place in `selected` above, because the two are
  // gated differently: a transition's halo goes with the transitions layer,
  // where a selected icon's goes with the icons layer and a selected line's
  // with the lines layer.
  selectedMarkup: ReadonlySet<string>
  // Colour lives on the area, never on the room, so the renderer needs the
  // project's areas to resolve a room's fill. Passed in rather than reached
  // for, because this file sees no store and no project.
  areas: ReadonlyMap<AreaId, Area>
  // Lock types are project-wide, and a door's marker colour is its lock's:
  // optional, because a colourless lock (which `Open` permanently is) renders
  // as a clean gap. Passed in for the same reason `areas` is: this file sees a
  // scene, never a project.
  lockTypes: ReadonlyMap<LockTypeId, LockType>
  // Art for every icon type this build knows, keyed by `iconType`. A type with
  // no entry draws as `UNKNOWN_ICON_ART` rather than vanishing.
  //
  // Passed in rather than imported for the same reason `areas` and `lockTypes`
  // are, and with one more: an icon's art need not come from a static registry,
  // so resolving it here would tie this file to one source of it.
  iconArt: ReadonlyMap<string, IconArt>
  // Teleports, both ends of each, already reconciled: see `canvas/teleports.ts`.
  //
  // Prepared by the caller rather than derived here like doors and elevators
  // are, because a cross-tab teleport is stored once under its origin map: the
  // destination tab's marker is rebuilt from a project-scope index, so this one
  // layer cannot be drawn from `map` alone. Handing over the finished list keeps
  // the project out of this file, which is the same trade `areas` and
  // `lockTypes` make.
  teleports: TeleportScene
  // The in-progress gesture's overlay, or null when nothing is being dragged.
  ghost: GhostScene | null
  // The brush footprint under the pointer, or null when there is nothing to
  // show: no pointer over the canvas, or a 1×1 brush, which needs no aiming
  // aid and whose preview would cost a repaint on every pointer move.
  brushPreview: BrushPreview | null
  // Door mode's rubber-band box, or null when no box drag is live.
  //
  // The one ghost that is not model state. Everything else a gesture
  // previews is drawn by applying it speculatively and letting the model render
  // through the ordinary path, but a rectangle is in no model, and an invalid
  // box applies nothing at all, so without this a refused drag and a broken app
  // look identical. Hence its own scene input rather than a place in
  // `GhostScene`, which describes cells the map cannot show.
  boxPreview: BoxPreview | null
  // The transitions currently selected on this map, as a halo drawn behind each
  // one. Empty when nothing is selected, which is the ordinary case.
  //
  // Ids rather than resolved shapes, because the three kinds are found three
  // different ways and this file already derives all of them: a door from
  // `doorRuns`, a shaft from `elevatorShafts`, a teleport from the prepared
  // scene. Handing over a set means the halo is a filter over work already done
  // rather than a fourth traversal.
  selected: ReadonlySet<TransitionId>
  // The origin cell of a half-finished teleport, or null when none is pending
  // on this map: a pending origin on another tab draws nothing here.
  //
  // The second thing on the canvas that is not model state, and it is not model
  // state in a stronger sense than the box above: a box drag at least holds an
  // open transaction, where a pending origin commits nothing and puts nothing
  // on the undo stack at all. So the marker cannot be drawn by applying anything
  // (half a teleport is not a smaller teleport), and it arrives as its own
  // scene input for the same reason `boxPreview` does.
  pendingTeleport: CellKey | null
  // The rooms currently selected on this map, as a halo around each one's
  // outline. Ids rather than rooms, resolved against `map` here: the outline is
  // derived from the room the map already holds, so passing shapes would be a
  // second copy of it to keep in step.
  selectedRooms: ReadonlySet<RoomId>
  // The room drawn with resize handles, or null when none is.
  handleRoom: HandleRoomScene | null
  // The marquee's rectangle while a select drag is live, or null.
  //
  // The third thing on the canvas that is in no model, and it is here for the
  // reason `boxPreview` is: a marquee that has caught nothing yet applies
  // nothing, so without an outline a drag that is working and an app that has
  // stopped look identical.
  marquee: MarqueeRect | null
}

// The marquee, in world coordinates measured in cells, fractional.
//
// World rather than screen so it survives a pan or a zoom mid-drag, and
// fractional rather than cell-quantised so the corners can sit wherever the
// pointer is. Snapping the rectangle to whole cells is then a caller's decision
// and costs nothing here.
//
// The two corners are the drag's origin and its current point, in that order
// and in no other sense ordered: the drag runs in any of four directions, and
// normalising is this file's job.
export interface MarqueeRect {
  from: { x: number; y: number }
  to: { x: number; y: number }
}

// The handles on one room: one per resizable edge run, plus a target per
// interior vertex.
//
// The tolerances arrive from `canvas/drawZone.ts` rather than being chosen
// here, so the handle and the thing it grabs cannot disagree. They apply to
// the hovered handle, which is drawn as exactly the region that will catch
// the pointer; idle handles are deliberately smaller hints. See `drawHandles`.
export interface HandleRoomScene {
  room: Room
  band: number
  vertexRadius: number
  // The handle under the pointer, which is drawn at full grab size while the
  // rest stay faint. Null when the pointer is elsewhere.
  //
  // A run is identified by its first edge rather than by object identity: the
  // derived runs are memoised on the room's revision, so identity would hold
  // usually and break silently the moment the room changed between the
  // pointer move and the draw. Each edge belongs to exactly one run, so the
  // first one names it uniquely.
  hovered: HoveredHandle | null
  // The cell the pointer is in. Vertex targets are revealed only near it: see
  // `VERTEX_REVEAL_CELLS`. Null when there is no pointer on the canvas, which
  // draws no vertex targets at all.
  pointerCell: { x: number; y: number } | null
  // Which families of handle to draw at all. The sub-mode lock reaches the
  // rendering, not just the gesture dispatch: a handle for a row no press can
  // reach is an invitation to a gesture that will not happen.
  //
  // Two booleans rather than the lock itself: this file has no business knowing
  // what a sub-mode is, and the caller derives both from the same record the
  // dispatch filters on (`gestures/subMode.ts`), so they cannot disagree.
  handles: { runs: boolean; vertices: boolean }
}

export type HoveredHandle =
  { kind: 'run'; edge: EdgeKey } | { kind: 'vertex'; vertex: { x: number; y: number } }

// Where the brush would land. A rectangle rather than a cell set because the
// v1 brush is square by definition, so its outline is one stroked rect and
// needs no path per cell. The day a non-square shape lands, this becomes a
// cell set and the drawing below becomes a boundary trace.
export interface BrushPreview {
  // Top-left cell of the block.
  col: number
  row: number
  size: number
}

// What a live gesture needs drawn on top of the model.
//
// Deliberately small, and it will stay small: gestures apply speculatively, so
// while a drag is live the model already is the pending result and rooms
// draw through the ordinary path. Only what the user could not otherwise see
// belongs here.
export interface GhostScene {
  // Cells the live gesture is about to take off another room, so the user sees
  // what they are about to eat before releasing a destructive merge with no
  // confirmation and no toggle.
  //
  // Cells, not rooms: the two gestures that fill this in disagree about how
  // many of them there are, which is why it is cells. A paint merge is
  // whole-room by design, so `paintStroke` puts in every cell of every room
  // the stroke will swallow; an edge-run expansion vacates only the cells it
  // lands on, so `runResize` puts in exactly those. Both collect them before
  // the apply that takes them, when the map still says who owns what.
  absorbing: ReadonlySet<CellKey>
}

// Wall weight in CSS px at zoom 1, scaled by zoom and then clamped so walls
// neither vanish when zoomed out nor swell into slabs when zoomed in.
//
// A clamped hybrid: it tracks zoom, so walls belong to the map rather than
// floating above it, but the clamp keeps them legible at low zoom and stops
// them turning into slabs at high. Hit-testing tolerance should be derived
// from these rather than picking its own numbers.
const OUTER_WALL_PX = 2
const INNER_WALL_PX = 1
const MIN_WALL_PX = 1
const MAX_WALL_PX = 6

// A door's marker, drawn in the hole its own wall gap left. Deliberately
// heavier than the wall it interrupts: the marker has to read as something
// filling the opening rather than as a stubbornly unbroken piece of wall.
const DOOR_MARKER_PX = 5
const MIN_MARKER_PX = 2

// How much of a cell an icon's badge covers, leaving a margin so adjacent
// badges stay distinct.
const ICON_CELL_FRACTION = 0.8

// A markup line's weight, clamped like the walls so it survives both ends of
// the zoom range. Heavier than a teleport's hairline: a teleport line is a
// derived hint between two markers, where this one is the object the user drew.
const MARKUP_LINE_PX = 3
const MAX_MARKER_PX = 12

// How much of a cell a transition's mark occupies across its own axis: the
// shaft's band, the teleport's square, the elevator end's stripe.
//
// One fraction for all three on purpose. They are one visual layer over the
// rooms, and three independently chosen insets would read as three unrelated
// kinds of object rather than as the transition layer.
const TRANSITION_FRACTION = 0.44

// The teleport line's weight. Faintness is the palette's job, not this
// number's (see `CanvasPalette.teleportLine`), so the line stays a hairline
// and only its alpha says "faint".
const TELEPORT_LINE_PX = 1.5

// The one-way arrowhead, in screen px, clamped like the walls so it survives
// both ends of the zoom range.
const ARROW_PX = 11
const MIN_ARROW_PX = 5
const MAX_ARROW_PX = 22

// The cross-tab marker's letter, as a fraction of the marker it sits in.
const MARKER_TEXT_FRACTION = 0.5

// The canvas cannot use CSS, so the one bit of text on the map names its own
// stack. Kept to the system UI faces the rest of the chrome uses, so the label
// does not read as a different application's text.
const MARKER_FONT = "system-ui, 'Segoe UI', Roboto, sans-serif"

// A markup label: text on a chip. Everything here is in screen pixels and does
// not scale with the map, unlike the marker letter above, which sizes to the
// marker it sits inside. A label has nothing to sit inside, and it is read
// rather than measured, so shrinking it with zoom would make it illegible
// exactly when the map got dense enough to need it.
const LABEL_PX = 11
const LABEL_PAD_X = 4
const LABEL_PAD_Y = 2
const LABEL_RADIUS = 3
// Between an icon's badge and the chip under it.
const LABEL_GAP = 3

// Idle handle weights, as a fraction of the drawn cell, so they shrink with
// zoom and fade toward invisible below 100%, where you are reading layout
// rather than editing geometry. The hovered handle ignores these and uses the
// grab region instead.
//
// At a 32px cell these come out to a ~3px run band and a ~4.5px vertex square.
const IDLE_RUN_FRACTION = 0.09
const IDLE_VERTEX_FRACTION = 0.07

// How far from the pointer's cell an interior vertex is revealed, in cells
// (Chebyshev, so a square window). A 20x20 room has 361 interior vertices;
// without this window all of them would draw as targets. Revealing a 5x5
// window instead means at most 25, wherever the pointer is.
//
// Measured in cells, not pixels, and against the pointer's cell rather than
// its exact position. Cells, because that keeps the revealed count constant
// at every zoom, where a screen-pixel radius would expose the whole lattice
// zoomed out. The cell rather than the point, because the revealed set then
// changes only when the pointer crosses a cell boundary, which is what lets
// the component gate its repaints instead of redrawing on every mouse move.
const VERTEX_REVEAL_CELLS = 2

// A doorway is a segment missing its center, so it draws as two stubs with a
// gap between them. A third each way leaves a gap wide enough to read as a
// gap at low zoom.
const DOORWAY_STUB = 1 / 3

const DOTTED_DASH = [3, 3] as const

// The rubber-band box's outline weight, in screen pixels at every zoom.
const BOX_PREVIEW_PX = 2

// How far a selection halo stands proud of the thing it surrounds, per side, in
// screen pixels. A screen measure rather than a world one because it is chrome:
// at low zoom a world-scaled halo would vanish exactly when the map is too small
// to see what is selected any other way.
const SELECTION_HALO_PX = 3

// The drawn weight of an outer wall at a given zoom.
//
// Exported because hit-testing derives its grab band from it (see
// `hitTest.ts`): a band narrower than the line it grabs is unusable, and two
// constants that are meant to agree but are written down twice will drift.
// Outer rather than inner, because it is the thicker of the two: a band sized
// for the thicker line grabs both.
export function wallWidth(zoom: number): number {
  return clamp(OUTER_WALL_PX * zoom, MIN_WALL_PX, MAX_WALL_PX)
}

function doorMarkerWidth(zoom: number): number {
  return clamp(DOOR_MARKER_PX * zoom, MIN_MARKER_PX, MAX_MARKER_PX)
}

export function renderMap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: MapScene,
) {
  const { camera, bounds, tileSize, palette } = scene

  ctx.clearRect(0, 0, width, height)

  // Pasteboard first, as the backdrop for everything outside the page.
  ctx.fillStyle = palette.pasteboard
  ctx.fillRect(0, 0, width, height)

  const topLeft = worldToScreen(bounds.minCol, bounds.minRow, camera, tileSize)
  const bottomRight = worldToScreen(bounds.maxCol + 1, bounds.maxRow + 1, camera, tileSize)

  ctx.fillStyle = palette.page
  ctx.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y)

  // Order matters and is the whole layout of this function: the grid belongs
  // under the rooms, so it reads as the paper they sit on rather than as
  // lines drawn over them.
  if (scene.showGrid) drawGrid(ctx, scene, topLeft, bottomRight)

  const map = scene.map
  if (!map) return

  // Doors are computed before the walls and drawn after them, because the two
  // are one thing seen twice: the wall is absent exactly where the marker sits.
  // Deriving the runs once here is also what keeps the two from disagreeing:
  // `drawWalls` is handed the gaps rather than working them out again.
  //
  // Both lists go empty when the layer is hidden, and that single line is the
  // whole of the toggle for four of the five transition layers below. A hidden
  // door's wall closes back up: the gap is not decoration on a door, it is the
  // door's own rendering, so leaving the hole while hiding the marker would
  // show a wall with an unexplained opening in it.
  const doors = scene.showTransitions ? doorRuns(map) : []
  const shafts = scene.showTransitions ? elevatorShafts(map) : []

  // Elevator shafts are the one layer under the rooms: a shaft renders behind
  // room cells and only draws in empty cells, so a third room in the gap
  // covers it. Under the fills but over the page, which is the other half of
  // that: the pasteboard fill would otherwise eat it.
  drawShafts(ctx, scene, shafts)
  drawRoomFills(ctx, scene, map)
  // A selected room's halo shares the slot with the transition halo below, and
  // for the same reason: it is the room's own outline drawn wider, so the wall
  // has to paint back over the middle of it.
  //
  // First of the two, so a selected door on a selected room's wall reads as the
  // door it is rather than as a bulge in the room's outline.
  if (scene.selectedRooms.size > 0) drawRoomSelection(ctx, scene, map)
  // The selection halo goes here: over the room fills, under the walls and
  // under every transition it surrounds. That ordering is what makes it a halo
  // rather than a highlight: it is the same shape drawn wider, so it can only
  // read as an outline if the thing it marks is painted on top of it.
  //
  // Above the fills rather than below because a selected door's halo has to be
  // visible against the room it sits on, and the fills would eat it.
  //
  // Gated on the layer as a whole rather than left to the empty `doors` and
  // `shafts` above, because the teleport branch reads `scene.teleports`
  // directly: without this, hiding the layer would leave a selected teleport
  // as an orange ring around nothing.
  if (scene.showTransitions && scene.selected.size > 0) drawSelection(ctx, scene, doors, shafts)
  // Between the fills and the walls: the tint marks cells, and walls drawn over
  // it stay crisp instead of being washed out by it.
  if (scene.ghost) drawGhost(ctx, scene, scene.ghost)
  drawWalls(ctx, scene, map, wallGaps(doors))
  drawDoors(ctx, scene, doors)
  // After the walls, because an elevator's end marker sits on the wall where
  // the shaft meets the room. Unlike a door, it does not break it.
  drawElevatorEnds(ctx, scene, shafts)
  // Last of the map layers: transitions are painted on top of the room layer,
  // and a teleport link crosses arbitrary rooms, so burying it under them
  // would leave a line that stops and starts.
  //
  // The one layer the master gates here rather than through an emptied list,
  // because its scene is prepared by the caller: see `MapScene.teleports`.
  if (scene.showTransitions) drawTeleports(ctx, scene, scene.teleports)
  // Lines then icons, above every other map layer, so paint order matches
  // Markup's hit priority: a click finds the icon before the line and the line
  // before anything under it, and burying either would show the opposite.
  //
  // Lines are an overlay with no room owner, so they sit above the transitions
  // they are free to cross rather than among them.
  // Before both layers, so each object paints back over the middle of its own
  // halo and leaves a ring, the way a selected teleport's marker does.
  drawMarkupSelection(ctx, scene, map)
  if (scene.showLines) drawLines(ctx, scene, map)
  if (scene.showIcons) drawIcons(ctx, scene, map)
  // After both, so a label is never buried under the neighbour it sits beside.
  // It is text at a fixed size on a chip, which makes it the loudest thing on
  // the map; drawing it among the objects would let one icon's label read as
  // belonging to the next one along.
  drawLabels(ctx, scene, map)
  // Directly after the finished teleports, and deliberately: it is the same
  // marker in the same place, drawn hollow because it is not there yet. Sitting
  // it anywhere else in this list would let a wall or a room fill cross the one
  // mark that says the app is waiting for a second click.
  //
  // Not gated on the layer, and neither is the box preview below. These are
  // the live gesture, not the map: hiding a layer is a statement about what the
  // map shows, and it cannot be allowed to swallow the one mark that says the
  // app is mid-interaction and waiting for you. In practice Door mode forces
  // the layer on anyway, so this only bites if a later mode grows a pending
  // state.
  if (scene.pendingTeleport) drawPendingTeleport(ctx, scene, scene.pendingTeleport)
  // Over the walls, because a run handle sits exactly on the wall it resizes.
  if (scene.handleRoom) drawHandles(ctx, scene, scene.handleRoom)
  // Last, so the aiming aid is never hidden under a wall it is about to paint
  // over. It is a cursor, not part of the map.
  if (scene.brushPreview) drawBrushPreview(ctx, scene, scene.brushPreview)
  // Over everything for the same reason, and over the transition it is about to
  // create: the box is the gesture, and the gesture has to stay legible on top
  // of its own result.
  if (scene.boxPreview) drawBoxPreview(ctx, scene, scene.boxPreview)
  // Last, over the rooms it is sweeping and over the halos they are gaining as
  // it goes: it is the live gesture, and a translucent sheet the map shows
  // through is only readable if nothing is drawn on top of it.
  if (scene.marquee) drawMarquee(ctx, scene, scene.marquee)
}

// Draws one room's resize handles: the grab zones from `drawZone.ts`, made
// visible.
//
// Idle handles scale with the cell, so they shrink out of the way as you zoom
// out. The hovered handle inflates to its full grab region in screen pixels, so
// the target is drawn exactly as large as the region that catches the pointer.
//
// Vertex targets draw square where the grab region is a disc: the fake canvas
// contexts in the tests have no `arc()`.
function drawHandles(ctx: CanvasRenderingContext2D, scene: MapScene, active: HandleRoomScene) {
  const { room, band, vertexRadius, hovered, pointerCell, handles } = active
  const cellPx = scene.tileSize * scene.camera.zoom

  // Idle weights, as a fraction of the drawn cell: see the note above on why
  // these track the cell rather than the screen.
  const idleRunWidth = cellPx * IDLE_RUN_FRACTION
  const idleVertexRadius = cellPx * IDLE_VERTEX_FRACTION

  ctx.setLineDash([])
  for (const run of handles.runs ? resizableRuns(room) : []) {
    const isHovered = hovered?.kind === 'run' && hovered.edge === run.edges[0]
    ctx.strokeStyle = isHovered ? scene.palette.handleHover : scene.palette.handle
    // Hovered: the grab band's full width. The band is a distance threshold, so
    // the region it describes spans it on both sides of the wall.
    ctx.lineWidth = isHovered ? band * 2 : idleRunWidth
    ctx.beginPath()
    // One stroke along the whole run, not one per edge: the grabbed-run-only
    // rule means the run is the unit the user grabs, so it is the unit that
    // should look grabbable.
    const first = segmentFromEdge(run.edges[0])
    const last = segmentFromEdge(run.edges[run.edges.length - 1])
    const from = worldToScreen(first[0][0], first[0][1], scene.camera, scene.tileSize)
    const to = worldToScreen(last[1][0], last[1][1], scene.camera, scene.tileSize)
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }
  ctx.lineWidth = 1

  // Vertex targets appear only around the pointer. With no pointer on the
  // canvas there is nothing to reveal them, which is deliberate on desktop,
  // and works on touch because `pointerCell` follows the last press as well
  // as hover, so the tap-to-arm-then-drag two-step reveals the local lattice
  // with the same tap that arms the room.
  if (!pointerCell || !handles.vertices) return

  for (const vertex of interiorVertices(room)) {
    if (
      Math.abs(vertex.x - pointerCell.x) > VERTEX_REVEAL_CELLS ||
      Math.abs(vertex.y - pointerCell.y) > VERTEX_REVEAL_CELLS
    ) {
      continue
    }
    const isHovered =
      hovered?.kind === 'vertex' && hovered.vertex.x === vertex.x && hovered.vertex.y === vertex.y
    const radius = isHovered ? vertexRadius : idleVertexRadius
    ctx.fillStyle = isHovered ? scene.palette.handleHover : scene.palette.handle
    const at = worldToScreen(vertex.x, vertex.y, scene.camera, scene.tileSize)
    ctx.fillRect(at.x - radius, at.y - radius, radius * 2, radius * 2)
  }
}

function drawBrushPreview(ctx: CanvasRenderingContext2D, scene: MapScene, preview: BrushPreview) {
  const { col, row, size } = preview
  const topLeft = worldToScreen(col, row, scene.camera, scene.tileSize)
  const bottomRight = worldToScreen(col + size, row + size, scene.camera, scene.tileSize)

  ctx.strokeStyle = scene.palette.brush
  // Deliberately not the wall weight: this is chrome over the map, not part of
  // it, so it stays one crisp screen pixel at every zoom rather than growing
  // with the drawing.
  ctx.lineWidth = 1
  ctx.setLineDash([])
  traceRect(ctx, topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y)
  ctx.stroke()
}

// The rubber-band box, and its verdict.
//
// A valid box says almost nothing here: the door or shaft it would make is
// already on the canvas, applied speculatively, so the rectangle is just the
// aiming aid that says which cells the classification read. An invalid one
// is the opposite: nothing was applied, so this outline is the entire feedback,
// and it has to read as a refusal rather than as an aid that has not landed yet.
// Dashed and in the refusal colour, where a valid box is solid and cool.
function drawBoxPreview(ctx: CanvasRenderingContext2D, scene: MapScene, preview: BoxPreview) {
  const from = parseCell(preview.from)
  const to = parseCell(preview.to)
  const topLeft = worldToScreen(
    Math.min(from.x, to.x),
    Math.min(from.y, to.y),
    scene.camera,
    scene.tileSize,
  )
  const bottomRight = worldToScreen(
    Math.max(from.x, to.x) + 1,
    Math.max(from.y, to.y) + 1,
    scene.camera,
    scene.tileSize,
  )

  const refused = preview.outcome === 'invalid'
  ctx.strokeStyle = refused ? scene.palette.refuse : scene.palette.brush
  // Heavier than the brush's single pixel, and deliberately so: that one is an
  // aiming aid beside the pointer, this one is the gesture. Still a screen
  // measure rather than a world one, because both are chrome over the map.
  ctx.lineWidth = BOX_PREVIEW_PX
  ctx.setLineDash(refused ? [...DOTTED_DASH] : [])
  traceRect(ctx, topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.lineWidth = 1
}

// A selected room's halo: the room's own outline, drawn wider and in the same
// warm colour every other halo uses. A room has no marker of its own to
// thicken, and its shape is the outline of its cells, so that outline is what
// gets drawn wider.
//
// One path per room rather than one over the whole selection, which is what
// makes two adjacent selected rooms read as two: a shared boundary is an outer
// wall of both, so each traces its own copy and the line between them survives.
// Tracing the union would drop exactly that edge and merge the pair into a blob.
//
// Doorways are not cut out of it, where `drawWalls` cuts them from the wall.
// The halo marks the room's shape, and its shape is its boundary rather than its
// walls minus their openings, so the outline stays continuous through a door.
//
// Square caps because the outline is traced edge by edge: each segment has to
// reach the corner the next one starts from, or a halo this thick shows a notch
// at every turn.
function drawRoomSelection(ctx: CanvasRenderingContext2D, scene: MapScene, map: MapModel) {
  ctx.strokeStyle = scene.palette.selection
  ctx.lineWidth = wallWidth(scene.camera.zoom) + SELECTION_HALO_PX * 2
  ctx.lineCap = 'square'
  ctx.setLineDash([])

  for (const roomId of scene.selectedRooms) {
    const room = map.rooms.get(roomId)
    if (!room) continue
    ctx.beginPath()
    for (const edge of outerWalls(room)) traceEdge(ctx, edge, scene)
    ctx.stroke()
  }

  ctx.lineCap = 'butt'
  ctx.lineWidth = 1
}

// The selection halo: each selected transition's own shape, drawn wider and in
// one warm colour underneath it.
//
// One treatment for all three kinds, and it has to work when there is nothing
// there. A colourless `Open` door draws no marker at all: the gap it broke is
// the whole of it, so a halo that merely thickened an existing mark would leave
// the most common door in the app unable to look selected. Drawing the shape
// itself, wider, is what makes selection independent of whether the transition
// had anything to draw.
//
// The teleport's line is left alone deliberately: it can cross the whole map,
// and a full-length halo would be a stripe across unrelated rooms rather than a
// mark on an object. The two endpoint markers carry the selection instead, which
// is also what the user clicked.
function drawSelection(
  ctx: CanvasRenderingContext2D,
  scene: MapScene,
  doors: readonly DoorRun[],
  shafts: readonly ElevatorShaft[],
) {
  const halo = doorMarkerWidth(scene.camera.zoom) + SELECTION_HALO_PX * 2

  ctx.strokeStyle = scene.palette.selection
  ctx.fillStyle = scene.palette.selection
  ctx.lineWidth = halo
  ctx.setLineDash([])

  for (const run of doors) {
    if (!scene.selected.has(run.id)) continue
    const { from, to } = openingOnScreen(run, scene)
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }

  for (const shaft of shafts) {
    if (!scene.selected.has(shaft.id)) continue
    // Both facing edges, which are the two things a user can actually point at:
    // the shaft between them is drawn behind the rooms and is not a target.
    for (const edge of shaft.ends) {
      const { from, to } = edgeSpan(edge, scene, TRANSITION_FRACTION)
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
    }
  }
  ctx.lineWidth = 1

  for (const end of scene.teleports.ends) {
    if (!scene.selected.has(end.id)) continue
    // A filled square a halo's width proud of the marker on every side, so the
    // marker paints back over the middle of it and leaves a ring.
    const [x, y, width, height] = cellRect(end.cell, scene)
    const inset = (width * (1 - TRANSITION_FRACTION)) / 2 - SELECTION_HALO_PX
    ctx.fillRect(x + inset, y + inset, width - inset * 2, height - inset * 2)
  }
}

// The pending teleport's origin: the endpoint marker it is going to become,
// drawn as an outline instead of a fill.
//
// The same square in the same place as a real endpoint, hollow and dashed.
// That is the whole design, and it is the ghosting language the app already
// speaks: a dashed outline is a thing that has not committed. A solid one
// would say the teleport exists, when nothing is committed and nothing is on
// the undo stack yet.
//
// In `transition` rather than `refuse`: the box preview earns its red by
// classifying to nothing, where a pending origin is a perfectly good half of a
// perfectly good teleport. Nothing has gone wrong; the app is waiting.
function drawPendingTeleport(ctx: CanvasRenderingContext2D, scene: MapScene, cell: CellKey) {
  const [x, y, width, height] = cellRect(cell, scene)
  const inset = (width * (1 - TRANSITION_FRACTION)) / 2

  ctx.strokeStyle = scene.palette.transition
  // The box preview's weight, not a wall's: both are chrome drawn over the map
  // at a fixed screen size, and both are the gesture rather than the result.
  ctx.lineWidth = BOX_PREVIEW_PX
  ctx.setLineDash([...DOTTED_DASH])
  traceRect(ctx, x + inset, y + inset, width - inset * 2, height - inset * 2)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.lineWidth = 1
}

// The marquee: a translucent sheet over everything it has swept, plus an
// outline so its edges are exact.
//
// The one rectangle here that is filled, because it is the one whose interior
// carries the meaning. The brush footprint and the rubber-band box both say
// "these cells" and can say it with an outline; this says "everything inside
// me", and the fill is how far that reaches.
//
// No cell arithmetic anywhere: the corners are world points already, where a
// `CellKey` names a cell that has to be grown by one to cover itself.
function drawMarquee(ctx: CanvasRenderingContext2D, scene: MapScene, marquee: MarqueeRect) {
  const { from, to } = marquee
  const topLeft = worldToScreen(
    Math.min(from.x, to.x),
    Math.min(from.y, to.y),
    scene.camera,
    scene.tileSize,
  )
  const bottomRight = worldToScreen(
    Math.max(from.x, to.x),
    Math.max(from.y, to.y),
    scene.camera,
    scene.tileSize,
  )
  const width = bottomRight.x - topLeft.x
  const height = bottomRight.y - topLeft.y

  ctx.fillStyle = scene.palette.marqueeFill
  ctx.fillRect(topLeft.x, topLeft.y, width, height)

  ctx.strokeStyle = scene.palette.marquee
  ctx.lineWidth = BOX_PREVIEW_PX
  ctx.setLineDash([])
  traceRect(ctx, topLeft.x, topLeft.y, width, height)
  ctx.stroke()
  ctx.lineWidth = 1
}

// A rectangle as a path, for the outlines that are chrome rather than map: the
// brush footprint, the rubber-band box, the pending teleport's origin and the
// marquee. Deliberately not `strokeRect`: three separate fake contexts exist
// in the tests, and every new context method has to be added to all three or
// one suite fails on a missing function.
//
// Leaves the path open rather than stroking, because the callers differ in what
// they set up around it and one of them (the brush) wants no dash where another
// does.
function traceRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + width, y)
  ctx.lineTo(x + width, y + height)
  ctx.lineTo(x, y + height)
  ctx.lineTo(x, y)
}

function drawGhost(ctx: CanvasRenderingContext2D, scene: MapScene, ghost: GhostScene) {
  if (ghost.absorbing.size === 0) return
  ctx.fillStyle = scene.palette.absorb
  for (const cell of ghost.absorbing) {
    const [x, y, w, h] = cellRect(cell, scene)
    ctx.fillRect(x, y, w, h)
  }
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  scene: MapScene,
  topLeft: { x: number; y: number },
  bottomRight: { x: number; y: number },
) {
  const { camera, bounds, tileSize, palette } = scene

  // One path for every line, stroked once: an order of magnitude fewer
  // canvas state changes than stroking each line separately.
  ctx.strokeStyle = palette.grid
  ctx.lineWidth = 1
  ctx.setLineDash([])
  ctx.beginPath()
  for (let col = bounds.minCol; col <= bounds.maxCol + 1; col++) {
    const x = worldToScreen(col, 0, camera, tileSize).x
    ctx.moveTo(x, topLeft.y)
    ctx.lineTo(x, bottomRight.y)
  }
  for (let row = bounds.minRow; row <= bounds.maxRow + 1; row++) {
    const y = worldToScreen(0, row, camera, tileSize).y
    ctx.moveTo(topLeft.x, y)
    ctx.lineTo(bottomRight.x, y)
  }
  ctx.stroke()
}

// Markup lines: a polyline through the centres of the cells it was drawn
// across, in the line's own colour.
//
// One path per line rather than one batched path for all of them, because the
// colour is per line. Round joins and caps because a step may turn 45 degrees
// or double back on itself, and a mitred join at those angles throws a spike
// well outside the line.
//
// Nothing here consults rooms. A line has no room owner and may run over rooms,
// over transitions and across empty grid alike.
function drawLines(ctx: CanvasRenderingContext2D, scene: MapScene, map: MapModel) {
  const width = clamp(MARKUP_LINE_PX * scene.camera.zoom, MIN_WALL_PX, MAX_WALL_PX)

  for (const line of map.lines.values()) {
    if (line.points.length < 2) continue

    ctx.strokeStyle = line.color
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.setLineDash([])
    tracePath(ctx, line.points, scene)
    ctx.stroke()
    const start = worldPointOf(line.points[0], scene)

    // In the line's own colour, unlike a teleport's arrow: that one sits on a
    // shaft it would vanish into, where this one is part of the line it ends.
    if (line.arrowStart) {
      drawArrow(ctx, scene, start, headingOf(line.points[1], line.points[0], scene), line.color)
    }
    if (line.arrowEnd) {
      const last = line.points.length - 1
      drawArrow(
        ctx,
        scene,
        worldPointOf(line.points[last], scene),
        headingOf(line.points[last - 1], line.points[last], scene),
        line.color,
      )
    }
  }

  ctx.lineJoin = 'miter'
  ctx.lineCap = 'butt'
  ctx.lineWidth = 1
}

// The unit vector from one cell centre to another, in screen space. Zero length
// cannot happen on a normalised path, which never repeats a cell, but a guard
// costs less than a NaN reaching the canvas.
function headingOf(from: CellKey, to: CellKey, scene: MapScene): { dx: number; dy: number } {
  const a = worldPointOf(from, scene)
  const b = worldPointOf(to, scene)
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return { dx: (b.x - a.x) / length, dy: (b.y - a.y) / length }
}

// Icons: one badge per icon, snapped to its cell and centred.
//
// The badge is square and inset within the cell, so a run of icons in adjacent
// cells reads as separate marks rather than as a continuous band.
//
// Colours come off the icon itself, not off its registry entry, so an unknown
// type still draws in the colours the user chose for it.
function drawIcons(ctx: CanvasRenderingContext2D, scene: MapScene, map: MapModel) {
  for (const icon of map.icons.values()) {
    const [x, y, w, h] = cellRect(icon.cell, scene)
    const size = w * ICON_CELL_FRACTION
    drawIconBadge(ctx, scene.iconArt.get(icon.iconType) ?? UNKNOWN_ICON_ART, icon, {
      x: x + (w - size) / 2,
      y: y + (h - size) / 2,
      size,
    })
  }
}

// A line's polyline through its cell centres. Shared by the line and by its
// selection halo, so the two shapes cannot drift: a halo that traced the path
// differently would show as a fringe along one side.
function tracePath(ctx: CanvasRenderingContext2D, points: readonly CellKey[], scene: MapScene) {
  ctx.beginPath()
  const start = worldPointOf(points[0], scene)
  ctx.moveTo(start.x, start.y)
  for (const point of points.slice(1)) {
    const at = worldPointOf(point, scene)
    ctx.lineTo(at.x, at.y)
  }
}

// The halo behind a selected icon or line: the object's own shape drawn wider
// underneath it, which is the language a selected transition already speaks.
//
// Gated per layer rather than as a whole, so hiding icons takes a selected
// icon's halo with it. A ring around nothing would be worse than no ring.
//
// Arrowheads are deliberately not haloed. A chevron widened by three pixels
// reads as a blob rather than as an outline, and the line it caps is haloed
// right up to it.
function drawMarkupSelection(ctx: CanvasRenderingContext2D, scene: MapScene, map: MapModel) {
  if (scene.selectedMarkup.size === 0) return

  ctx.strokeStyle = scene.palette.selection

  if (scene.showLines) {
    const width = clamp(MARKUP_LINE_PX * scene.camera.zoom, MIN_WALL_PX, MAX_WALL_PX)
    ctx.lineWidth = width + SELECTION_HALO_PX * 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.setLineDash([])
    for (const line of map.lines.values()) {
      if (!scene.selectedMarkup.has(line.id) || line.points.length < 2) continue
      tracePath(ctx, line.points, scene)
      ctx.stroke()
    }
    ctx.lineJoin = 'miter'
    ctx.lineCap = 'butt'
    ctx.lineWidth = 1
  }

  if (scene.showIcons) {
    for (const icon of map.icons.values()) {
      if (!scene.selectedMarkup.has(icon.id)) continue
      const [x, y, w, h] = cellRect(icon.cell, scene)
      const size = w * ICON_CELL_FRACTION + SELECTION_HALO_PX * 2
      drawIconPlate(
        ctx,
        scene.iconArt.get(icon.iconType) ?? UNKNOWN_ICON_ART,
        scene.palette.selection,
        {
          x: x + (w - size) / 2,
          y: y + (h - size) / 2,
          size,
        },
      )
    }
  }
}

// The labels icons and lines carry, drawn together rather than beside the
// objects they belong to, so the whole "when is a label visible" rule is in one
// place and paint order puts every label over every object.
//
// Each is gated by its own layer, so hiding icons takes their labels with them.
// An empty label draws nothing: it is the default for every object, and a chip
// with nothing in it would mark every icon on the map.
function drawLabels(ctx: CanvasRenderingContext2D, scene: MapScene, map: MapModel) {
  // A fast path, not a rule: `labelShows` below would reject everything anyway.
  // It is here because this is the common case (no toggle, nothing hovered) and
  // without it every pan and zoom frame walks both collections to draw nothing.
  if (!scene.showAllLabels && scene.hoveredLabel === null) return

  ctx.font = `${LABEL_PX}px ${MARKER_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (scene.showLines) {
    for (const line of map.lines.values()) {
      if (!labelShows(scene, line.id, line.label)) continue
      drawLabelChip(ctx, scene, line.label, lineLabelAt(line.points, scene))
    }
  }
  // Icons last, matching the layer order below them: where an icon and a line
  // would put a chip in the same place, the icon's is the one on top.
  if (scene.showIcons) {
    for (const icon of map.icons.values()) {
      if (!labelShows(scene, icon.id, icon.label)) continue
      const [x, y, w, h] = cellRect(icon.cell, scene)
      const badge = w * ICON_CELL_FRACTION
      drawLabelChip(ctx, scene, icon.label, {
        // Under the badge rather than over it: an icon's own cell is the one
        // place a label must not cover, since the badge is what identifies it.
        x: x + w / 2,
        y: y + (h + badge) / 2 + LABEL_GAP + (LABEL_PX + LABEL_PAD_Y * 2) / 2,
      })
    }
  }
}

function labelShows(scene: MapScene, id: string, label: string): boolean {
  return label !== '' && (scene.showAllLabels || scene.hoveredLabel === id)
}

// Above the middle of the drawn path. One expression for both parities: an odd
// count resolves to its centre vertex, an even one to the midpoint of the two
// either side of centre.
//
// Lifted clear rather than centred on the path, for the reason the icon's chip
// is dropped below its badge: a chip is wider than a stroke, so a label sitting
// on a short line would hide the whole line it names. Straight up rather than
// perpendicular to the local heading, which is the honest limit of this: a
// vertical line's chip slides along the line instead of off it.
function lineLabelAt(points: readonly CellKey[], scene: MapScene) {
  const middle = (points.length - 1) / 2
  const before = worldPointOf(points[Math.floor(middle)], scene)
  const after = worldPointOf(points[Math.ceil(middle)], scene)
  return {
    x: (before.x + after.x) / 2,
    y: (before.y + after.y) / 2 - LABEL_GAP - (LABEL_PX + LABEL_PAD_Y * 2) / 2,
  }
}

function drawLabelChip(
  ctx: CanvasRenderingContext2D,
  scene: MapScene,
  text: string,
  at: { x: number; y: number },
) {
  const width = ctx.measureText(text).width + LABEL_PAD_X * 2
  const height = LABEL_PX + LABEL_PAD_Y * 2

  ctx.fillStyle = scene.palette.labelPlate
  ctx.beginPath()
  ctx.roundRect(at.x - width / 2, at.y - height / 2, width, height, LABEL_RADIUS)
  ctx.fill()

  ctx.fillStyle = scene.palette.labelText
  ctx.fillText(text, at.x, at.y)
}

// Rooms grouped by fill colour, so a project with a handful of areas costs a
// handful of `fillStyle` changes rather than one per room.
function drawRoomFills(ctx: CanvasRenderingContext2D, scene: MapScene, map: MapModel) {
  const byColor = new Map<string, CellKey[]>()

  for (const roomId of map.roomOrder) {
    const room = map.rooms.get(roomId)
    if (!room) continue
    const fill = fillOf(room, scene)
    const cells = byColor.get(fill)
    if (cells) cells.push(...room.cells)
    else byColor.set(fill, [...room.cells])
  }

  for (const [fill, cells] of byColor) {
    ctx.fillStyle = fill
    for (const cell of cells) {
      const [x, y, w, h] = cellRect(cell, scene)
      ctx.fillRect(x, y, w, h)
    }
  }
}

// Outer walls come from `derive/walls.ts`: never stored, memoised on the
// room's revision, and the user can never add or remove one by hand. Inner
// walls are the stored ones, and the only ones with a style.
//
// `gaps` is where the doors are: a transition on a shared wall breaks the wall
// at its location (a doorway gap) rather than a box sitting over an unbroken
// wall. Outer walls only, because a shared boundary is an outer wall of both
// rooms and each draws its own side of it; a door on an inner wall is not a
// thing the model can express.
function drawWalls(
  ctx: CanvasRenderingContext2D,
  scene: MapScene,
  map: MapModel,
  gaps: ReadonlyMap<EdgeKey, OpenSpan>,
) {
  const zoom = scene.camera.zoom
  const outerWidth = wallWidth(zoom)
  const innerWidth = clamp(INNER_WALL_PX * zoom, MIN_WALL_PX, MAX_WALL_PX)

  for (const roomId of map.roomOrder) {
    const room = map.rooms.get(roomId)
    if (!room) continue
    const stroke = wallOf(room, scene)

    ctx.strokeStyle = stroke
    ctx.lineWidth = outerWidth
    ctx.setLineDash([])
    ctx.beginPath()
    for (const edge of outerWalls(room)) traceEdgeAround(ctx, edge, scene, gaps.get(edge))
    ctx.stroke()

    if (room.innerWalls.size === 0) continue

    ctx.lineWidth = innerWidth
    for (const style of ['solid', 'dotted', 'doorway'] as WallStyle[]) {
      let any = false
      ctx.setLineDash(style === 'dotted' ? [...DOTTED_DASH] : [])
      ctx.beginPath()
      for (const [edge, edgeStyle] of room.innerWalls) {
        if (edgeStyle !== style) continue
        any = true
        if (style === 'doorway') traceDoorway(ctx, edge, scene)
        else traceEdge(ctx, edge, scene)
      }
      if (any) ctx.stroke()
    }
    ctx.setLineDash([])
  }
}

// Edge doors: the mark in the hole, and the one-way arrow through it.
//
// One marker per door object, not per segment. An N-wide door is one door;
// drawing it segment by segment would put a marker end inside the opening at
// every cell boundary, which reads as N doors in a row. `doorRuns` has already
// grouped the segments, and `doorOpening` measures the same span the wall gap
// was cut from, so the mark can never miss its hole.
//
// Grouped by colour so a map full of missile doors costs one `strokeStyle`
// change rather than one per door.
function drawDoors(ctx: CanvasRenderingContext2D, scene: MapScene, runs: readonly DoorRun[]) {
  const byColor = new Map<string, DoorRun[]>()
  for (const run of runs) {
    const color = markerColor(run, scene)
    // A colourless lock draws no marker at all: `Open` is permanently
    // colourless, and the gap the wall left is already the whole story.
    if (!color) continue
    const group = byColor.get(color)
    if (group) group.push(run)
    else byColor.set(color, [run])
  }

  if (byColor.size > 0) {
    ctx.lineWidth = doorMarkerWidth(scene.camera.zoom)
    ctx.setLineDash([])
    for (const [color, group] of byColor) {
      ctx.strokeStyle = color
      ctx.beginPath()
      for (const run of group) {
        const { from, to } = openingOnScreen(run, scene)
        ctx.moveTo(from.x, from.y)
        ctx.lineTo(to.x, to.y)
      }
      ctx.stroke()
    }
    ctx.lineWidth = 1
  }

  // Arrows after the marker loop and outside it, because the colourless doors
  // skipped above still need theirs. The marker is optional; the arrow is the
  // only thing saying which way the door goes, so it never is.
  for (const run of runs) {
    if (!run.oneWay) continue
    const { from, to } = openingOnScreen(run, scene)
    drawArrow(
      ctx,
      scene,
      { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
      doorDirection(run),
      scene.palette.transition,
    )
  }
}

// The shaft itself: one band per empty gap cell, full width along the run and
// inset across it. The inset is what makes it read as passing through the gap
// rather than as a row of narrow rooms.
//
// Which cells those are is `elevators.ts`'s answer, not this function's: it
// only draws in empty cells, and a third room standing in the gap is legal.
function drawShafts(
  ctx: CanvasRenderingContext2D,
  scene: MapScene,
  shafts: readonly ElevatorShaft[],
) {
  ctx.fillStyle = scene.palette.transition
  for (const shaft of shafts) {
    for (const cell of shaft.openCells) {
      const [x, y, width, height] = cellRect(cell, scene)
      if (shaft.axis === 'h') {
        const inset = (height * (1 - TRANSITION_FRACTION)) / 2
        ctx.fillRect(x, y + inset, width, height - inset * 2)
      } else {
        const inset = (width * (1 - TRANSITION_FRACTION)) / 2
        ctx.fillRect(x + inset, y, width - inset * 2, height)
      }
    }
  }
}

// The two ends, each on the facing edge where the shaft meets its room, and
// each in the lock facing that room: having two distinct markers lets an
// elevator do this without the split marker an edge door would need.
//
// A colourless lock still draws its end, unlike a door's marker: a door with no
// colour is still visible as the gap it broke, where an elevator breaks no wall
// and a missing marker would simply be a missing end.
function drawElevatorEnds(
  ctx: CanvasRenderingContext2D,
  scene: MapScene,
  shafts: readonly ElevatorShaft[],
) {
  ctx.setLineDash([])
  ctx.lineWidth = doorMarkerWidth(scene.camera.zoom)

  for (const shaft of shafts) {
    const ends = ['a', 'b'] as const
    for (let i = 0; i < ends.length; i++) {
      ctx.strokeStyle = lockColor(shaft.locks[ends[i]], scene) ?? scene.palette.transition
      const { from, to } = edgeSpan(shaft.ends[i], scene, TRANSITION_FRACTION)
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
    }
  }
  ctx.lineWidth = 1

  for (const shaft of shafts) {
    // An elevator whose gap a third room has filled entirely is valid and draws
    // no shaft, so there is no cell for the arrow to sit in. Reaching for the
    // middle of an empty list is how that becomes a crash rather than a nothing.
    if (!shaft.oneWay || shaft.openCells.length === 0) continue
    const middle = shaft.openCells[Math.floor(shaft.openCells.length / 2)]
    // In the label colour, not the shaft's own: an arrow drawn in the colour of
    // the thing it sits on is invisible. An arrow contrasts with what it sits
    // on.
    drawArrow(
      ctx,
      scene,
      worldPointOf(middle, scene),
      shaftDirection(shaft),
      scene.palette.markerText,
    )
  }
}

// Teleports: the faint links first, then the markers, so a marker is never half
// covered by the line leaving it.
function drawTeleports(ctx: CanvasRenderingContext2D, scene: MapScene, teleports: TeleportScene) {
  const zoom = scene.camera.zoom

  // The sub-toggle, and the whole of it: it only hides the faint connecting
  // lines while keeping teleport endpoint markers, so it wraps the line and its
  // one-way arrow and stops there. `ends` below is outside it on purpose: a
  // teleport with its line hidden is still an object in two places, and hiding
  // the markers too would be the master toggle.
  if (scene.showTeleportLines && teleports.lines.length > 0) {
    ctx.strokeStyle = scene.palette.teleportLine
    ctx.lineWidth = clamp(TELEPORT_LINE_PX * zoom, MIN_WALL_PX, MAX_WALL_PX)
    ctx.setLineDash([])
    ctx.beginPath()
    for (const line of teleports.lines) {
      const from = worldPointOf(line.from, scene)
      const to = worldPointOf(line.to, scene)
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
    }
    ctx.stroke()

    for (const line of teleports.lines) {
      if (!line.oneWay) continue
      const from = worldPointOf(line.from, scene)
      const to = worldPointOf(line.to, scene)
      const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
      drawArrow(
        ctx,
        scene,
        { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
        { dx: (to.x - from.x) / length, dy: (to.y - from.y) / length },
        scene.palette.transition,
      )
    }
  }

  for (const end of teleports.ends) drawTeleportEnd(ctx, scene, end)
}

// One endpoint marker: a square in the cell's middle, in that end's lock colour,
// carrying a letter when the other end is on another tab.
//
// A teleport is a point in the room interior, not on an edge, and is capped at
// one per cell, so unlike a door it can own the middle of its cell outright. A
// colourless lock still draws the marker: a door with no colour is still visible
// as the gap it broke, but a teleport with no marker would simply not be there.
function drawTeleportEnd(ctx: CanvasRenderingContext2D, scene: MapScene, end: TeleportEnd) {
  const [x, y, width, height] = cellRect(end.cell, scene)
  const inset = (width * (1 - TRANSITION_FRACTION)) / 2

  ctx.fillStyle = lockColor(end.lock, scene) ?? scene.palette.transition
  ctx.fillRect(x + inset, y + inset, width - inset * 2, height - inset * 2)

  if (!end.leadsTo) return
  // The destination tab's first letter, which is the whole of the cross-tab
  // affordance: the marker says where it goes, and clicking it goes there.
  ctx.fillStyle = scene.palette.markerText
  ctx.font = `${Math.round(height * MARKER_TEXT_FRACTION)}px ${MARKER_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(end.leadsTo.label, x + width / 2, y + height / 2)
}

// A chevron pointing along `direction` (a unit vector), centred on `at`. Two
// lines rather than a filled triangle: a stroked head reads the same at these
// sizes, and it takes the stroke colour every caller already sets.
function drawArrow(
  ctx: CanvasRenderingContext2D,
  scene: MapScene,
  at: { x: number; y: number },
  direction: { dx: number; dy: number },
  color: string,
) {
  const size = clamp(ARROW_PX * scene.camera.zoom, MIN_ARROW_PX, MAX_ARROW_PX)
  const half = size / 2
  const apex = { x: at.x + direction.dx * half, y: at.y + direction.dy * half }
  const back = { x: at.x - direction.dx * half, y: at.y - direction.dy * half }
  // Perpendicular, so the two tails splay either side of the direction.
  const perp = { x: -direction.dy * half, y: direction.dx * half }

  ctx.strokeStyle = color
  ctx.lineWidth = clamp(OUTER_WALL_PX * scene.camera.zoom, MIN_WALL_PX, MAX_WALL_PX)
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(back.x + perp.x, back.y + perp.y)
  ctx.lineTo(apex.x, apex.y)
  ctx.lineTo(back.x - perp.x, back.y - perp.y)
  ctx.stroke()
  ctx.lineWidth = 1
}

// A door's arrow points through the edge, across the seam, not along it. Which
// way across is `aSide`: A's side of the seam is `lo` (west of a V seam, north
// of an H one) or `hi`, and the arrow points from A's side to B's, so the same
// two rooms give opposite arrows depending on which one the box was drawn from.
function doorDirection(run: DoorRun): { dx: number; dy: number } {
  const sign = run.aSide === 'lo' ? 1 : -1
  return run.axis === 'V' ? { dx: sign, dy: 0 } : { dx: 0, dy: sign }
}

// Along the shaft, A to B. Taken from the open cells' walk order rather than
// from the axis, because the axis says which way the shaft lies and this has
// to say which way it runs: a drag made right-to-left must not draw an arrow
// pointing right.
function shaftDirection(shaft: ElevatorShaft): { dx: number; dy: number } {
  const first = parseCell(shaft.openCells[0])
  const last = parseCell(shaft.openCells[shaft.openCells.length - 1])
  if (shaft.axis === 'h') return { dx: last.x >= first.x ? 1 : -1, dy: 0 }
  return { dx: 0, dy: last.y >= first.y ? 1 : -1 }
}

// One colour for a door with two ends.
//
// A transition carries a lock per end, and each end is meant to show the lock
// facing its own room. For a teleport or an elevator that falls out of having
// two distinct markers; an edge door is one marker on one seam, so it needs a
// split (half toward A, half toward B) that does not exist yet: until it does,
// an edge door renders the synced look.
//
// Synced needs a winner when the two ends differ. A's if it has a colour,
// otherwise B's: an asymmetric missile/open door then reads as a missile door,
// which is the more informative of the two readings, since a lock you must
// open is worth seeing from either side while "open" is only worth seeing when
// both ends agree. The day the split marker lands this function is what it
// replaces.
function markerColor(run: DoorRun, scene: MapScene): string | null {
  return lockColor(run.locks.a, scene) ?? lockColor(run.locks.b, scene)
}

function lockColor(id: LockTypeId, scene: MapScene): string | null {
  return scene.lockTypes.get(id)?.color ?? null
}

function fillOf(room: Room, scene: MapScene): string {
  return scene.areas.get(room.areaId)?.cellColor ?? scene.palette.roomFill
}

function wallOf(room: Room, scene: MapScene): string {
  return scene.areas.get(room.areaId)?.wallColor ?? scene.palette.roomWall
}

// Derived from the cell's two opposite corners rather than from a width, so
// adjacent cells share an exact edge instead of leaving a sub-pixel seam
// between two independently rounded rectangles.
function cellRect(cell: CellKey, scene: MapScene): [number, number, number, number] {
  const { x, y } = parseCell(cell)
  const topLeft = worldToScreen(x, y, scene.camera, scene.tileSize)
  const bottomRight = worldToScreen(x + 1, y + 1, scene.camera, scene.tileSize)
  return [topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y]
}

// A cell's centre on screen: where a teleport marker sits, where its line ends,
// and where an elevator's arrow goes. Through `cellCentre` rather than adding
// 0.5 here, because the hit-test uses that too and the two must agree.
function worldPointOf(cell: CellKey, scene: MapScene): { x: number; y: number } {
  const centre = cellCentre(cell)
  return worldToScreen(centre.x, centre.y, scene.camera, scene.tileSize)
}

// An edge's endpoints are vertex coordinates, which are world coordinates:
// cell (x,y)'s north-west corner is vertex (x,y), so they convert directly.
function edgeEnds(edge: EdgeKey, scene: MapScene) {
  const [[ax, ay], [bx, by]] = segmentFromEdge(edge)
  return {
    from: worldToScreen(ax, ay, scene.camera, scene.tileSize),
    to: worldToScreen(bx, by, scene.camera, scene.tileSize),
  }
}

// The middle `fraction` of an edge, centred: an elevator's end marker, which
// sits on the wall rather than breaking it, and so has to be visibly shorter
// than the wall it marks.
function edgeSpan(edge: EdgeKey, scene: MapScene, fraction: number) {
  const { from, to } = edgeEnds(edge, scene)
  const margin = (1 - fraction) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  return {
    from: { x: from.x + dx * margin, y: from.y + dy * margin },
    to: { x: to.x - dx * margin, y: to.y - dy * margin },
  }
}

function traceEdge(ctx: CanvasRenderingContext2D, edge: EdgeKey, scene: MapScene) {
  const { from, to } = edgeEnds(edge, scene)
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
}

// The same edge with a door's opening left out: the two stubs either side of
// the hole, one or both of which may be empty when the opening runs off this
// edge into the next one of the same run.
//
// The span arrives in the edge's own parameter space (0 at the end
// `segmentFromEdge` starts from, 1 at the other), which is what lets one door
// spanning several edges cut each of them correctly without this function
// knowing anything about runs.
function traceEdgeAround(
  ctx: CanvasRenderingContext2D,
  edge: EdgeKey,
  scene: MapScene,
  gap: OpenSpan | undefined,
) {
  if (!gap || gap.to <= gap.from) {
    traceEdge(ctx, edge, scene)
    return
  }

  const { from, to } = edgeEnds(edge, scene)
  const dx = to.x - from.x
  const dy = to.y - from.y

  if (gap.from > 0) {
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(from.x + dx * gap.from, from.y + dy * gap.from)
  }
  if (gap.to < 1) {
    ctx.moveTo(from.x + dx * gap.to, from.y + dy * gap.to)
    ctx.lineTo(to.x, to.y)
  }
}

function traceDoorway(ctx: CanvasRenderingContext2D, edge: EdgeKey, scene: MapScene) {
  const { from, to } = edgeEnds(edge, scene)
  const dx = to.x - from.x
  const dy = to.y - from.y

  ctx.moveTo(from.x, from.y)
  ctx.lineTo(from.x + dx * DOORWAY_STUB, from.y + dy * DOORWAY_STUB)
  ctx.moveTo(to.x - dx * DOORWAY_STUB, to.y - dy * DOORWAY_STUB)
  ctx.lineTo(to.x, to.y)
}

// The door's opening in screen coordinates. The marker is drawn along it and
// the wall is absent along it: one measurement, from `doorRuns.ts`, read twice.
function openingOnScreen(run: DoorRun, scene: MapScene) {
  const { from, to } = doorOpening(run)
  return {
    from: worldToScreen(from[0], from[1], scene.camera, scene.tileSize),
    to: worldToScreen(to[0], to[1], scene.camera, scene.tileSize),
  }
}
