// What the export dialog shows, and what ticking a box in it means.
//
// Plain functions rather than logic inside the dialog, because tri-state over
// three levels is the part of this feature a bug would hide in, and it is far
// easier to state as a table of cases than to click through.
//
// The tree is one level deeper than the Hierarchy panel it resembles: rooms are
// per-tab and areas are project-wide, so an area appears under every tab that
// has rooms in it, holding different rooms each time. Ticking one of those
// nodes takes exactly the rooms shown beneath it, never the same area's rooms
// on another tab.
//
// Selection is one flat set of room ids. Ids are unique across the project, so
// nothing has to be keyed by tab until the very end, where `scopeOf` regroups.

import type { AreaId, MapId, RoomId } from '@/core/ids'
import type { ExportScope } from '@/core/export'
import type { ProjectModel } from '@/core/types'
import { roomLabel } from '@/i18n/naming'

export interface ScopeRoom {
  kind: 'room'
  id: RoomId
  // What the row shows. Rooms start unnamed, so this is `roomLabel`'s
  // positional fallback rather than a blank line, exactly as in the Hierarchy.
  label: string
}

export interface ScopeArea {
  kind: 'area'
  id: AreaId
  label: string
  rooms: ScopeRoom[]
}

export interface ScopeTab {
  kind: 'tab'
  id: MapId
  label: string
  areas: ScopeArea[]
}

export type ScopeNode = ScopeTab | ScopeArea | ScopeRoom

// Reka's own three-state value, so a checkbox can bind to this directly.
export type CheckedState = boolean | 'indeterminate'

// Tabs in tab order, areas in the order the project lists them, rooms in
// Hierarchy order. An area with no rooms on a tab is left out: it is not part
// of that tab, and the Hierarchy only shows one because an empty area still has
// properties and would otherwise be unreachable. A tab with no rooms stays,
// with nothing under it, because a tab that vanished from the list would read
// as a bug rather than as an empty tab.
export function buildScopeTree(project: ProjectModel): ScopeTab[] {
  return project.maps.map((mapId) => {
    const map = project.mapsById.get(mapId)!
    const byArea = new Map<AreaId, ScopeRoom[]>()

    for (const roomId of map.roomOrder) {
      const room = map.rooms.get(roomId)!
      const rooms = byArea.get(room.areaId)
      const entry: ScopeRoom = { kind: 'room', id: room.id, label: roomLabel(room) }
      if (rooms) rooms.push(entry)
      else byArea.set(room.areaId, [entry])
    }

    const areas: ScopeArea[] = []
    for (const area of project.areas.values()) {
      const rooms = byArea.get(area.id)
      if (rooms) areas.push({ kind: 'area', id: area.id, label: area.name, rooms })
    }

    return { kind: 'tab', id: map.id, label: map.name, areas }
  })
}

// Every room under a node, which is what ticking it acts on and what its own
// state is read from.
export function roomsUnder(node: ScopeNode): RoomId[] {
  switch (node.kind) {
    case 'room':
      return [node.id]
    case 'area':
      return node.rooms.map((room) => room.id)
    case 'tab':
      return node.areas.flatMap((area) => area.rooms.map((room) => room.id))
  }
}

// A node with nothing under it is unchecked rather than checked, which is the
// answer that matters for an empty tab: "all zero of its rooms are selected" is
// true and useless, and it would draw a tick on a tab contributing nothing.
export function stateOf(node: ScopeNode, selected: ReadonlySet<RoomId>): CheckedState {
  const rooms = roomsUnder(node)
  if (rooms.length === 0) return false

  let ticked = 0
  for (const room of rooms) if (selected.has(room)) ticked++
  if (ticked === 0) return false
  return ticked === rooms.length ? true : 'indeterminate'
}

// A new set rather than a mutation, so a Vue ref holding it sees a change.
export function toggle(node: ScopeNode, selected: ReadonlySet<RoomId>, next: boolean): Set<RoomId> {
  const updated = new Set(selected)
  for (const room of roomsUnder(node)) {
    if (next) updated.add(room)
    else updated.delete(room)
  }
  return updated
}

export function allRooms(tree: ScopeTab[]): Set<RoomId> {
  return new Set(tree.flatMap(roomsUnder))
}

// Regrouped by tab, which is the shape the serializer takes. A tab with none of
// its rooms selected is left out entirely rather than mapped to an empty set,
// so the two ways of saying "nothing from this tab" do not both exist.
export function scopeOf(tree: ScopeTab[], selected: ReadonlySet<RoomId>): ExportScope {
  const scope = new Map<MapId, Set<RoomId>>()
  for (const tab of tree) {
    const rooms = roomsUnder(tab).filter((room) => selected.has(room))
    if (rooms.length > 0) scope.set(tab.id, new Set(rooms))
  }
  return scope
}

// What the dialog says is about to be exported. Tabs are counted by whether
// they contribute anything, matching what the export will actually contain.
export function countOf(
  tree: ScopeTab[],
  selected: ReadonlySet<RoomId>,
): { tabs: number; rooms: number } {
  let tabs = 0
  let rooms = 0
  for (const tab of tree) {
    const ticked = roomsUnder(tab).filter((room) => selected.has(room)).length
    if (ticked > 0) tabs++
    rooms += ticked
  }
  return { tabs, rooms }
}
