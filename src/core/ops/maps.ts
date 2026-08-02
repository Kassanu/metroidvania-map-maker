// Map (tab) operations.
//
// Add, delete, reorder, and duplicate are undoable operations on the global
// undo stack alongside content edits. Delete in particular restores the map
// and its cascaded cross-tab transitions on undo, which the journal provides
// by closing over the whole detached MapModel.

import { createMap, createRoom } from '../factory'
import { mustGet } from '../outcome'
import { newIconId, newLineId, newTransitionId } from '../ids'
import type { MapId } from '../ids'
import type { Transaction } from '../journal'
import {
  detachMap,
  insertMap,
  moveMap,
  putIcon,
  putLine,
  putRoom,
  putTransition,
  removeTransition,
  addCell,
  setInnerWall,
  setMapField,
} from '../primitives'
import type { IconObject, LineObject, MapModel, ProjectModel, Transition } from '../types'

export function addMap(tx: Transaction, project: ProjectModel, name: string): MapModel {
  const map = createMap(name)
  insertMap(tx, project, map)
  return map
}

export function renameMap(
  tx: Transaction,
  project: ProjectModel,
  mapId: MapId,
  name: string,
): void {
  setMapField(tx, project, mustGet(project.mapsById, mapId, 'map'), 'name', name)
}

export function setMapNotes(
  tx: Transaction,
  project: ProjectModel,
  mapId: MapId,
  notes: string,
): void {
  setMapField(tx, project, mustGet(project.mapsById, mapId, 'map'), 'notes', notes)
}

export function reorderMap(
  tx: Transaction,
  project: ProjectModel,
  mapId: MapId,
  toIndex: number,
): void {
  moveMap(tx, project, mapId, toIndex)
}

// Deletes a tab, cascading to every cross-tab transition that referenced it.
// `replacementName` is used when deleting the last remaining tab, which is
// allowed and immediately replaced with a fresh blank one rather than leaving
// the project with zero tabs.
//
// Callers must show a confirmation first. See `mapDeletionImpact` for the
// numbers it needs. This op does not ask; by the time it runs, the decision
// is made.
export function deleteMap(
  tx: Transaction,
  project: ProjectModel,
  mapId: MapId,
  replacementName: string,
): void {
  const map = mustGet(project.mapsById, mapId, 'map')

  // Cross-tab teleports live under their origin map, so deleting the
  // destination tab means reaching into other maps to remove them. Undo
  // restores these as separate journal entries in the same transaction.
  for (const { map: other, transition } of incomingTransitions(project, mapId)) {
    removeTransition(tx, project, other, transition)
  }

  // The map's own transitions go with it. Detaching the map takes them along
  // in the closure, but the far-end index entries they own must be released.
  for (const transition of [...map.transitions.values()]) {
    removeTransition(tx, project, map, transition)
  }

  const wasLast = project.maps.length === 1
  detachMap(tx, project, map)
  if (wasLast) insertMap(tx, project, createMap(replacementName))
}

// Which transitions in other maps reference this map. Both `deleteMap` and
// `mapDeletionImpact` walk this, so the count the confirmation shows matches
// what the delete actually removes.
//
// Returns an array rather than iterating lazily: the caller mutates the very
// collections this reads.
function incomingTransitions(
  project: ProjectModel,
  mapId: MapId,
): { map: MapModel; transition: Transition }[] {
  const found: { map: MapModel; transition: Transition }[] = []
  for (const other of project.mapsById.values()) {
    if (other.id === mapId) continue
    for (const transition of other.transitions.values()) {
      if (referencesMap(transition, mapId)) found.push({ map: other, transition })
    }
  }
  return found
}

function referencesMap(transition: Transition, mapId: MapId): boolean {
  if (transition.kind !== 'teleport') return false
  return transition.a.mapId === mapId || transition.b.mapId === mapId
}

// One other map that links into the one being deleted. Named to tell the user
// where to go and check. A bare total ("3 links will be removed") does not
// identify which tabs hold the damage.
export interface IncomingLinkSource {
  mapId: MapId
  mapName: string
  teleports: number
}

