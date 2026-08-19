import { describe, expect, it } from 'vitest'
import { addMap } from '@/core/ops/maps'
import { createNewArea } from '@/core/ops/project'
import { paintCells } from '@/core/ops/rooms'
import { setRoomField } from '@/core/primitives'
import { WORLD_AREA_ID } from '@/core/ids'
import type { AreaId, RoomId } from '@/core/ids'
import { makeRoom, rect, setup, tx } from '@/core/testUtils'
import { allRooms, buildScopeTree, countOf, scopeOf, stateOf, toggle } from './scopeTree'
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

// Areas are listed in project order, so they are found by id rather than by
// position: World is the project's first area and Crateria the second.
function areaOn(tree: ScopeTab[], tab: number, areaId: AreaId): ScopeArea {
  return tree[tab].areas.find((area) => area.id === areaId)!
}

describe('buildScopeTree', () => {
  it('labels an unnamed room by position rather than leaving the row blank', () => {
    const { project, vault } = world()
    const tree = buildScopeTree(project)
    const row = tree[0].areas.flatMap((area) => area.rooms).find((room) => room.id === vault.id)!

    expect(row.label).not.toBe('')
    expect(row.label).toContain('8,0')
  })

  it('lists tabs in tab order, areas in project order, rooms in Hierarchy order', () => {
    const { project, map, caves, crateria } = world()
    const tree = buildScopeTree(project)

    expect(tree.map((tab) => tab.id)).toEqual([map.id, caves.id])
    // World before Crateria, because that is the order the project lists them
    // and the order the Hierarchy shows them in.
    expect(tree[0].areas.map((area) => area.id)).toEqual([WORLD_AREA_ID, crateria.id])
    expect(areaOn(tree, 0, crateria.id).rooms.map((room) => room.label)).toEqual([
      'Landing Site',
      'Corridor',
    ])
  })

  it('scopes an area to its tab, so one area appears under both holding different rooms', () => {
    const { project, crateria, landing, corridor, depths } = world()
    const tree = buildScopeTree(project)

    const onSurface = areaOn(tree, 0, crateria.id)
    const inCaves = areaOn(tree, 1, crateria.id)

    expect(onSurface.rooms.map((room) => room.id)).toEqual([landing.id, corridor.id])
    expect(inCaves.rooms.map((room) => room.id)).toEqual([depths.id])
  })

  it('leaves out an area with no rooms on this tab', () => {
    const { project } = world()
    const tree = buildScopeTree(project)

    // World holds a room on Surface and none in Caves.
    expect(tree[0].areas.map((area) => area.id)).toContain(WORLD_AREA_ID)
    expect(tree[1].areas.map((area) => area.id)).not.toContain(WORLD_AREA_ID)
  })

  it('keeps a tab with no rooms, holding nothing', () => {
    const { project } = world()
    const adding = tx()
    const empty = addMap(adding, project, 'Empty')
    adding.commit()

    const tree = buildScopeTree(project)
    expect(tree.map((tab) => tab.id)).toContain(empty.id)
    expect(tree.find((tab) => tab.id === empty.id)!.areas).toEqual([])
  })
})

// The tri-state table: what each level reads as, for each way its rooms can be
// ticked. One `it` per row.
describe('stateOf', () => {
  it('reads a room as its own membership', () => {
    const { project, landing, crateria } = world()
    const room = areaOn(buildScopeTree(project), 0, crateria.id).rooms[0]

    expect(stateOf(room, ids(landing))).toBe(true)
    expect(stateOf(room, new Set())).toBe(false)
  })

  it('reads an area as indeterminate while only some of its rooms are ticked', () => {
    const { project, landing, crateria } = world()
    const area = areaOn(buildScopeTree(project), 0, crateria.id)
    expect(stateOf(area, ids(landing))).toBe('indeterminate')
  })

  it('promotes an area to checked once its last room is ticked', () => {
    const { project, landing, corridor, crateria } = world()
    const area = areaOn(buildScopeTree(project), 0, crateria.id)
    expect(stateOf(area, ids(landing, corridor))).toBe(true)
  })

  it('reads a tab across all of its areas at once', () => {
    const { project, landing, corridor, vault } = world()
    const tab = buildScopeTree(project)[0]

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

    const tab = buildScopeTree(project).find((each) => each.id === empty.id)!
    expect(stateOf(tab, new Set())).toBe(false)
  })
})

describe('toggle', () => {
  it('takes every room under the node it was given', () => {
    const { project, landing, corridor, crateria } = world()
    const area = areaOn(buildScopeTree(project), 0, crateria.id)

    expect(toggle(area, new Set(), true)).toEqual(ids(landing, corridor))
  })

  it('never reaches the same area on another tab', () => {
    const { project, landing, corridor, depths, crateria } = world()
    const tree = buildScopeTree(project)
    const onSurface = areaOn(tree, 0, crateria.id)

    const ticked = toggle(onSurface, new Set(), true)
    expect(ticked).toEqual(ids(landing, corridor))
    expect(ticked.has(depths.id)).toBe(false)
  })

  it('clears only its own rooms when unticked', () => {
    const { project, landing, corridor, vault, depths } = world()
    const tree = buildScopeTree(project)

    const everything = allRooms(tree)
    const withoutSurface = toggle(tree[0], everything, false)

    expect(withoutSurface).toEqual(ids(depths))
    expect(withoutSurface.has(landing.id)).toBe(false)
    expect(withoutSurface.has(corridor.id)).toBe(false)
    expect(withoutSurface.has(vault.id)).toBe(false)
  })

  it('leaves the set it was given alone', () => {
    const { project, landing, crateria } = world()
    const area = areaOn(buildScopeTree(project), 0, crateria.id)
    const before = ids(landing)

    toggle(area, before, true)
    expect(before).toEqual(ids(landing))
  })
})

describe('scopeOf', () => {
  it('regroups a flat selection by tab', () => {
    const { project, map, caves, landing, depths } = world()
    const tree = buildScopeTree(project)

    expect(scopeOf(tree, ids(landing, depths))).toEqual(
      new Map([
        [map.id, ids(landing)],
        [caves.id, ids(depths)],
      ]),
    )
  })

  it('leaves out a tab contributing nothing, rather than mapping it to an empty set', () => {
    const { project, map, landing } = world()
    const tree = buildScopeTree(project)

    const scope = scopeOf(tree, ids(landing))
    expect([...scope.keys()]).toEqual([map.id])
  })

  it('is empty when nothing is selected', () => {
    const { project } = world()
    expect(scopeOf(buildScopeTree(project), new Set()).size).toBe(0)
  })
})

describe('countOf', () => {
  it('counts the tabs that contribute and the rooms they contribute', () => {
    const { project, landing, depths } = world()
    const tree = buildScopeTree(project)

    expect(countOf(tree, allRooms(tree))).toEqual({ tabs: 2, rooms: 4 })
    expect(countOf(tree, ids(landing, depths))).toEqual({ tabs: 2, rooms: 2 })
    expect(countOf(tree, ids(landing))).toEqual({ tabs: 1, rooms: 1 })
    expect(countOf(tree, new Set())).toEqual({ tabs: 0, rooms: 0 })
  })
})
