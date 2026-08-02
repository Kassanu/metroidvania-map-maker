// The toJSON / fromJSON boundary: where the flat persisted arrays become the
// keyed runtime model with its indices and derived walls, and back.
//
// fromJSON is deliberately forgiving. A `.mvm` is plain JSON that a user can
// hand-edit, that an older build may have written, and that a crash may have
// truncated. Rather than trusting it, load repairs: dangling area and lock
// references fall back to the guaranteed World / Open, overlapping cells
// resolve first-wins, a room whose cells are disconnected is split into
// genuine rooms, and malformed geometry is dropped. The result always
// satisfies the model's invariants, because everything downstream assumes it.

import {
  cellKey,
  edgeFromSegment,
  edgeOfCell,
  parseCell,
  parseEdge,
  segmentFromEdge,
} from '../cell'
import type { CellKey, EdgeKey, Side } from '../cell'
import { connectedComponents, originalGroupIndex } from '../derive/connectivity'
import {
  createEmptyProject,
  createMap,
  createOpenLockType,
  createRoom,
  createWorldArea,
  defaultSettings,
} from '../factory'
import { getFarEnd, setFarEnd } from '../farEnds'
import { OPEN_LOCK_ID, WORLD_AREA_ID, uniqueId } from '../ids'
import type { AreaId, IconId, LineId, LockTypeId, MapId, RoomId, TransitionId } from '../ids'
import { contiguousRuns, isSegmentValid, isTransitionValid } from '../ops/transitions'
import { farEndOf, transitionAnchors } from '../primitives'
import type {
  DoorSegment,
  IconObject,
  LineObject,
  MapModel,
  ProjectModel,
  ProjectSettings,
  Room,
  TeleportTransition,
  Transition,
  WallStyle,
} from '../types'
import { migrate } from './migrate'
import { FILE_FORMAT, FILE_VERSION } from './schema'
import type {
  JsonCell,
  JsonDoorSegment,
  JsonFile,
  JsonInnerWall,
  JsonMap,
  JsonRoom,
  JsonSettings,
  JsonTransition,
} from './schema'

const WALL_STYLES: WallStyle[] = ['solid', 'dotted', 'doorway']

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

function toJsonCell(key: CellKey): JsonCell {
  const { x, y } = parseCell(key)
  return [x, y]
}

// The canonical edge key becomes cell + side: a V edge is the west side of its
// `hi` cell, an H edge the north side. Exactly invertible.
function toJsonSegment(segment: DoorSegment): JsonDoorSegment {
  const { x, y, axis } = parseEdge(segment.edge)
  return { cell: [x, y], side: axis === 'V' ? 'W' : 'N', aSide: segment.aSide }
}

export function toJSON(project: ProjectModel): JsonFile {
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    project: {
      name: project.name,
      settings: { ...project.settings },
      lockTypes: [...project.lockTypes.values()].map((lockType) => ({
        id: lockType.id,
        name: lockType.name,
        color: lockType.color,
        glyph: lockType.glyph,
      })),
      areas: [...project.areas.values()].map((area) => ({
        id: area.id,
        name: area.name,
        cellColor: area.cellColor,
        wallColor: area.wallColor,
        notes: area.notes,
      })),
      // Tab order is the array order.
      maps: project.maps.map((mapId) => serializeMap(project.mapsById.get(mapId)!)),
    },
  }
}

// Row-major: top to bottom, left to right within a row. Reading order and
// the order a hand-written file would naturally be in.
function sortedCells(cells: ReadonlySet<CellKey>): CellKey[] {
  return [...cells].sort((a, b) => {
    const first = parseCell(a)
    const second = parseCell(b)
    return first.y - second.y || first.x - second.x
  })
}