// Everything the delete confirmation shows. Counted before the fact: a
// confirmation is a question asked ahead of the action, so this is a pure
// query, not something `deleteMap` returns.
export interface MapDeletionImpact {
  rooms: number
  icons: number
  lines: number
  // The map's own transitions: same-map doors, elevators, and teleports.
  transitions: number
  // Cross-tab teleports stored in other maps that point here. This is the
  // surprising part of the cascade and the reason the dialog exists.
  incoming: IncomingLinkSource[]
  // Deleting the last tab is allowed, but it is immediately replaced with a
  // fresh blank one. The dialog should say so rather than implying the project
  // is about to be emptied.
  replacesLastMap: boolean
}

export function mapDeletionImpact(project: ProjectModel, mapId: MapId): MapDeletionImpact {
  const map = mustGet(project.mapsById, mapId, 'map')

  const byMap = new Map<MapId, IncomingLinkSource>()
  for (const { map: other } of incomingTransitions(project, mapId)) {
    const entry = byMap.get(other.id)
    if (entry) entry.teleports++
    else byMap.set(other.id, { mapId: other.id, mapName: other.name, teleports: 1 })
  }

  return {
    rooms: map.rooms.size,
    icons: map.icons.size,
    lines: map.lines.size,
    transitions: map.transitions.size,
    // Tab order, so the dialog lists them the way the tab bar does.
    incoming: project.maps.flatMap((id) => {
      const entry = byMap.get(id)
      return entry ? [entry] : []
    }),
    replacesLastMap: project.maps.length === 1,
  }
}

// A fully independent copy of the map's content, inserted right after the
// original. Areas and lock types are project-wide and deliberately shared,
// not copied. Recolouring an area still changes it on both tabs.
export function duplicateMap(
  tx: Transaction,
  project: ProjectModel,
  mapId: MapId,
  name: string,
): MapModel {
  const source = mustGet(project.mapsById, mapId, 'map')

  const copy = createMap(name)
  copy.notes = source.notes
  insertMap(tx, project, copy, project.maps.indexOf(mapId) + 1)

  // Rooms, in Hierarchy order so the copy's tree reads the same. Cells keep
  // their coordinates (a duplicated tab is a copy of the map, not an offset
  // paste).
  for (const roomId of source.roomOrder) {
    const original = source.rooms.get(roomId)
    if (!original) continue
    const room = createRoom(original.areaId)
    room.name = original.name
    room.notes = original.notes
    putRoom(tx, copy, room)
    for (const cell of original.cells) addCell(tx, copy, room, cell)
    for (const [edge, style] of original.innerWalls) setInnerWall(tx, copy, room, edge, style)
  }

  for (const icon of source.icons.values()) {
    const clone: IconObject = { ...icon, id: newIconId() }
    putIcon(tx, copy, clone)
  }

  for (const line of source.lines.values()) {
    const clone: LineObject = { ...line, id: newLineId(), points: [...line.points] }
    putLine(tx, copy, clone)
  }

  for (const transition of source.transitions.values()) {
    const clone = cloneTransition(transition, copy.id)
    if (clone) putTransition(tx, project, copy, clone)
  }

  return copy
}

// Same-map transitions clone straight across. Cross-tab teleports do not: a
// cell holds at most one teleport endpoint. Rather than silently drop one at
// the index, the copy omits cross-tab teleports. The duplicate keeps its local
// doors and loses its links out.
function cloneTransition(transition: Transition, mapId: MapId): Transition | null {
  switch (transition.kind) {
    case 'edge':
      return {
        ...transition,
        id: newTransitionId(),
        segments: transition.segments.map((segment) => ({ ...segment })),
      }
    case 'elevator':
      return { ...transition, id: newTransitionId() }
    case 'teleport': {
      if (isCrossTab(transition)) return null
      return {
        ...transition,
        id: newTransitionId(),
        a: { mapId, cell: transition.a.cell },
        b: { mapId, cell: transition.b.cell },
      }
    }
  }
}

function isCrossTab(transition: Transition): boolean {
  return transition.kind === 'teleport' && transition.a.mapId !== transition.b.mapId
}

// How many of this map's teleports a duplicate would leave behind, for the
// same reason `cloneTransition` drops them. Shares `isCrossTab` with the op so
// the two cannot disagree.
//
// No caller yet: duplicate is instant and unconfirmed, so reporting this waits
// on a non-blocking notice.
export function linksDroppedByDuplicate(project: ProjectModel, mapId: MapId): number {
  const map = mustGet(project.mapsById, mapId, 'map')
  let count = 0
  for (const transition of map.transitions.values()) if (isCrossTab(transition)) count++
  return count
}
