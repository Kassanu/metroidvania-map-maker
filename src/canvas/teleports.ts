// Teleport geometry: the one place in the app where drawing one map needs to
// know about another.
//
// A cross-tab teleport is stored once, under its origin map, and the
// destination tab's marker is rebuilt from the project's far-end index. So the
// two ends of one object are reached two different ways, and a map cannot be
// drawn from its own contents alone. That is why this takes the project where
// `doorRuns` and `elevatorShafts` take a map: the asymmetry is in the data, not
// in the style of the module.
//
// The result is deliberately flat: a list of ends and a list of lines, with
// near and far ends already reconciled into the same shape. The renderer should
// not be able to tell which end was stored and which was derived, because on
// screen they are the same marker.

import { parseCell } from '@/core/cell'
import type { CellKey } from '@/core/cell'
import { farEndsOnMap } from '@/core/farEnds'
import type { LockTypeId, MapId, TransitionId } from '@/core/ids'
import type { Direction, ProjectModel, TeleportTransition } from '@/core/types'

export interface TeleportEnd {
  id: TransitionId
  cell: CellKey
  // The lock facing this end's room. A teleport has two distinct markers, so
  // unlike an edge door it can show both per-end locks with no split marker.
  lock: LockTypeId
  // Where this end leads, when the other end is on a different map: the tab to
  // open, the cell to centre on, and the letter to draw in the marker. Null for
  // a same-map teleport, whose destination is visible at the other end of the
  // line and needs no label.
  //
  // Present on both ends of a cross-tab teleport, each naming the other's map.
  // Labelling only the far end would leave the origin tab unable to tell a
  // cross-tab teleport from a same-map one whose line is hidden.
  leadsTo: { mapId: MapId; cell: CellKey; label: string } | null
}

export interface TeleportLine {
  id: TransitionId
  from: CellKey
  to: CellKey
  // Draws an arrowhead at the midpoint. `aToB` points from A to B, `bToA` the
  // other way, `both` draws none.
  direction: Direction
}

export interface TeleportScene {
  ends: TeleportEnd[]
  // Same-map teleports only: a cross-tab one has no second point on this map to
  // draw a line to, which is exactly why its ends carry a label instead.
  lines: TeleportLine[]
}

export function teleportScene(project: ProjectModel, mapId: MapId): TeleportScene {
  const scene: TeleportScene = { ends: [], lines: [] }
  const map = project.mapsById.get(mapId)
  if (!map) return scene

  // Near ends: this map's own teleports. Both ends of a same-map one are here.
  for (const transition of map.transitions.values()) {
    if (transition.kind !== 'teleport') continue
    const sameMap = transition.a.mapId === transition.b.mapId

    if (sameMap) {
      scene.ends.push(end(transition, 'a', null))
      scene.ends.push(end(transition, 'b', null))
      scene.lines.push({
        id: transition.id,
        from: transition.a.cell,
        to: transition.b.cell,
        direction: transition.direction,
      })
      continue
    }

    // Cross-tab, seen from its origin: this map holds one end and the other
    // tab holds the other. Which of A and B is here is fixed at creation and
    // never changes, direction included.
    const here = transition.a.mapId === mapId ? 'a' : 'b'
    const there = here === 'a' ? transition.b : transition.a
    scene.ends.push(end(transition, here, leadsTo(project, there)))
  }

  // Far ends: teleports stored on another map whose other endpoint lands here.
  for (const [cell, ref] of farEndsOnMap(project.teleportFarEnds, mapId)) {
    const owner = project.mapsById.get(ref.originMapId)
    const transition = owner?.transitions.get(ref.transitionId)
    // A dangling index entry is a bug elsewhere, not something to draw; the
    // invariant check is where it gets reported.
    if (!transition || transition.kind !== 'teleport') continue

    const here = transition.a.cell === cell && transition.a.mapId === mapId ? 'a' : 'b'
    const there = here === 'a' ? transition.b : transition.a
    scene.ends.push(end(transition, here, leadsTo(project, there)))
  }

  return scene
}

// The teleport endpoint on one cell of one map, near or far, or null when there
// is none.
//
// The single-cell counterpart to `teleportScene`, for the pointer path: the
// resolver runs on every move and would otherwise rebuild the whole scene and
// search it to answer a question both indices answer in O(1). Same two lookups
// `hitTest` uses, and the same `end`/`leadsTo` helpers the scene is built from,
// so a marker and the thing under the pointer cannot describe themselves
// differently.
export function teleportEndAt(
  project: ProjectModel,
  mapId: MapId,
  cell: CellKey,
): TeleportEnd | null {
  const map = project.mapsById.get(mapId)
  if (!map) return null

  for (const id of map.transitionsAtCell.get(cell) ?? []) {
    const transition = map.transitions.get(id)
    if (transition?.kind !== 'teleport') continue
    const here = transition.a.cell === cell && transition.a.mapId === mapId ? 'a' : 'b'
    const there = here === 'a' ? transition.b : transition.a
    return end(transition, here, there.mapId === mapId ? null : leadsTo(project, there))
  }

  const far = farEndsOnMap(project.teleportFarEnds, mapId).get(cell)
  if (!far) return null
  const owner = project.mapsById.get(far.originMapId)
  const transition = owner?.transitions.get(far.transitionId)
  if (transition?.kind !== 'teleport') return null
  // A far end is cross-tab by construction, so the other end is always another
  // map and always carries a label.
  const here = transition.a.cell === cell && transition.a.mapId === mapId ? 'a' : 'b'
  const there = here === 'a' ? transition.b : transition.a
  return end(transition, here, leadsTo(project, there))
}

function end(
  transition: TeleportTransition,
  which: 'a' | 'b',
  leads: TeleportEnd['leadsTo'],
): TeleportEnd {
  return {
    id: transition.id,
    cell: transition[which].cell,
    lock: transition.locks[which],
    leadsTo: leads,
  }
}

function leadsTo(
  project: ProjectModel,
  there: { mapId: MapId; cell: CellKey },
): TeleportEnd['leadsTo'] {
  const name = project.mapsById.get(there.mapId)?.name ?? ''
  return { mapId: there.mapId, cell: there.cell, label: firstLetter(name) }
}

// The destination tab's first letter. Taken from the first character the name
// starts with rather than `name[0]`, because a leading space would otherwise
// label the marker blank, and because a name whose first character is outside
// the BMP (an emoji tab name is still a valid text input) must not be cut in
// half.
export function firstLetter(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) return '?'
  return [...trimmed][0].toUpperCase()
}

// A cell's centre in world coordinates: where a teleport marker sits and where
// its line ends. Exported because the renderer and the hit-test have to agree
// about it; a marker drawn at the centre but grabbed by the whole cell is the
// documented exception to hit-testing rule 1, not a discrepancy to fix here.
export function cellCentre(cell: CellKey): { x: number; y: number } {
  const { x, y } = parseCell(cell)
  return { x: x + 0.5, y: y + 0.5 }
}