function serializeMap(map: MapModel): JsonMap {
  return {
    id: map.id,
    name: map.name,
    notes: map.notes,
    // Hierarchy order, so the tree reloads as the user arranged it.
    rooms: map.roomOrder.map((roomId) => {
      const room = map.rooms.get(roomId)!
      return {
        id: room.id,
        areaId: room.areaId,
        name: room.name,
        notes: room.notes,
        // Only cells and inner walls: outer walls are derived at load, never
        // stored, because the user can never draw one by hand.
        //
        // Both are written in canonical order rather than in the order the
        // Set and Map happen to iterate. A `Set` re-insertion goes to the end,
        // so an edit that moved cells between rooms and was then undone would
        // otherwise restore the same cells in a different order: an identical
        // map that serialises to different bytes.
        cells: sortedCells(room.cells).map(toJsonCell),
        innerWalls: [...room.innerWalls.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([edge, style]) => ({
            seg: segmentFromEdge(edge),
            style,
          })),
      }
    }),
    transitions: [...map.transitions.values()].map(serializeTransition),
    icons: [...map.icons.values()].map((icon) => ({
      id: icon.id,
      iconType: icon.iconType,
      cell: toJsonCell(icon.cell),
      label: icon.label,
      notes: icon.notes,
    })),
    lines: [...map.lines.values()].map((line) => ({
      id: line.id,
      color: line.color,
      points: line.points.map(toJsonCell),
      arrowStart: line.arrowStart,
      arrowEnd: line.arrowEnd,
      label: line.label,
      notes: line.notes,
    })),
  }
}

function serializeTransition(transition: Transition): JsonTransition {
  const common = {
    id: transition.id,
    locks: { a: transition.locks.a, b: transition.locks.b },
    notes: transition.notes,
    oneWay: transition.oneWay,
  }
  switch (transition.kind) {
    case 'edge':
      return {
        ...common,
        type: 'edge',
        geometry: { segments: transition.segments.map(toJsonSegment) },
      }
    case 'elevator':
      return {
        ...common,
        type: 'elevator',
        geometry: {
          a: toJsonCell(transition.a),
          b: toJsonCell(transition.b),
          axis: transition.axis,
        },
      }
    case 'teleport':
      return {
        ...common,
        type: 'teleport',
        geometry: {
          a: { mapId: transition.a.mapId, cell: toJsonCell(transition.a.cell) },
          b: { mapId: transition.b.mapId, cell: toJsonCell(transition.b.cell) },
        },
      }
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export class InvalidFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidFileError'
  }
}

// Everything the loader repaired, so the UI can say so rather than silently
// changing the user's data.
//
// Every LoadEvent is a repair. That is the whole contract, so dropping data
// and reporting it are the same statement. `needsConfirmation` is then
// `events.length > 0` and cannot fall out of step with the loader.
//
// Anything purely informational must not be a LoadEvent. A note that the file
// was migrated from an older version belongs elsewhere, so the user is not
// prompted over a file that needed no repair.
export type LoadEvent =
  // `overlap`: rooms never overlap, so a file saying otherwise resolves
  // first-wins. `malformed`: the cell was not a pair of finite numbers, and
  // `cell` is null because there is nothing meaningful to name.
  | {
      kind: 'cell-dropped'
      map: string
      room: string
      cell: CellKey | null
      reason: 'overlap' | 'malformed'
    }
  | { kind: 'inner-wall-dropped'; map: string; room: string; reason: 'malformed' | 'not-interior' }
  | { kind: 'room-dropped'; map: string; room: string; reason: 'no-cells' | 'malformed' }
  // A room whose cells were not orthogonally connected, split into `into`
  // genuine rooms. One keeps the original identity.
  | { kind: 'room-split'; map: string; room: string; into: number }
  | {
      kind: 'icon-dropped'
      map: string
      cell: CellKey | null
      reason: 'not-in-a-room' | 'cell-occupied' | 'malformed'
    }
  | { kind: 'line-dropped'; map: string; reason: 'too-short' | 'malformed' }
  | {
      kind: 'transition-dropped'
      map: string
      reason: 'malformed' | 'invalid-geometry' | 'teleport-exists' | 'not-its-map'
    }
  // An edge door that arrived with segments the runtime would never have left
  // attached: dead ones, or a second disconnected run.
  | { kind: 'door-trimmed'; map: string; droppedSegments: number; splitInto: number }
  // A dangling reference, resolved to the guaranteed World / Open.
  | { kind: 'area-remapped'; map: string; room: string }
  | { kind: 'lock-remapped'; map: string }
  // A setting whose value was not usable, replaced by the default.
  | { kind: 'setting-reset'; setting: string }
  // A field the file left out that the loader had to assume a value for. Only
  // ever used where a wrong guess is bounded and visible, never where it
  // would silently change what an object points at.
  | { kind: 'assumed-default'; map: string; field: string }
  // An id that was blank or already claimed, and so was reissued. `from` is
  // empty when the file simply had none.
  | { kind: 'id-remapped'; what: string; from: string; to: string }

