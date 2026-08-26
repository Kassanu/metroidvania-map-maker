import { describe, expect, it } from 'vitest'
import { addMap } from '@/core/ops/maps'
import { createLine } from '@/core/ops/markup'
import { createNewArea } from '@/core/ops/project'
import { paintCells } from '@/core/ops/rooms'
import { setRoomField } from '@/core/primitives'
import { WORLD_AREA_ID } from '@/core/ids'
import type { AreaId, RoomId } from '@/core/ids'
import type { MapModel, ProjectModel } from '@/core/types'
import { makeRoom, rect, setup, tx } from '@/core/testUtils'
import {
  allLeaves,
  buildScopeTree,
  countOf,
  hasScopableTab,
  leavesUnder,
  scopeOf,
  stateOf,
  toggle,
} from './scopeTree'
import { jsonScopeEmpty } from './index'
import type { ScopeArea, ScopeTab } from './scopeTree'

// Two tabs, and one area holding rooms on both of them: the shape the tree
// exists to express, and the one a Hierarchy-shaped two-level tree cannot.
//
//   Surface   Crateria: landing, corridor
//             World:    vault
//   Caves     Crateria: depths
function world() {
  const { project, map } = setup()

  const naming = tx()
  const crateria = createNewArea(naming, project, 'Crateria', '#3a5f7d', '#7fb2d9')
  const caves = addMap(naming, project, 'Caves')
  naming.commit()

  const painting = tx(map)
  const landing = paintCells(painting, project, map, rect(0, 0, 2, 2), { areaId: crateria.id })
  const corridor = paintCells(painting, project, map, rect(4, 0, 2, 2), { areaId: crateria.id })
  setRoomField(painting, map, landing, 'name', 'Landing Site')
  setRoomField(painting, map, corridor, 'name', 'Corridor')
  painting.commit()

  const vault = makeRoom(project, map, rect(8, 0, 1, 1))

  const below = tx(caves)
  const depths = paintCells(below, project, caves, rect(0, 0, 1, 1), { areaId: crateria.id })
  below.commit()

  return { project, map, caves, crateria, landing, corridor, vault, depths }
}

function ids(...rooms: { id: RoomId }[]): Set<RoomId> {
  return new Set(rooms.map((room) => room.id))
}

// The depth the game-friendly export picks at, which is what every test below
// this line reads unless it says otherwise.
function roomTree(project: ProjectModel): ScopeTab[] {
  return buildScopeTree(project, { leaf: 'room', isEmpty: jsonScopeEmpty })
}

function areasOn(tree: ScopeTab[], tab: number): ScopeArea[] {
  return tree[tab].areas!
}

// Areas are listed in project order, so they are found by id rather than by
// position: World is the project's first area and Crateria the second.
function areaOn(tree: ScopeTab[], tab: number, areaId: AreaId): ScopeArea {
  return areasOn(tree, tab).find((area) => area.id === areaId)!
}

describe('buildScopeTree', () => {
  it('labels an unnamed room by position rather than leaving the row blank', () => {
    const { project, vault } = world()
    const tree = roomTree(project)
    const row = areasOn(tree, 0)
      .flatMap((area) => area.rooms)
      .find((room) => room.id === vault.id)!

    expect(row.label).not.toBe('')
    expect(row.label).toContain('8,0')
  })

  it('lists tabs in tab order, areas in project order, rooms in Hierarchy order', () => {
    const { project, map, caves, crateria } = world()
    const tree = roomTree(project)

    expect(tree.map((tab) => tab.id)).toEqual([map.id, caves.id])
    // World before Crateria, because that is the order the project lists them
    // and the order the Hierarchy shows them in.
    expect(areasOn(tree, 0).map((area) => area.id)).toEqual([WORLD_AREA_ID, crateria.id])
    expect(areaOn(tree, 0, crateria.id).rooms.map((room) => room.label)).toEqual([
      'Landing Site',
      'Corridor',
    ])
  })

  it('scopes an area to its tab, so one area appears under both holding different rooms', () => {
    const { project, crateria, landing, corridor, depths } = world()
    const tree = roomTree(project)

    const onSurface = areaOn(tree, 0, crateria.id)
    const inCaves = areaOn(tree, 1, crateria.id)

    expect(onSurface.rooms.map((room) => room.id)).toEqual([landing.id, corridor.id])
    expect(inCaves.rooms.map((room) => room.id)).toEqual([depths.id])
  })

  it('leaves out an area with no rooms on this tab', () => {
    const { project } = world()
    const tree = roomTree(project)

    // World holds a room on Surface and none in Caves.
    expect(areasOn(tree, 0).map((area) => area.id)).toContain(WORLD_AREA_ID)
    expect(areasOn(tree, 1).map((area) => area.id)).not.toContain(WORLD_AREA_ID)
  })

  it('keeps a tab with no rooms, holding nothing', () => {
    const { project } = world()
    const adding = tx()
    const empty = addMap(adding, project, 'Empty')
    adding.commit()

    const tree = roomTree(project)
    expect(tree.map((tab) => tab.id)).toContain(empty.id)
    expect(tree.find((tab) => tab.id === empty.id)!.areas).toEqual([])
  })
})

