// Construction of empty model objects. Pure and un-journaled: these build
// detached objects, and it is the primitives that attach them to a project
// inside a transaction. fromJSON uses the same factories, so a loaded project
// and a freshly created one are the same shape by construction.
//
// Names arrive as parameters rather than being generated here. Generated names
// ("Map 1", "World") are user-visible content, so they come from the i18n
// layer, and core stays free of any dependency on Vue, Pinia or i18n. The
// defaults below are English so tests and fixtures stay terse; the app passes
// translated strings.

import { createFarEndIndex } from './farEnds'
import { OPEN_LOCK_ID, WORLD_AREA_ID, newMapId, newRoomId } from './ids'
import type { AreaId, LockTypeId, MapId, RoomId } from './ids'
import type { Area, LockType, MapModel, ProjectModel, ProjectSettings, Room } from './types'

// Tile size is project-wide and purely visual. 32 px is the default.
export const DEFAULT_TILE_SIZE = 32

export function defaultSettings(): ProjectSettings {
  return {
    tileSize: DEFAULT_TILE_SIZE,
    backgroundColor: null,
    gridColor: null,
    gridInExports: true,
  }
}

export function createRoom(areaId: AreaId, id: RoomId = newRoomId()): Room {
  return {
    id,
    areaId,
    // Rooms start unnamed. The Hierarchy shows a positional fallback label for
    // those; a name is something the user opts into, except for cell-fragment
    // pastes, which get an enumerated "Room N".
    name: '',
    notes: '',
    cells: new Set(),
    innerWalls: new Map(),
    rev: 0,
    metaRev: 0,
  }
}

export function createMap(name: string, id: MapId = newMapId()): MapModel {
  return {
    id,
    name,
    notes: '',
    rooms: new Map(),
    roomOrder: [],
    transitions: new Map(),
    icons: new Map(),
    lines: new Map(),
    cellOwner: new Map(),
    iconAtCell: new Map(),
    transitionsAtCell: new Map(),
    transitionsAtEdge: new Map(),
    rev: 0,
  }
}

// The World area is deliberately not parameterised beyond its name: its
// colours are null (theme-derived) and its id is reserved as the guaranteed,
// immutable fallback for every room.
export function createWorldArea(name = 'World'): Area {
  return {
    id: WORLD_AREA_ID,
    name,
    cellColor: null,
    wallColor: null,
    notes: '',
  }
}

export function createArea(id: AreaId, name: string, cellColor: string, wallColor: string): Area {
  return { id, name, cellColor, wallColor, notes: '' }
}

// Likewise Open: reserved id, permanently colourless, so it always renders as
// a clean doorway gap and can always be the fallback when another lock type is
// deleted.
export function createOpenLockType(name = 'Open'): LockType {
  return { id: OPEN_LOCK_ID, name, color: null, glyph: null }
}

export function createLockType(
  id: LockTypeId,
  name: string,
  color: string | null = null,
  glyph: string | null = null,
): LockType {
  return { id, name, color, glyph }
}

// Every user-visible name is required, deliberately. These are content, and
// content comes from the i18n layer. Optional English defaults would put
// verbatim copies of strings that also live in `i18n/messages/en.ts` into
// core: two sources of truth for the same text, with nothing to keep them in
// step. Requiring them means core cannot silently supply the wrong one; the
// caller that knows the locale has to say.
export interface ProjectSeed {
  projectName: string
  firstMapName: string
  worldAreaName: string
  openLockName: string
  // The one shipped, fully editable lock type. Passing null seeds only `Open`,
  // which is what fromJSON wants when the file lists its own.
  lockedLockName: string | null
  lockedLockColor?: string
}

// A blank project: one map, the World area, and the default Open/Locked lock
// types.
export function createProject(seed: ProjectSeed): ProjectModel {
  const {
    projectName,
    firstMapName,
    worldAreaName,
    openLockName,
    lockedLockName,
    lockedLockColor = '#e23b3b',
  } = seed

  const project = createEmptyProject(projectName)
  project.areas.set(WORLD_AREA_ID, createWorldArea(worldAreaName))
  project.lockTypes.set(OPEN_LOCK_ID, createOpenLockType(openLockName))
  if (lockedLockName !== null) {
    const locked = createLockType('locked' as LockTypeId, lockedLockName, lockedLockColor)
    project.lockTypes.set(locked.id, locked)
  }

  const first = createMap(firstMapName)
  project.maps.push(first.id)
  project.mapsById.set(first.id, first)

  return project
}

// No maps, no areas, no lock types: the starting point fromJSON fills in. Not
// exported for general use: a project without World and Open violates the
// invariants everything else relies on.
function createEmptyProject(name: string): ProjectModel {
  return {
    name,
    settings: defaultSettings(),
    areas: new Map(),
    lockTypes: new Map(),
    maps: [],
    mapsById: new Map(),
    teleportFarEnds: createFarEndIndex(),
    rev: 0,
    structureRev: 0,
  }
}

export { createEmptyProject }