export type LoadEventKind = LoadEvent['kind']

export interface LoadReport {
  readonly events: readonly LoadEvent[]
}

export interface LoadResult {
  project: ProjectModel
  report: LoadReport
}

// True when the loader had to change something to satisfy the model's
// invariants, i.e. when the user must be asked before this becomes their live
// project.
export function needsConfirmation(report: LoadReport): boolean {
  return report.events.length > 0
}

// Per-kind totals, for a dialog that wants "12 cells dropped, 3 rooms split"
// rather than a list of twelve. Only non-zero kinds appear.
export function countByKind(report: LoadReport): Map<LoadEventKind, number> {
  const counts = new Map<LoadEventKind, number>()
  for (const event of report.events) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1)
  return counts
}

// A load that repaired something, held back until the user accepts it.
//
// The loader must repair to satisfy invariants, but repairing is rewriting
// user data, so it does not become the live project until confirmed. The file
// on disk is untouched either way; nothing here writes.
//
// `accept()` hands over the repaired project. Declining it drops the load.
export interface PendingLoad {
  readonly report: LoadReport
  readonly requiresConfirmation: boolean
  accept(): ProjectModel
}

// The entry point the File menu should use, rather than `fromJSON` directly.
// A clean file yields `requiresConfirmation: false` and the caller can accept
// immediately without showing anything.
export function openProject(raw: unknown): PendingLoad {
  const { project, report } = fromJSON(raw)
  return {
    report,
    requiresConfirmation: needsConfirmation(report),
    accept: () => project,
  }
}

// Collects what the loader had to change. Adding the event and discarding the
// data are meant to be one statement, which is why every drop site takes this
// rather than incrementing something.
class LoadLog {
  readonly events: LoadEvent[] = []

  add(event: LoadEvent): void {
    this.events.push(event)
  }
}

// ---------------------------------------------------------------------------
// Shape guards
//
// These turn structural deviations into repair events. Each returns a usable
// value or null, and none throw. They are deliberately total: the caller must
// handle null, but will never see a TypeError.
// ---------------------------------------------------------------------------

// A list that is not a list reads as empty rather than exploding.
function arrayOf<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : []
}

// `[x, y]`, or null if it is not a pair of safe integers. `cellKey` on a
// string or an undefined produces a key like `"undefined,3"`, which then owns
// cells and indexes transitions.
//
// Safe integers specifically, not merely finite numbers: the grid is signed
// ints, and a coordinate that is not one does not survive the round trip.
// `1e400` parses to `Infinity`, becomes the key `"Infinity,0"`, and writes
// back out as `[null, 0]`, so saving and reloading relocates the cell with a
// clean report both times.
function cellOf(value: JsonCell | undefined): CellKey | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const [x, y] = value
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null
  return cellKey(x, y)
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

