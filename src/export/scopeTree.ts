// What an export dialog shows, and what ticking a box in it means.
//
// Plain functions rather than logic inside the dialog, because tri-state over
// three levels is the part of this feature a bug would hide in, and it is far
// easier to state as a table of cases than to click through.
//
// This module names no exporter. Leaf depth, what counts as an empty tab, and
// which nodes a dialog opens ticked all arrive from the caller, because those
// are the three things the exporters genuinely disagree about and everything
// else about picking a scope is the same control.
//
// At room depth the tree is one level deeper than the Hierarchy panel it
// resembles: rooms are per-tab and areas are project-wide, so an area appears
// under every tab that has rooms in it, holding different rooms each time.
// Ticking one of those nodes takes exactly the rooms shown beneath it, never
// the same area's rooms on another tab. At tab depth the leaf is the tab, and
// `areas` is null rather than empty: an empty list would mean "a tab with
// nothing on it", which is a different thing and the one `stateOf` has to be
// able to tell apart.
//
// Selection is one flat set of leaf ids. Room ids and map ids are both unique
// across the project, so nothing has to be keyed by tab until the very end,
// where `scopeOf` regroups.

import type { AreaId, MapId, RoomId } from '@/core/ids'
import type { ExportScope } from '@/core/export'
import type { MapModel, ProjectModel } from '@/core/types'
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
  // Null at tab depth, where this node is itself the leaf. An empty array means
  // a room-depth tab holding nothing, which is a different state.
  areas: ScopeArea[] | null
  // Whether this tab can contribute anything, by the caller's own predicate.
  // Carried on the node rather than derived by each dialog, so the row that
  // draws disabled and the tick policy that skips it cannot disagree.
  empty: boolean
}

export type ScopeNode = ScopeTab | ScopeArea | ScopeRoom

// What a selection holds: a room at room depth, a tab at tab depth.
export type LeafId = RoomId | MapId

// Reka's own three-state value, so a checkbox can bind to this directly.
export type CheckedState = boolean | 'indeterminate'

// Where a tree bottoms out, and so what one tick means.
export type ScopeLeaf = 'room' | 'tab'

// Whether a tab has nothing to contribute. Callers disagree on this: a tab with
// no rooms contributes nothing to a room-scoped export, while a tab carrying
// only lines still has something to draw. Each exporter owns its own, so the
// entrance that enables itself and the tree that draws rows disabled read one
// answer.
export type EmptyPredicate = (map: MapModel) => boolean

export interface ScopeTreeOptions {
  leaf: ScopeLeaf
  isEmpty: EmptyPredicate
}

// Whether a tree built with this predicate would hold anything tickable, which
// is what decides an entrance is live. A picker where every node is disabled is
// a dead dialog, so the question is asked before one opens rather than inside.
export function hasScopableTab(project: ProjectModel, isEmpty: EmptyPredicate): boolean {
  return project.maps.some((mapId) => !isEmpty(project.mapsById.get(mapId)!))
}

// Tabs in tab order, areas in the order the project lists them, rooms in
// Hierarchy order. An area with no rooms on a tab is left out: it is not part
// of that tab, and the Hierarchy only shows one because an empty area still has
// properties and would otherwise be unreachable. An empty tab stays, at either
// depth, because a tab that vanished from the list would read as a bug rather
// than as an empty tab.
export function buildScopeTree(project: ProjectModel, options: ScopeTreeOptions): ScopeTab[] {
  return project.maps.map((mapId) => {
    const map = project.mapsById.get(mapId)!
    const empty = options.isEmpty(map)
    if (options.leaf === 'tab') {
      return { kind: 'tab', id: map.id, label: map.name, areas: null, empty }
    }

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

    return { kind: 'tab', id: map.id, label: map.name, areas, empty }
  })
}

// Every leaf under a node, which is what ticking it acts on and what its own
// state is read from. A tab-depth tab is its own leaf; a room-depth one is the
// rooms beneath it.
export function leavesUnder(node: ScopeNode): LeafId[] {
  switch (node.kind) {
    case 'room':
      return [node.id]
    case 'area':
      return node.rooms.map((room) => room.id)
    case 'tab':
      return node.areas === null
        ? [node.id]
        : node.areas.flatMap((area) => area.rooms.map((room) => room.id))
  }
}

// A node with nothing under it is unchecked rather than checked, which is the
// answer that matters for an empty room-depth tab: "all zero of its rooms are
// selected" is true and useless, and it would draw a tick on a tab contributing
// nothing. An empty tab-depth tab has itself as a leaf, so the same answer
// comes from the empty predicate keeping it out of every selection instead.
export function stateOf(node: ScopeNode, selected: ReadonlySet<LeafId>): CheckedState {
  const leaves = leavesUnder(node)
  if (leaves.length === 0) return false

  let ticked = 0
  for (const leaf of leaves) if (selected.has(leaf)) ticked++
  if (ticked === 0) return false
  return ticked === leaves.length ? true : 'indeterminate'
}

// A new set rather than a mutation, so a Vue ref holding it sees a change.
export function toggle(node: ScopeNode, selected: ReadonlySet<LeafId>, next: boolean): Set<LeafId> {
  const updated = new Set(selected)
  for (const leaf of leavesUnder(node)) {
    if (next) updated.add(leaf)
    else updated.delete(leaf)
  }
  return updated
}

// Every leaf a dialog may open ticked. Empty tabs are skipped: at room depth
// they carry no leaves anyway, and at tab depth they are the leaf and must not
// be selected, since a disabled node is unticked and cannot be ticked.
export function allLeaves(tree: ScopeTab[]): Set<LeafId> {
  return new Set(tree.filter((tab) => !tab.empty).flatMap(leavesUnder))
}

// Regrouped by tab, which is the shape the serializer takes. A tab with none of
// its rooms selected is left out entirely rather than mapped to an empty set,
// so the two ways of saying "nothing from this tab" do not both exist.
//
// Room depth only: a scope names rooms, and a tab-depth tree has none to name.
export function scopeOf(tree: ScopeTab[], selected: ReadonlySet<LeafId>): ExportScope {
  const scope = new Map<MapId, Set<RoomId>>()
  for (const tab of tree) {
    const rooms = roomsOf(tab).filter((room) => selected.has(room))
    if (rooms.length > 0) scope.set(tab.id, new Set(rooms))
  }
  return scope
}

// What the dialog says is about to be exported, counted in leaves so it means
// something at both depths: a room-depth tree counts ticked rooms, a tab-depth
// one counts ticked tabs. A count fixed on rooms answers zero for every
// tab-depth selection, and a dialog reading "nothing selected" off it refuses
// to export however much is ticked.
export function countOf(
  tree: ScopeTab[],
  selected: ReadonlySet<LeafId>,
): { tabs: number; leaves: number } {
  let tabs = 0
  let leaves = 0
  for (const tab of tree) {
    const ticked = leavesUnder(tab).filter((leaf) => selected.has(leaf)).length
    if (ticked > 0) tabs++
    leaves += ticked
  }
  return { tabs, leaves }
}

// The rooms a tab holds. A tab-depth tab holds none, which is why only
// `scopeOf` uses this: it names rooms, so a tab-depth tree contributes nothing
// to one.
function roomsOf(tab: ScopeTab): RoomId[] {
  return (tab.areas ?? []).flatMap((area) => area.rooms.map((room) => room.id))
}
