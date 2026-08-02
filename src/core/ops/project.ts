// Project-scope operations: the name, project settings, areas and lock types.
//
// Everything here is a project-wide edit: one undo step that reverts
// everywhere and triggers no tab switch, because it is not tab-scoped. Hence
// PROJECT_SCOPE on the transactions that wrap these.
//
// Two guards run through the whole file: World and Open are immutable
// fallbacks. They cannot be renamed, recoloured or deleted. Every room
// resolves to an area and every transition end to a lock type, so a
// guaranteed target is what makes "delete an area" a reassignment rather
// than a corruption.

import { OPEN_LOCK_ID, WORLD_AREA_ID, newAreaId, newLockTypeId } from '../ids'
import type { AreaId, LockTypeId, MapId, RoomId } from '../ids'
import type { Transaction } from '../journal'
import { createArea, createLockType } from '../factory'
import {
  putArea,
  putLockType,
  removeArea,
  removeLockType,
  setAreaField,
  setLockTypeField,
  setProjectName,
  setProjectSetting,
  setRoomField,
  setTransitionField,
} from '../primitives'
import { mustGet, refuse } from '../outcome'
import type { Outcome } from '../outcome'
import type { Area, LockType, ProjectModel, ProjectSettings } from '../types'

export function isImmutableArea(areaId: AreaId): boolean {
  return areaId === WORLD_AREA_ID
}

export function isImmutableLockType(lockTypeId: LockTypeId): boolean {
  return lockTypeId === OPEN_LOCK_ID
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export function renameProject(tx: Transaction, project: ProjectModel, name: string): void {
  setProjectName(tx, project, name)
}

export function updateSetting<K extends keyof ProjectSettings>(
  tx: Transaction,
  project: ProjectModel,
  key: K,
  value: ProjectSettings[K],
): void {
  setProjectSetting(tx, project, key, value)
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

export function createNewArea(
  tx: Transaction,
  project: ProjectModel,
  name: string,
  cellColor: string,
  wallColor: string,
): Area {
  const area = createArea(newAreaId(), name, cellColor, wallColor)
  putArea(tx, project, area)
  return area
}

// Refuses on World, throws on an unknown id. World being unrenamable is
// something to tell the user; an id that is not in the project is a bug in
// whatever produced it.
export function renameArea(
  tx: Transaction,
  project: ProjectModel,
  areaId: AreaId,
  name: string,
): Outcome {
  const area = mustGet(project.areas, areaId, 'area')
  if (isImmutableArea(areaId)) return refuse('immutable')
  setAreaField(tx, project, area, 'name', name)
}

export function recolorArea(
  tx: Transaction,
  project: ProjectModel,
  areaId: AreaId,
  cellColor: string,
  wallColor: string,
): Outcome {
  const area = mustGet(project.areas, areaId, 'area')
  if (isImmutableArea(areaId)) return refuse('immutable')
  setAreaField(tx, project, area, 'cellColor', cellColor)
  setAreaField(tx, project, area, 'wallColor', wallColor)
}

// Notes are editable even on World: only its name, colours and existence are
// immutable, so nothing can refuse here.
export function setAreaNotes(
  tx: Transaction,
  project: ProjectModel,
  areaId: AreaId,
  notes: string,
): void {
  setAreaField(tx, project, mustGet(project.areas, areaId, 'area'), 'notes', notes)
}

// How many rooms across the whole project an area holds: what the delete
// confirmation shows before reassigning them.
export function roomsInArea(project: ProjectModel, areaId: AreaId): number {
  let count = 0
  for (const map of project.mapsById.values()) {
    for (const room of map.rooms.values()) if (room.areaId === areaId) count++
  }
  return count
}

// Deleting an area reassigns its rooms to World, project-wide, in the same
// transaction, so one undo brings back both the area and every room's
// membership in it.
export function deleteArea(tx: Transaction, project: ProjectModel, areaId: AreaId): Outcome {
  mustGet(project.areas, areaId, 'area')
  if (isImmutableArea(areaId)) return refuse('immutable')

  for (const map of project.mapsById.values()) {
    for (const room of map.rooms.values()) {
      if (room.areaId === areaId) setRoomField(tx, map, room, 'areaId', WORLD_AREA_ID)
    }
  }
  removeArea(tx, project, areaId)
}

// Colour is area-level only, so recolouring a single room means giving it an
// area of its own. This creates that area and moves the room into it in one
// transaction.
export function createAreaFromRoom(
  tx: Transaction,
  project: ProjectModel,
  mapId: MapId,
  roomId: RoomId,
  name: string,
  cellColor: string,
  wallColor: string,
): Area {
  const map = mustGet(project.mapsById, mapId, 'map')
  const room = mustGet(map.rooms, roomId, 'room')
  const area = createNewArea(tx, project, name, cellColor, wallColor)
  setRoomField(tx, map, room, 'areaId', area.id)
  return area
}

// ---------------------------------------------------------------------------
// Lock types
// ---------------------------------------------------------------------------

export function createNewLockType(
  tx: Transaction,
  project: ProjectModel,
  name: string,
  color: string | null = null,
  glyph: string | null = null,
): LockType {
  const lockType = createLockType(newLockTypeId(), name, color, glyph)
  putLockType(tx, project, lockType)
  return lockType
}

export function updateLockType(
  tx: Transaction,
  project: ProjectModel,
  lockTypeId: LockTypeId,
  changes: Partial<Pick<LockType, 'name' | 'color' | 'glyph'>>,
): Outcome {
  const lockType = mustGet(project.lockTypes, lockTypeId, 'lock type')
  // Open is permanently colourless and unrenamable: it is the guaranteed
  // fallback, and letting it drift is how dangling references start.
  if (isImmutableLockType(lockTypeId)) return refuse('immutable')

  if (changes.name !== undefined) setLockTypeField(tx, project, lockType, 'name', changes.name)
  if (changes.color !== undefined) setLockTypeField(tx, project, lockType, 'color', changes.color)
  if (changes.glyph !== undefined) setLockTypeField(tx, project, lockType, 'glyph', changes.glyph)
}

// How many transitions use this lock type: the number the delete confirmation
// reports. Counts transitions, not ends. A symmetric door with the same lock on
// both sides counts as one transition, not two.
export function transitionsUsingLockType(project: ProjectModel, lockTypeId: LockTypeId): number {
  let count = 0
  for (const map of project.mapsById.values()) {
    for (const transition of map.transitions.values()) {
      if (transition.locks.a === lockTypeId || transition.locks.b === lockTypeId) count++
    }
  }
  return count
}

// Deleting a lock type reassigns every end using it to Open, mirroring the
// areas -> World fallback.
export function deleteLockType(
  tx: Transaction,
  project: ProjectModel,
  lockTypeId: LockTypeId,
): Outcome {
  mustGet(project.lockTypes, lockTypeId, 'lock type')
  if (isImmutableLockType(lockTypeId)) return refuse('immutable')

  for (const map of project.mapsById.values()) {
    for (const transition of map.transitions.values()) {
      const { a, b } = transition.locks
      if (a !== lockTypeId && b !== lockTypeId) continue
      setTransitionField(tx, map, transition, 'locks', {
        a: a === lockTypeId ? OPEN_LOCK_ID : a,
        b: b === lockTypeId ? OPEN_LOCK_ID : b,
      })
    }
  }
  removeLockType(tx, project, lockTypeId)
}