export function fromJSON(raw: unknown): LoadResult {
  const file = assertFile(raw)
  const migrated = migrate(file)
  const source = migrated.project

  // A project always has at least one map. A file with no maps cannot be
  // represented, and the worst available reading is to treat it as empty.
  const jsonMaps = arrayOf(source.maps)
  if (jsonMaps.length === 0) throw new InvalidFileError('project has no maps')

  const log = new LoadLog()

  // Every id claimed so far, project-wide. Rooms, transitions, icons and lines
  // all draw from it so a collision across *any* of them is caught.
  const seenIds = new Set<string>()

  const project = createEmptyProject(source.name ?? 'Untitled Project')
  project.settings = loadSettings(source.settings, log)

  // The two immutable fallbacks are seeded first and then overwritten only in
  // their name. A file can never redefine World's colours or make Open
  // coloured: the guarantees the rest of the model leans on.
  project.areas.set(WORLD_AREA_ID, createWorldArea())
  project.lockTypes.set(OPEN_LOCK_ID, createOpenLockType())

  for (const area of arrayOf(source.areas)) {
    if (area.id === WORLD_AREA_ID) {
      project.areas.get(WORLD_AREA_ID)!.name = area.name
      continue
    }
    project.areas.set(area.id as AreaId, {
      id: area.id as AreaId,
      name: area.name,
      cellColor: area.cellColor ?? null,
      wallColor: area.wallColor ?? null,
      notes: area.notes ?? '',
    })
  }

  for (const lockType of arrayOf(source.lockTypes)) {
    if (lockType.id === OPEN_LOCK_ID) {
      project.lockTypes.get(OPEN_LOCK_ID)!.name = lockType.name
      continue
    }
    project.lockTypes.set(lockType.id as LockTypeId, {
      id: lockType.id as LockTypeId,
      name: lockType.name,
      color: lockType.color ?? null,
      glyph: lockType.glyph ?? null,
    })
  }

  // Pairs are carried forward so transitions can be loaded in a second pass
  // without re-lookup. The map's file id may not be the final id (claimId can
  // reissue it), so looking it up again would miss or hit the wrong map.
  const loaded: { jsonMap: JsonMap; map: MapModel }[] = []
  for (const jsonMap of jsonMaps) {
    const mapId = claimId(jsonMap.id, 'map', `map "${jsonMap.name}"`, seenIds, log) as MapId
    const map = createMap(jsonMap.name, mapId)
    map.notes = jsonMap.notes ?? ''
    loadRooms(map, arrayOf(jsonMap.rooms), project, log, seenIds)
    loadIcons(map, jsonMap, log, seenIds)
    loadLines(map, jsonMap, log, seenIds)
    project.maps.push(map.id)
    project.mapsById.set(map.id, map)
    loaded.push({ jsonMap, map })
  }

  // Transitions load last: validity is judged against cell ownership, so every
  // map's rooms have to exist first, including the far map of a cross-tab
  // teleport.
  for (const { jsonMap, map } of loaded) {
    loadTransitions(map, arrayOf(jsonMap.transitions), project, log, seenIds)
  }

  return { project, report: { events: log.events } }
}

function assertFile(raw: unknown): JsonFile {
  if (!isPlainObject(raw)) {
    throw new InvalidFileError('not a JSON object')
  }
  const file = raw as Partial<JsonFile>
  if (file.format !== FILE_FORMAT) {
    throw new InvalidFileError(`not a ${FILE_FORMAT} file`)
  }
  if (typeof file.version !== 'number') {
    throw new InvalidFileError('missing file version')
  }
  if (!isPlainObject(file.project)) {
    throw new InvalidFileError('missing project')
  }
  return file as JsonFile
}

// `typeof [] === 'object'`, so arrays must be explicitly rejected. An array
// read as a project has every field as undefined and opens as a blank.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Each field is validated against its actual constraints, not just `typeof`.
// Tile size must be a positive finite number. Colours are nullable by design
// (null means "follow the app theme").
function loadSettings(raw: JsonSettings | undefined, log: LoadLog): ProjectSettings {
  const settings = defaultSettings()
  if (!isPlainObject(raw)) {
    if (raw !== undefined) log.add({ kind: 'setting-reset', setting: 'settings' })
    return settings
  }

  if (raw.tileSize !== undefined) {
    if (typeof raw.tileSize === 'number' && Number.isFinite(raw.tileSize) && raw.tileSize > 0) {
      settings.tileSize = raw.tileSize
    } else {
      log.add({ kind: 'setting-reset', setting: 'tileSize' })
    }
  }

  for (const key of ['backgroundColor', 'gridColor'] as const) {
    const value = raw[key]
    if (value === undefined || value === null) continue
    if (typeof value === 'string') settings[key] = value
    else log.add({ kind: 'setting-reset', setting: key })
  }

  if (raw.gridInExports !== undefined) {
    if (typeof raw.gridInExports === 'boolean') settings.gridInExports = raw.gridInExports
    else log.add({ kind: 'setting-reset', setting: 'gridInExports' })
  }

  return settings
}