// The tri-state table: what each level reads as, for each way its rooms can be
// ticked. One `it` per row.
describe('stateOf', () => {
  it('reads a room as its own membership', () => {
    const { project, landing, crateria } = world()
    const room = areaOn(roomTree(project), 0, crateria.id).rooms[0]

    expect(stateOf(room, ids(landing))).toBe(true)
    expect(stateOf(room, new Set())).toBe(false)
  })

  it('reads an area as indeterminate while only some of its rooms are ticked', () => {
    const { project, landing, crateria } = world()
    const area = areaOn(roomTree(project), 0, crateria.id)
    expect(stateOf(area, ids(landing))).toBe('indeterminate')
  })

  it('promotes an area to checked once its last room is ticked', () => {
    const { project, landing, corridor, crateria } = world()
    const area = areaOn(roomTree(project), 0, crateria.id)
    expect(stateOf(area, ids(landing, corridor))).toBe(true)
  })

  it('reads a tab across all of its areas at once', () => {
    const { project, landing, corridor, vault } = world()
    const tab = roomTree(project)[0]

    expect(stateOf(tab, new Set())).toBe(false)
    expect(stateOf(tab, ids(landing))).toBe('indeterminate')
    expect(stateOf(tab, ids(landing, corridor))).toBe('indeterminate')
    expect(stateOf(tab, ids(landing, corridor, vault))).toBe(true)
  })

  it('reads a tab with no rooms as unchecked, not as vacuously checked', () => {
    const { project } = world()
    const adding = tx()
    const empty = addMap(adding, project, 'Empty')
    adding.commit()

    const tab = roomTree(project).find((each) => each.id === empty.id)!
    expect(stateOf(tab, new Set())).toBe(false)
  })
})

describe('toggle', () => {
  it('takes every room under the node it was given', () => {
    const { project, landing, corridor, crateria } = world()
    const area = areaOn(roomTree(project), 0, crateria.id)

    expect(toggle(area, new Set(), true)).toEqual(ids(landing, corridor))
  })

  it('never reaches the same area on another tab', () => {
    const { project, landing, corridor, depths, crateria } = world()
    const tree = roomTree(project)
    const onSurface = areaOn(tree, 0, crateria.id)

    const ticked = toggle(onSurface, new Set(), true)
    expect(ticked).toEqual(ids(landing, corridor))
    expect(ticked.has(depths.id)).toBe(false)
  })

  it('clears only its own rooms when unticked', () => {
    const { project, landing, corridor, vault, depths } = world()
    const tree = roomTree(project)

    const everything = allLeaves(tree)
    const withoutSurface = toggle(tree[0], everything, false)

    expect(withoutSurface).toEqual(ids(depths))
    expect(withoutSurface.has(landing.id)).toBe(false)
    expect(withoutSurface.has(corridor.id)).toBe(false)
    expect(withoutSurface.has(vault.id)).toBe(false)
  })

  it('leaves the set it was given alone', () => {
    const { project, landing, crateria } = world()
    const area = areaOn(roomTree(project), 0, crateria.id)
    const before = ids(landing)

    toggle(area, before, true)
    expect(before).toEqual(ids(landing))
  })
})

describe('scopeOf', () => {
  it('regroups a flat selection by tab', () => {
    const { project, map, caves, landing, depths } = world()
    const tree = roomTree(project)

    expect(scopeOf(tree, ids(landing, depths))).toEqual(
      new Map([
        [map.id, ids(landing)],
        [caves.id, ids(depths)],
      ]),
    )
  })

  it('leaves out a tab contributing nothing, rather than mapping it to an empty set', () => {
    const { project, map, landing } = world()
    const tree = roomTree(project)

    const scope = scopeOf(tree, ids(landing))
    expect([...scope.keys()]).toEqual([map.id])
  })

  it('is empty when nothing is selected', () => {
    const { project } = world()
    expect(scopeOf(roomTree(project), new Set()).size).toBe(0)
  })
})

describe('countOf', () => {
  it('counts the tabs that contribute and the rooms they contribute', () => {
    const { project, landing, depths } = world()
    const tree = roomTree(project)

    expect(countOf(tree, allLeaves(tree))).toEqual({ tabs: 2, leaves: 4 })
    expect(countOf(tree, ids(landing, depths))).toEqual({ tabs: 2, leaves: 2 })
    expect(countOf(tree, ids(landing))).toEqual({ tabs: 1, leaves: 1 })
    expect(countOf(tree, new Set())).toEqual({ tabs: 0, leaves: 0 })
  })

  // A dialog reads "nothing is selected" off the leaf count, so a count that
  // stayed fixed on rooms would answer zero for every tab-depth selection and
  // refuse to export however much was ticked.
  it('counts a ticked tab as a leaf at tab depth', () => {
    const { project, map, caves } = world()
    const tree = tabTree(project, jsonScopeEmpty)

    expect(countOf(tree, new Set([map.id]))).toEqual({ tabs: 1, leaves: 1 })
    expect(countOf(tree, new Set([map.id, caves.id]))).toEqual({ tabs: 2, leaves: 2 })
    expect(countOf(tree, new Set())).toEqual({ tabs: 0, leaves: 0 })
  })
})

