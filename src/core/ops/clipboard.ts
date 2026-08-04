// Copy, cut, paste and duplicate.
//
// The clipboard always holds room-shaped geometry: paste always produces
// whole new room(s), never a fragment grafted onto an existing room.
// A fragment is never "part of the original room". On paste it becomes new
// room(s) via the normal connectivity rule.
//
// Two rules fall out and are enforced here rather than left to callers:
//   - Transitions are never copied or cut: they connect two rooms, so a copy
//     cannot carry one. Redraw after pasting. (Move is different: both endpoints
//     translate together, so transitions ride along, see ops/rooms.)
//   - Lines are never carried incidentally. They are an independent overlay with
//     no room owner, so a room- or cell-copy does not pick up a line crossing
//     the selection; a line travels only as its own object.

import { cellKey, edgeCells, parseCell, translate, translateEdge } from '../cell'
import type { CellKey, EdgeKey } from '../cell'
import { connectedComponents } from '../derive/connectivity'
import { createRoom } from '../factory'
import { WORLD_AREA_ID } from '../ids'
import type { AreaId, LineId, RoomId } from '../ids'
import type { Transaction } from '../journal'
import { addCell, putIcon, putLine, putRoom, setInnerWall } from '../primitives'
import type { LineObject, MapModel, ProjectModel, Room, WallStyle } from '../types'
import { deleteRooms, eraseCells } from './rooms'
import { deleteLine } from './markup'

// One copied room's worth of payload. Named because `paste` carries it through
// as the identity of the room it is about to create, rather than re-deriving
// that from a cell lookup.
export interface PayloadRoom {
  cells: CellKey[]
  areaId: AreaId
  name: string
  notes: string
}

// What the clipboard holds. Geometry is stored relative to the selection's
// top-left cell, so a paste at an arbitrary anchor is a translation and the
// clipboard survives being pasted into a different map.
export interface ClipboardPayload {
  // Cells, offset from the payload origin.
  cells: CellKey[]
  // Per-cell content, same offset space.
  icons: {
    cell: CellKey
    iconType: string
    plateColor: string
    glyphColor: string
    label: string
    notes: string
  }[]
  innerWalls: { edge: EdgeKey; style: WallStyle }[]
  // Whole-room copies carry identity so a paste can name the result
  // "<name> copy"; a cell-fragment copy carries none and pastes get fresh
  // default names instead.
  rooms: PayloadRoom[]
  // Set only when the payload came from whole-room selection.
  fromRooms: boolean
  // Lines travel only when explicitly selected as their own objects.
  lines: Omit<LineObject, 'id'>[]
  // Where on the source map the payload's origin was, in absolute cells.
  //
  // The only absolute coordinate here, and it is not geometry: everything else
  // is relative precisely so a payload survives being pasted into another map.
  // This is what a paste with no pointer to aim at offsets from, and it has to
  // be recorded at copy time because by paste time the source may have been
  // cut, moved, or left behind on another tab.
  //
  // A save-file shape if the clipboard is ever persisted, which is why it is a
  // plain pair of numbers rather than a CellKey.
  sourceOrigin: { x: number; y: number }
}

// An empty payload is a value, not a refusal: copying nothing is a coherent
// outcome (the selection was empty), and `isClipboardEmpty` is the predicate
// that asks. Nothing here can be refused by a rule.
export function emptyClipboard(): ClipboardPayload {
  return {
    cells: [],
    icons: [],
    innerWalls: [],
    rooms: [],
    fromRooms: false,
    lines: [],
    sourceOrigin: { x: 0, y: 0 },
  }
}

export function isClipboardEmpty(payload: ClipboardPayload): boolean {
  return payload.cells.length === 0 && payload.lines.length === 0
}