// Ids must be unique across the whole project. A duplicate collapses one
// object into another in a Map while still being pushed to the order array,
// breaking invariants: roomOrder stops matching rooms.keys(), and cellOwner
// points at an object that no longer holds those cells.
function claimId(
  raw: string,
  prefix: string,
  what: string,
  seen: Set<string>,
  log: LoadLog,
): string {
  if (raw && !seen.has(raw)) {
    seen.add(raw)
    return raw
  }
  const fresh: string = uniqueId(prefix, seen)
  seen.add(fresh)
  log.add({ kind: 'id-remapped', what, from: raw ?? '', to: fresh })
  return fresh
}

// `edgeFromSegment` destructures its argument two levels deep, so it needs a
// whole vertex pair before it is safe to call.
function segmentEdge(wall: unknown): EdgeKey | null {
  if (!isPlainObject(wall) || !Array.isArray(wall.seg) || wall.seg.length < 2) return null
  const [a, b] = wall.seg
  if (!Array.isArray(a) || !Array.isArray(b)) return null
  const points = [a[0], a[1], b[0], b[1]]
  if (!points.every((value) => Number.isFinite(value))) return null
  return edgeFromSegment([
    [a[0], a[1]],
    [b[0], b[1]],
  ])
}

// Cells and edges are keyed off the same pair, so the "is this wall strictly
// interior?" test is one place rather than three.
function wallCells(edge: EdgeKey): { lo: CellKey; hi: CellKey } {
  const { x, y, axis } = parseEdge(edge)
  return { lo: axis === 'V' ? cellKey(x - 1, y) : cellKey(x, y - 1), hi: cellKey(x, y) }
}

function loadRooms(
  map: MapModel,
  jsonRooms: JsonRoom[],
  project: ProjectModel,
  log: LoadLog,
  seenIds: Set<string>,
): void {
  for (const jsonRoom of arrayOf(jsonRooms)) {
    if (!isPlainObject(jsonRoom)) {
      log.add({ kind: 'room-dropped', map: map.name, room: '', reason: 'malformed' })
      continue
    }
    const name = stringOr(jsonRoom.name, '')
    const roomId = claimId(jsonRoom.id, 'room', `room "${name}"`, seenIds, log) as RoomId
    // Names are optional, so fall back to the id: an event naming no room at
    // all is not much use in a dialog.
    const label = name || roomId

    const knownArea = project.areas.has(jsonRoom.areaId as AreaId)
    if (!knownArea) log.add({ kind: 'area-remapped', map: map.name, room: label })
    const areaId = knownArea ? (jsonRoom.areaId as AreaId) : WORLD_AREA_ID

    const room = createRoom(areaId, roomId)
    room.name = name
    room.notes = stringOr(jsonRoom.notes, '')

    for (const jsonCell of arrayOf(jsonRoom.cells)) {
      const cell = cellOf(jsonCell)
      if (cell === null) {
        log.add({ kind: 'cell-dropped', map: map.name, room: label, cell, reason: 'malformed' })
        continue
      }
      // Rooms never overlap. A file that says otherwise is repaired
      // first-wins rather than producing a model that cannot be rendered.
      if (map.cellOwner.has(cell)) {
        log.add({ kind: 'cell-dropped', map: map.name, room: label, cell, reason: 'overlap' })
        continue
      }
      room.cells.add(cell)
      map.cellOwner.set(cell, room.id)
    }

    for (const wall of arrayOf(jsonRoom.innerWalls)) {
      const edge = segmentEdge(wall)
      if (!edge) {
        log.add({ kind: 'inner-wall-dropped', map: map.name, room: label, reason: 'malformed' })
        continue
      }
      // Only strictly-interior segments survive, which is the same rule every
      // edit enforces at runtime.
      const { lo, hi } = wallCells(edge)
      if (!room.cells.has(lo) || !room.cells.has(hi)) {
        log.add({ kind: 'inner-wall-dropped', map: map.name, room: label, reason: 'not-interior' })
        continue
      }
      const style = (wall as JsonInnerWall).style
      room.innerWalls.set(edge, WALL_STYLES.includes(style) ? style : 'solid')
    }

    if (room.cells.size === 0) {
      // A cell-less room carried a name and notes that now vanish.
      log.add({ kind: 'room-dropped', map: map.name, room: label, reason: 'no-cells' })
      continue
    }
    attachRooms(map, room, label, log, seenIds)
  }
}