// What decides an entrance is live, asked without building a tree. It has to
// agree with the tree the same predicate would build, or a live menu item opens
// onto a picker where nothing can be ticked.
describe('hasScopableTab', () => {
  it('is true while any tab is not empty by the given predicate', () => {
    const { project } = world()
    expect(hasScopableTab(project, jsonScopeEmpty)).toBe(true)
  })

  it('is false when every tab is empty by it', () => {
    const { project } = setup()
    expect(hasScopableTab(project, jsonScopeEmpty)).toBe(false)
  })

  it('agrees with the tree that predicate builds', () => {
    const { project } = setup()
    const sketched = withLineOnlyTab(project)
    const linesCount = (map: MapModel) => map.rooms.size === 0 && map.lines.size === 0

    for (const isEmpty of [jsonScopeEmpty, linesCount]) {
      const tree = tabTree(project, isEmpty)
      expect(hasScopableTab(project, isEmpty)).toBe(tree.some((tab) => !tab.empty))
    }

    // The two disagree about this project, which is what makes the loop above
    // more than one assertion written twice.
    expect(hasScopableTab(project, jsonScopeEmpty)).toBe(false)
    expect(hasScopableTab(project, linesCount)).toBe(true)
    expect(sketched.lines.size).toBe(1)
  })
})

// The second depth, which image export picks at. The same functions over the
// same selection set, with the leaf one level up.
function tabTree(project: ProjectModel, isEmpty: (map: MapModel) => boolean): ScopeTab[] {
  return buildScopeTree(project, { leaf: 'tab', isEmpty })
}

// A tab holding a line and nothing else: the one case the two exporters answer
// differently, so it is what tells them apart.
function withLineOnlyTab(project: ProjectModel) {
  const adding = tx()
  const sketched = addMap(adding, project, 'Sketch')
  adding.commit()

  const drawing = tx(sketched)
  createLine(drawing, sketched, ['0,0', '1,0'], {
    color: '#ffffff',
    arrowStart: false,
    arrowEnd: false,
  })
  drawing.commit()

  return sketched
}

describe('at tab depth', () => {
  it('gives one node per tab, with null areas rather than an empty list', () => {
    const { project, map, caves } = world()
    const tree = tabTree(project, jsonScopeEmpty)

    expect(tree.map((tab) => tab.id)).toEqual([map.id, caves.id])
    for (const tab of tree) expect(tab.areas).toBeNull()
  })

  it('makes the tab its own leaf', () => {
    const { project, map } = world()
    const tree = tabTree(project, jsonScopeEmpty)

    expect(leavesUnder(tree[0])).toEqual([map.id])
  })

  it('reads a ticked tab as checked and an unticked one as unchecked', () => {
    const { project, map } = world()
    const tree = tabTree(project, jsonScopeEmpty)

    expect(stateOf(tree[0], new Set([map.id]))).toBe(true)
    expect(stateOf(tree[0], new Set())).toBe(false)
  })

  it('ticks and unticks a tab through the same toggle', () => {
    const { project, map } = world()
    const tree = tabTree(project, jsonScopeEmpty)

    const ticked = toggle(tree[0], new Set(), true)
    expect(ticked).toEqual(new Set([map.id]))
    expect(toggle(tree[0], ticked, false)).toEqual(new Set())
  })

  it('keeps an empty tab out of the opening tick, since it cannot be ticked', () => {
    const { project } = world()
    const adding = tx()
    const empty = addMap(adding, project, 'Empty')
    adding.commit()

    const tree = tabTree(project, jsonScopeEmpty)
    expect(tree.find((tab) => tab.id === empty.id)!.empty).toBe(true)
    expect(allLeaves(tree).has(empty.id)).toBe(false)
  })

  // Where the two exporters part company. A tab holding only lines has nothing
  // to write as JSON and something real to draw as a picture, so collapsing the
  // two predicates into one would disable a tab that has a picture in it.
  it('takes emptiness from the predicate it was given, not from the rooms', () => {
    const { project } = world()
    const sketched = withLineOnlyTab(project)

    const forJson = tabTree(project, jsonScopeEmpty)
    const forImages = tabTree(project, (map) => map.rooms.size === 0 && map.lines.size === 0)

    expect(forJson.find((tab) => tab.id === sketched.id)!.empty).toBe(true)
    expect(forImages.find((tab) => tab.id === sketched.id)!.empty).toBe(false)
  })
})