// The offset origin: top-most-then-left-most, the same anchor the split rule
// and the fragment-area tiebreak use.
function originOf(cells: Iterable<CellKey>): { x: number; y: number } {
  let x = 0
  let y = 0
  let seen = false
  for (const cell of cells) {
    const point = parseCell(cell)
    if (!seen || point.y < y || (point.y === y && point.x < x)) {
      x = point.x
      y = point.y
      seen = true
    }
  }
  return { x, y }
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

// Room-select copy: whole rooms with their identity, inner walls and icons.
//
// `sharedOrigin` is for a selection holding more than one kind: the two halves
// have to be normalised against the same cell or the relative geometry between
// them is lost. Alone, each kind uses its own top-left.
export function copyRooms(
  map: MapModel,
  roomIds: Iterable<RoomId>,
  sharedOrigin?: { x: number; y: number },
): ClipboardPayload {
  const rooms = [...roomIds]
    .map((id) => map.rooms.get(id))
    .filter((room): room is Room => room !== undefined)
  if (rooms.length === 0) return emptyClipboard()

  const all = rooms.flatMap((room) => [...room.cells])
  const origin = sharedOrigin ?? originOf(all)
  const payload = emptyClipboard()
  payload.fromRooms = true
  payload.sourceOrigin = origin

  for (const room of rooms) {
    payload.rooms.push({
      cells: [...room.cells].map((cell) => offset(cell, -origin.x, -origin.y)),
      areaId: room.areaId,
      name: room.name,
      notes: room.notes,
    })
    for (const [edge, style] of room.innerWalls) {
      payload.innerWalls.push({ edge: translateEdge(edge, -origin.x, -origin.y), style })
    }
  }
  payload.cells = all.map((cell) => offset(cell, -origin.x, -origin.y))
  collectIcons(map, all, origin, payload)
  return payload
}

// Cell-select copy: shape plus on-cell content, no room identity. Each source
// room's area is remembered per cell so the fragment-area tiebreak can run on paste.
export function copyCells(map: MapModel, cells: Iterable<CellKey>): ClipboardPayload {
  const selected = [...cells].filter((cell) => map.cellOwner.has(cell))
  if (selected.length === 0) return emptyClipboard()

  const origin = originOf(selected)
  const payload = emptyClipboard()
  payload.sourceOrigin = origin
  payload.cells = selected.map((cell) => offset(cell, -origin.x, -origin.y))

  // One pseudo-room per source room, so areas survive the round trip without
  // the payload pretending to carry identity.
  const byRoom = new Map<RoomId, CellKey[]>()
  for (const cell of selected) {
    const owner = map.cellOwner.get(cell)!
    const bucket = byRoom.get(owner)
    if (bucket) bucket.push(cell)
    else byRoom.set(owner, [cell])
  }
  for (const [roomId, roomCells] of byRoom) {
    const room = map.rooms.get(roomId)
    if (!room) continue
    payload.rooms.push({
      cells: roomCells.map((cell) => offset(cell, -origin.x, -origin.y)),
      areaId: room.areaId,
      name: '',
      notes: '',
    })
  }

  // Only segments strictly interior to the selection travel; one straddling
  // the boundary is carried by neither piece.
  const selectedSet = new Set(selected)
  for (const room of map.rooms.values()) {
    for (const [edge, style] of room.innerWalls) {
      const { lo, hi } = edgeCells(edge)
      if (selectedSet.has(lo) && selectedSet.has(hi)) {
        payload.innerWalls.push({ edge: translateEdge(edge, -origin.x, -origin.y), style })
      }
    }
  }

  collectIcons(map, selected, origin, payload)
  return payload
}

// Lines travel only as their own selected objects.
export function copyLines(
  map: MapModel,
  lineIds: Iterable<LineId>,
  sharedOrigin?: { x: number; y: number },
): ClipboardPayload {
  const payload = emptyClipboard()
  const lines = [...lineIds]
    .map((id) => map.lines.get(id))
    .filter((line): line is LineObject => line !== undefined)
  if (lines.length === 0) return payload

  const origin = sharedOrigin ?? originOf(lines.flatMap((line) => line.points))
  payload.sourceOrigin = origin
  for (const line of lines) {
    const { id: _id, ...rest } = line
    void _id
    payload.lines.push({
      ...rest,
      points: line.points.map((cell) => offset(cell, -origin.x, -origin.y)),
    })
  }
  return payload
}

// A Select-mode copy, which can hold rooms and lines at once.
//
// Both halves are normalised against the union's top-left rather than against
// their own, which is the whole reason this exists: two payloads merged after
// the fact would each be relative to a different cell, and pasting them would
// put the line somewhere it never was relative to the room.
//
// Transitions and icons are not parameters. A transition is never copied, and
// an icon travels as content on a cell, picked up by the rooms that carry it.
export function copySelection(
  map: MapModel,
  selection: { rooms?: Iterable<RoomId>; lines?: Iterable<LineId> },
): ClipboardPayload {
  const roomIds = [...(selection.rooms ?? [])]
  const lineIds = [...(selection.lines ?? [])]

  const cells: CellKey[] = []
  for (const id of roomIds) {
    const room = map.rooms.get(id)
    if (room) cells.push(...room.cells)
  }
  for (const id of lineIds) {
    const line = map.lines.get(id)
    if (line) cells.push(...line.points)
  }
  if (cells.length === 0) return emptyClipboard()

  const origin = originOf(cells)
  const rooms = copyRooms(map, roomIds, origin)
  const lines = copyLines(map, lineIds, origin)

  return {
    cells: [...rooms.cells, ...lines.cells],
    icons: [...rooms.icons, ...lines.icons],
    innerWalls: [...rooms.innerWalls, ...lines.innerWalls],
    rooms: [...rooms.rooms, ...lines.rooms],
    // True if any whole room travelled: the pasted rooms keep the boundaries
    // the copy stated rather than being refused into connected groups.
    fromRooms: rooms.fromRooms || lines.fromRooms,
    lines: [...rooms.lines, ...lines.lines],
    sourceOrigin: origin,
  }
}

function collectIcons(
  map: MapModel,
  cells: Iterable<CellKey>,
  origin: { x: number; y: number },
  payload: ClipboardPayload,
): void {
  for (const cell of cells) {
    const iconId = map.iconAtCell.get(cell)
    if (iconId === undefined) continue
    const icon = map.icons.get(iconId)
    if (!icon) continue
    payload.icons.push({
      cell: offset(cell, -origin.x, -origin.y),
      iconType: icon.iconType,
      plateColor: icon.plateColor,
      glyphColor: icon.glyphColor,
      label: icon.label,
      notes: icon.notes,
    })
  }
}

function offset(cell: CellKey, dx: number, dy: number): CellKey {
  return translate(cell, dx, dy)
}

// ---------------------------------------------------------------------------
// Cut
// ---------------------------------------------------------------------------

// Cut = copy + remove from the source. Removing whole rooms deletes them;
// removing cells applies the split rule if it disconnects what is left.
export function cutRooms(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  roomIds: Iterable<RoomId>,
): ClipboardPayload {
  const payload = copyRooms(map, roomIds)
  deleteRooms(tx, project, map, roomIds)
  return payload
}

export function cutCells(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  cells: Iterable<CellKey>,
): ClipboardPayload {
  const payload = copyCells(map, cells)
  eraseCells(tx, project, map, cells)
  return payload
}

// The Select-mode cut: `copySelection` and then remove what it took, in the one
// transaction the caller opened. Both halves together, so no caller can copy
// and forget to delete, or delete in a second step that undoes separately.
export function cutSelection(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  selection: { rooms?: Iterable<RoomId>; lines?: Iterable<LineId> },
): ClipboardPayload {
  const payload = copySelection(map, selection)
  for (const id of selection.lines ?? []) deleteLine(tx, map, id)
  if (selection.rooms) deleteRooms(tx, project, map, selection.rooms)
  return payload
}

// ---------------------------------------------------------------------------
// Paste
// ---------------------------------------------------------------------------

export interface PasteOptions {
  // Where the payload's origin lands.
  at: { x: number; y: number }
  // Names for the pasted rooms. A whole-room copy passes the locked
  // "<name> copy" / "copy 2" convention; a cell-fragment paste passes fresh
  // "Room N" names, since the fragment carries no identity.
  nameFor?: (source: { name: string; index: number }) => string
}

// Paste always produces whole new room(s), by connectivity: never a fragment
// grafted onto an existing room. Destructive at the destination: incoming wins.
export function paste(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  payload: ClipboardPayload,
  options: PasteOptions,
): { rooms: Room[]; lines: LineObject[] } {
  const { x: dx, y: dy } = options.at
  const created: Room[] = []
  const pastedLines: LineObject[] = []

  // Lines first: they are independent of everything else and cannot collide.
  for (const line of payload.lines) {
    const clone: LineObject = {
      ...line,
      id: tx.ids.mint('ln'),
      points: line.points.map((cell) => translate(cell, dx, dy)),
    }
    putLine(tx, map, clone)
    pastedLines.push(clone)
  }

  if (payload.cells.length === 0) return { rooms: created, lines: pastedLines }

  const destinations = payload.cells.map((cell) => translate(cell, dx, dy))

  // Clear the destination: incoming wins.
  eraseCells(tx, project, map, destinations)

  // Which source area each destination cell came from, for the fragment
  // tiebreak: a fragment has no room of its own to ask.
  const areaByCell = new Map<CellKey, AreaId>()
  for (const room of payload.rooms) {
    for (const cell of room.cells) areaByCell.set(translate(cell, dx, dy), room.areaId)
  }

  // How the pasted cells divide into rooms. For a fragment payload, connectivity
  // decides: the cells carry no identity, so they form their connected groups.
  // For a whole-room payload the boundaries are already stated and must be
  // preserved: each pasted room remains a separate room, not fused with others
  // that touch it.
  const groups: { cells: Set<CellKey>; source: PayloadRoom | null }[] = payload.fromRooms
    ? payload.rooms.map((room) => ({
        cells: new Set(room.cells.map((cell) => translate(cell, dx, dy))),
        source: room,
      }))
    : connectedComponents(destinations).map((cells) => ({ cells, source: null }))

  groups.forEach(({ cells, source }, index) => {
    const areaId = source?.areaId ?? areaByCell.get(topLeftOf(cells)) ?? WORLD_AREA_ID
    const room = createRoom(areaId, tx.ids.mint('room'))
    room.name = options.nameFor?.({ name: source?.name ?? '', index }) ?? ''
    // A whole-room copy keeps its notes; a fragment carries no identity.
    if (source) room.notes = source.notes
    // Attach before filling: addCell writes cellOwner, so a room that never
    // reached map.rooms leaves the index pointing at nothing.
    putRoom(tx, map, room)
    for (const cell of cells) addCell(tx, map, room, cell)
    created.push(room)
  })

  // Inner walls land on whichever new room owns both their cells.
  for (const { edge, style } of payload.innerWalls) {
    const moved = translateEdge(edge, dx, dy)
    const { lo, hi } = edgeCells(moved)
    const owner = created.find((room) => room.cells.has(lo) && room.cells.has(hi))
    if (owner) setInnerWall(tx, map, owner, moved, style)
  }

  // Icons ride to their new cell; one per cell is guaranteed because the
  // destination was cleared first.
  for (const icon of payload.icons) {
    const cell = translate(icon.cell, dx, dy)
    if (!map.cellOwner.has(cell) || map.iconAtCell.has(cell)) continue
    putIcon(tx, map, {
      id: tx.ids.mint('ic'),
      iconType: icon.iconType,
      cell,
      plateColor: icon.plateColor,
      glyphColor: icon.glyphColor,
      label: icon.label,
      notes: icon.notes,
    })
  }

  return { rooms: created, lines: pastedLines }
}

function topLeftOf(cells: Iterable<CellKey>): CellKey {
  const { x, y } = originOf(cells)
  return cellKey(x, y)
}

// How many columns the payload spans. Not simply `max x + 1`: payload cells
// are relative to the row-major top-left cell, which for a concave shape is
// not the bounding box corner, so x can be negative.
function horizontalSpan(cells: Iterable<CellKey>): number {
  let min = 0
  let max = 0
  let seen = false
  for (const cell of cells) {
    const { x } = parseCell(cell)
    if (!seen) {
      min = x
      max = x
      seen = true
      continue
    }
    if (x < min) min = x
    if (x > max) max = x
  }
  return seen ? max - min + 1 : 0
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

// Where a payload lands when nothing aims it: clear of where it came from, by
// its own full width plus a one-cell gap.
//
// Clear of the source because paste is destructive, so any offset that
// overlapped would erase part of what was copied. Measured from `sourceOrigin`
// rather than from the live source, which is what makes it hold after a cut,
// after the source has moved, and on a map the source was never on.
//
// One definition for both routes: duplicate offsets by it, and a paste with no
// pointer over the canvas falls back to it.
export function defaultPasteAt(payload: ClipboardPayload): { x: number; y: number } {
  return {
    x: payload.sourceOrigin.x + horizontalSpan(payload.cells) + 1,
    y: payload.sourceOrigin.y,
  }
}

export interface DuplicateOptions {
  offset?: { x: number; y: number }
  nameFor?: PasteOptions['nameFor']
}

// Copy + paste at an offset, as one transaction, without going near the
// clipboard: duplicating something must not cost the user whatever they had
// copied.
export function duplicateSelection(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  selection: { rooms?: Iterable<RoomId>; lines?: Iterable<LineId> },
  options: DuplicateOptions = {},
): { rooms: Room[]; lines: LineObject[] } {
  const payload = copySelection(map, selection)
  if (isClipboardEmpty(payload)) return { rooms: [], lines: [] }

  // Callers that know where the user dropped it pass their own offset, still
  // measured from the source's origin.
  const at = options.offset
    ? {
        x: payload.sourceOrigin.x + options.offset.x,
        y: payload.sourceOrigin.y + options.offset.y,
      }
    : defaultPasteAt(payload)
  return paste(tx, project, map, payload, { at, nameFor: options.nameFor })
}

// The cell granularity's duplicate: the same copy-then-paste in one
// transaction, over a cell fragment rather than over whole objects.
//
// Its own entry point rather than a flag on the one above, because the payload
// the two build is different in kind: a fragment carries no identity, so what
// lands is new rooms however the cells were grouped at the source.
export function duplicateCells(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  cells: Iterable<CellKey>,
  options: DuplicateOptions = {},
): Room[] {
  const payload = copyCells(map, cells)
  if (isClipboardEmpty(payload)) return []
  const at = options.offset
    ? { x: payload.sourceOrigin.x + options.offset.x, y: payload.sourceOrigin.y + options.offset.y }
    : defaultPasteAt(payload)
  return paste(tx, project, map, payload, { at, nameFor: options.nameFor }).rooms
}

// Rooms alone, for callers that have no lines to offer.
export function duplicateRooms(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  roomIds: Iterable<RoomId>,
  options: DuplicateOptions = {},
): Room[] {
  return duplicateSelection(tx, project, map, { rooms: roomIds }, options).rooms
}