// A room is a set of orthogonally connected cells. Files with disconnected
// cells are split into real rooms using the top-left tiebreaker.
function attachRooms(
  map: MapModel,
  room: Room,
  label: string,
  log: LoadLog,
  seenIds: Set<string>,
): void {
  const groups = connectedComponents(room.cells)
  if (groups.length <= 1) {
    map.rooms.set(room.id, room)
    map.roomOrder.push(room.id)
    return
  }

  log.add({ kind: 'room-split', map: map.name, room: label, into: groups.length })
  const keepIndex = originalGroupIndex(groups)

  // Snapshotted before the loop, and every group filters this rather than
  // `room.innerWalls`. On the keep iteration `target` is `room`, so assigning
  // `target.innerWalls` there would overwrite the source the remaining groups
  // are about to filter.
  const sourceWalls = [...room.innerWalls.entries()]

  groups.forEach((group, index) => {
    const target =
      index === keepIndex ? room : createRoom(room.areaId, uniqueId('room', seenIds) as RoomId)
    if (target !== room) {
      seenIds.add(target.id)
      target.name = room.name
      target.notes = room.notes
    }
    target.cells = group
    for (const cell of group) map.cellOwner.set(cell, target.id)
    target.innerWalls = new Map(
      sourceWalls.filter(([edge]) => {
        const { lo, hi } = wallCells(edge)
        return group.has(lo) && group.has(hi)
      }),
    )
    map.rooms.set(target.id, target)
    map.roomOrder.push(target.id)
  })
}

function loadIcons(map: MapModel, jsonMap: JsonMap, log: LoadLog, seenIds: Set<string>): void {
  for (const jsonIcon of arrayOf(jsonMap.icons)) {
    const cell = isPlainObject(jsonIcon) ? cellOf(jsonIcon.cell) : null
    if (cell === null) {
      log.add({ kind: 'icon-dropped', map: map.name, cell, reason: 'malformed' })
      continue
    }
    // Icons must be in a room, one per cell. The two failures are reported
    // apart because they mean different things to whoever is reading the
    // dialog: one is geometry that moved out from under the icon, the other is
    // two icons claiming the same cell.
    if (!map.cellOwner.has(cell)) {
      log.add({ kind: 'icon-dropped', map: map.name, cell, reason: 'not-in-a-room' })
      continue
    }
    if (map.iconAtCell.has(cell)) {
      log.add({ kind: 'icon-dropped', map: map.name, cell, reason: 'cell-occupied' })
      continue
    }
    const icon: IconObject = {
      id: claimId(jsonIcon.id, 'ic', `icon at ${cell}`, seenIds, log) as IconId,
      iconType: stringOr(jsonIcon.iconType, 'unknown'),
      cell,
      label: stringOr(jsonIcon.label, ''),
      notes: stringOr(jsonIcon.notes, ''),
    }
    map.icons.set(icon.id, icon)
    map.iconAtCell.set(cell, icon.id)
  }
}

function loadLines(map: MapModel, jsonMap: JsonMap, log: LoadLog, seenIds: Set<string>): void {
  for (const jsonLine of arrayOf(jsonMap.lines)) {
    if (!isPlainObject(jsonLine)) {
      log.add({ kind: 'line-dropped', map: map.name, reason: 'malformed' })
      continue
    }
    const raw = arrayOf(jsonLine.points)
    const points = raw.map(cellOf).filter((cell): cell is CellKey => cell !== null)
    // A bad point would silently change the path shape, jumping a corner the
    // user never drew. The line goes instead.
    if (points.length !== raw.length) {
      log.add({ kind: 'line-dropped', map: map.name, reason: 'malformed' })
      continue
    }
    // A line needs at least two points to mean anything.
    if (points.length < 2) {
      log.add({ kind: 'line-dropped', map: map.name, reason: 'too-short' })
      continue
    }
    const line: LineObject = {
      id: claimId(jsonLine.id, 'ln', `line on "${map.name}"`, seenIds, log) as LineId,
      color: stringOr(jsonLine.color, '#ffffff'),
      points,
      arrowStart: jsonLine.arrowStart === true,
      arrowEnd: jsonLine.arrowEnd === true,
      label: stringOr(jsonLine.label, ''),
      notes: stringOr(jsonLine.notes, ''),
    }
    map.lines.set(line.id, line)
  }
}

