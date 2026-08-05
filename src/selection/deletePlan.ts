import { deleteTransition } from '@/core/ops/doors'
import { deleteIcon, deleteLine } from '@/core/ops/markup'
import { deleteArea, isImmutableArea } from '@/core/ops/project'
import { deleteRooms, eraseCells } from '@/core/ops/rooms'
import type { CellKey } from '@/core/cell'
import type { AreaId, IconId, LineId, RoomId, TransitionId } from '@/core/ids'
import type { Transaction } from '@/core/journal'
import type { MapModel, ObjectRef, ProjectModel } from '@/core/types'

// What `Delete` would do to a selection, decided once and read by everything
// that offers it: the key, the Edit menu, and the canvas context menu. An item
// enabled by one rule and a handler that refuses by another is the shape of bug
// this replaces.
//
// Two things drop out of a plan rather than failing later:
//
//   World          the fallback every room falls back to, so it has no delete
//   another tab    the selection belongs to the tab it was made on, and the
//                  caller passes that tab's refs (nothing, from anywhere else)

export interface DeletePlan {
  cells: CellKey[]
  transitions: TransitionId[]
  icons: IconId[]
  lines: LineId[]
  rooms: RoomId[]
  areas: AreaId[]
}

// `erasesCells` is whether this is the Cells granularity, where `Delete` erases
// cells back to bare grid instead of naming objects.
//
// The two arms are exclusive: a plan holding cells holds nothing else. Erasing
// is what the key means there, and running both halves would delete objects the
// granularity in use cannot even select.
export function planDelete(
  selected: readonly ObjectRef[],
  options: { erasesCells: boolean },
): DeletePlan {
  const plan: DeletePlan = {
    cells: [],
    transitions: [],
    icons: [],
    lines: [],
    rooms: [],
    areas: [],
  }
  for (const ref of selected) {
    switch (ref.kind) {
      case 'cell':
        if (options.erasesCells) plan.cells.push(ref.id)
        break
      case 'transition':
        plan.transitions.push(ref.id)
        break
      case 'icon':
        plan.icons.push(ref.id)
        break
      case 'line':
        plan.lines.push(ref.id)
        break
      case 'room':
        plan.rooms.push(ref.id)
        break
      case 'area':
        if (!isImmutableArea(ref.id)) plan.areas.push(ref.id)
        break
    }
  }
  if (plan.cells.length > 0) {
    return { cells: plan.cells, transitions: [], icons: [], lines: [], rooms: [], areas: [] }
  }
  return plan
}

export function isEmptyPlan(plan: DeletePlan): boolean {
  return (
    plan.cells.length === 0 &&
    plan.transitions.length === 0 &&
    plan.icons.length === 0 &&
    plan.lines.length === 0 &&
    plan.rooms.length === 0 &&
    plan.areas.length === 0
  )
}

// Whether the plan changes anything on a map, as opposed to project structure
// alone. It decides the transaction's scope, and through that where undo takes
// the user: back to the tab the content is on, or nowhere, since the rooms an
// area delete reassigns can be on any tab.
export function touchesMap(plan: DeletePlan): boolean {
  return (
    plan.cells.length > 0 ||
    plan.transitions.length > 0 ||
    plan.icons.length > 0 ||
    plan.lines.length > 0 ||
    plan.rooms.length > 0
  )
}

// How many rooms this delete moves to World rather than removing, counted
// across every map because an area is project-wide. Rooms the same plan
// deletes are not counted: they never arrive anywhere.
//
// Asked only when the confirmation opens. It walks every room in the project,
// which is not work to do on every menu render.
export function roomsMovingToWorld(project: ProjectModel, plan: DeletePlan): number {
  if (plan.areas.length === 0) return 0
  const areas = new Set<AreaId>(plan.areas)
  const going = new Set<RoomId>(plan.rooms)
  let count = 0
  for (const map of project.mapsById.values()) {
    for (const room of map.rooms.values()) {
      if (areas.has(room.areaId) && !going.has(room.id)) count++
    }
  }
  return count
}

// One transaction's worth of work, in the order the ops need.
//
// Rooms go after the objects named individually: deleting a room cascades to
// the transitions on its edges and the icons in its cells, so taking the named
// ones first means each id is still there when its own op runs. Areas go last
// for the same reason, one level up: an area delete reassigns its rooms, and
// the rooms this plan deletes are gone by then.
export function applyDelete(
  tx: Transaction,
  project: ProjectModel,
  map: MapModel,
  plan: DeletePlan,
): void {
  if (plan.cells.length > 0) {
    eraseCells(tx, project, map, plan.cells)
    return
  }
  for (const id of plan.transitions) deleteTransition(tx, project, map, id)
  for (const id of plan.icons) deleteIcon(tx, map, id)
  for (const id of plan.lines) deleteLine(tx, map, id)
  if (plan.rooms.length > 0) deleteRooms(tx, project, map, plan.rooms)
  for (const id of plan.areas) deleteArea(tx, project, id)
}