function loadTransitions(
  map: MapModel,
  jsonTransitions: JsonTransition[],
  project: ProjectModel,
  log: LoadLog,
  seenIds: Set<string>,
): void {
  for (const json of arrayOf(jsonTransitions)) {
    const transition = isPlainObject(json)
      ? deserializeTransition(json, map, project, log, seenIds)
      : null
    if (!transition) {
      log.add({ kind: 'transition-dropped', map: map.name, reason: 'malformed' })
      continue
    }
    // A teleport is stored under its origin map, and the destination tab's
    // marker is rebuilt from the far-end index. It must own at least one
    // endpoint to be indexed and rendered.
    if (transition.kind === 'teleport' && !ownsAnEnd(map, transition)) {
      log.add({ kind: 'transition-dropped', map: map.name, reason: 'not-its-map' })
      continue
    }
    // Judge it against the geometry that now exists, exactly as the runtime
    // cascade would. Without this a file could load with a door whose cells are
    // in the same room, a self-connecting teleport, or two teleports on one
    // cell, states every consumer is entitled to assume impossible.
    if (!isTransitionValid(project, map, transition)) {
      log.add({ kind: 'transition-dropped', map: map.name, reason: 'invalid-geometry' })
      continue
    }
    if (transition.kind === 'teleport' && occupiedByTeleport(map, project, transition)) {
      log.add({ kind: 'transition-dropped', map: map.name, reason: 'teleport-exists' })
      continue
    }

    // An edge door arrives with whatever segments the file claims. The runtime
    // guarantees two things that `isTransitionValid` does not: every segment
    // separates two different rooms, and all segments form one contiguous run.
    // A door with dead segments has edges in `transitionsAtEdge` (clickable
    // targets over empty grid), and a door spanning disjoint runs is one object
    // where an edit would have made two.
    for (const piece of trimForLoad(map, transition, log, seenIds)) {
      map.transitions.set(piece.id, piece)
      indexTransition(map, project, piece)
    }
  }
}

// Whether this map is a legitimate home for the teleport: at least one
// endpoint on it. `transitionAnchors` and `farEndOf` both key off exactly this.
function ownsAnEnd(map: MapModel, transition: TeleportTransition): boolean {
  return transition.a.mapId === map.id || transition.b.mapId === map.id
}

// Applies the runtime's two edge-door rules to a loaded transition: every
// segment must separate two different rooms, and all segments form one
// contiguous run. Mirrors trimEdgeTransition: the first run keeps the original
// id, rest are new, so splits never collide with ids later in the file.
function trimForLoad(
  map: MapModel,
  transition: Transition,
  log: LoadLog,
  seen: Set<string>,
): Transition[] {
  if (transition.kind !== 'edge') return [transition]

  const surviving = transition.segments.filter((segment) => isSegmentValid(map, segment))
  const runs = contiguousRuns(surviving)
  if (runs.length === 0) return []

  const dropped = transition.segments.length - surviving.length
  if (dropped > 0 || runs.length > 1) {
    log.add({
      kind: 'door-trimmed',
      map: map.name,
      droppedSegments: dropped,
      splitInto: runs.length,
    })
  }

  return runs.map((segments, index) => ({
    ...transition,
    // The first run keeps the id so anything pointing at it stays meaningful.
    id: index === 0 ? transition.id : (claimId('', 'tr', 'split door', seen, log) as TransitionId),
    segments,
  }))
}

// Either endpoint already carrying a teleport. The one-per-cell rule is
// checked on load because hand-edited or older files can break it.
function occupiedByTeleport(
  map: MapModel,
  project: ProjectModel,
  transition: TeleportTransition,
): boolean {
  for (const end of [transition.a, transition.b]) {
    const target = end.mapId === map.id ? map : project.mapsById.get(end.mapId)
    if (!target) continue
    if (getFarEnd(project.teleportFarEnds, end.mapId, end.cell) !== undefined) return true
    for (const id of target.transitionsAtCell.get(end.cell) ?? []) {
      if (target.transitions.get(id)?.kind === 'teleport') return true
    }
  }
  return false
}

function resolveLock(id: string, map: MapModel, project: ProjectModel, log: LoadLog): LockTypeId {
  if (project.lockTypes.has(id as LockTypeId)) return id as LockTypeId
  log.add({ kind: 'lock-remapped', map: map.name })
  return OPEN_LOCK_ID
}

function deserializeTransition(
  json: JsonTransition,
  map: MapModel,
  project: ProjectModel,
  log: LoadLog,
  seenIds: Set<string>,
): Transition | null {
  const common = {
    id: claimId(json.id, 'tr', `transition on "${map.name}"`, seenIds, log) as TransitionId,
    locks: {
      a: resolveLock(json.locks?.a ?? OPEN_LOCK_ID, map, project, log),
      b: resolveLock(json.locks?.b ?? OPEN_LOCK_ID, map, project, log),
    },
    oneWay: json.oneWay ?? false,
    notes: json.notes ?? '',
  }

  if (!isPlainObject(json.geometry)) return null
  const geometry = json.geometry as Record<string, unknown>

  if (json.type === 'edge') {
    const segments = arrayOf(geometry.segments as JsonDoorSegment[] | undefined)
      .map((segment) => {
        if (!isPlainObject(segment)) return null
        const cell = cellOf(segment.cell as JsonCell | undefined)
        const side = segment.side as Side
        if (cell === null || !['N', 'E', 'S', 'W'].includes(side)) return null
        // `aSide` names which of the boundary's two cells owns `locks.a`. Guessing
        // it is bounded and visible, so the default is used and reported.
        let aSide = segment.aSide
        if (aSide !== 'lo' && aSide !== 'hi') {
          log.add({ kind: 'assumed-default', map: map.name, field: 'door aSide' })
          aSide = 'lo'
        }
        return { edge: edgeOfCell(cell, side), aSide } as DoorSegment
      })
      .filter((segment): segment is DoorSegment => segment !== null)
    if (segments.length === 0) return null
    return { ...common, kind: 'edge', segments }
  }

  if (json.type === 'elevator') {
    const a = cellOf(geometry.a as JsonCell | undefined)
    const b = cellOf(geometry.b as JsonCell | undefined)
    const axis = geometry.axis as 'h' | 'v'
    if (a === null || b === null || (axis !== 'h' && axis !== 'v')) return null
    return { ...common, kind: 'elevator', a, b, axis }
  }

  if (json.type === 'teleport') {
    const a = teleportEnd(geometry.a)
    const b = teleportEnd(geometry.b)
    if (!a || !b) return null
    return { ...common, kind: 'teleport', a, b }
  }

  return null
}

// An endpoint missing its `mapId` would silently turn a cross-tab teleport
// into a same-map one. There is no honest default for "which map", so a
// nameless endpoint means the transition does not load. A stated id that is
// unknown is left for the validity check below to resolve.
function teleportEnd(raw: unknown): { mapId: MapId; cell: CellKey } | null {
  if (!isPlainObject(raw)) return null
  const cell = cellOf(raw.cell as JsonCell | undefined)
  if (cell === null) return null
  if (typeof raw.mapId !== 'string' || raw.mapId === '') return null
  return { mapId: raw.mapId as MapId, cell }
}

// Rebuilds the hit-testing indices and, for a cross-tab teleport, the far-end
// entry that lets the destination tab draw its marker without double storage.
//
// Delegates to the same transitionAnchors the runtime primitives use to avoid
// divergence between load and edit paths.
function indexTransition(map: MapModel, project: ProjectModel, transition: Transition): void {
  const add = <K>(index: Map<K, Set<TransitionId>>, key: K) => {
    const set = index.get(key)
    if (set) set.add(transition.id)
    else index.set(key, new Set([transition.id]))
  }

  const { cells, edges } = transitionAnchors(transition, map.id)
  for (const cell of cells) add(map.transitionsAtCell, cell)
  for (const edge of edges) add(map.transitionsAtEdge, edge)

  const far = farEndOf(transition)
  if (far) setFarEnd(project.teleportFarEnds, far.mapId, far.cell, far.ref)
}

export { FILE_FORMAT, FILE_VERSION }
