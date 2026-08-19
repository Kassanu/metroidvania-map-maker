import { describe, expect, it } from 'vitest'
import { edgeOfCell } from '../cell'
import { WORLD_AREA_ID } from '../ids'
import type { MapId, RoomId } from '../ids'
import { createFromBox, createTeleport, setDirection, setLock } from '../ops/doors'
import { addMap } from '../ops/maps'
import { placeIcon } from '../ops/markup'
import { createNewArea, createNewLockType } from '../ops/project'
import { drawInnerWall, paintCells } from '../ops/rooms'
import { openProject } from '../serialize'
import { makeRoom, ok, rect, setup, tx, TEST_ICON_COLORS } from '../testUtils'
import example from './fixtures/example-export.json'
import { toCombinedExport, toRoomExports } from './index'
import type { ExportScope } from './index'
import type { ExportRoom } from './schema'
import { EXPORT_FORMAT_VERSION, GENERATOR_NAME } from './schema'
import fixture from '../serialize/fixtures/v1-project.mvm.json'

// Two rooms sharing a seam, with a one-segment door across it. The door's A
// end is the left room, because the box drag started there.
function twoRooms() {
  const { project, map } = setup()
  const left = makeRoom(project, map, rect(0, 0, 2, 2))
  const right = makeRoom(project, map, rect(2, 0, 2, 2))
  const transaction = tx(map)
  const door = ok(createFromBox(transaction, project, map, '1,0', '2,0'))[0]
  transaction.commit()
  return { project, map, left, right, door }
}

function roomOf(tabs: { rooms: ExportRoom[] }[], id: RoomId): ExportRoom {
  for (const tab of tabs) {
    const found = tab.rooms.find((room) => room.id === id)
    if (found) return found
  }
  throw new Error(`no exported room ${id}`)
}

function scopeOf(mapId: MapId, ...roomIds: RoomId[]): ExportScope {
  return new Map([[mapId, new Set(roomIds)]])
}

describe('the envelope', () => {
  it('stamps the format version and the generator', () => {
    const { project } = twoRooms()
    const out = toCombinedExport(project)

    expect(out.formatVersion).toBe(EXPORT_FORMAT_VERSION)
    expect(out.generator.name).toBe(GENERATOR_NAME)
    expect(out.generator.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(out.project).toEqual({ name: project.name })
  })

  it('lists tabs in tab order and rooms in Hierarchy order', () => {
    const { project, map } = twoRooms()
    const second = tx()
    const other = addMap(second, project, 'Map 2')
    second.commit()
    makeRoom(project, other, rect(0, 0, 1, 1))

    const out = toCombinedExport(project)
    expect(out.tabs.map((tab) => tab.id)).toEqual([map.id, other.id])
    expect(out.tabs[0].rooms.map((room) => room.id)).toEqual(map.roomOrder)
  })

  it('reproduces the example file from the save-format fixture', () => {
    const project = openProject(fixture).accept()
    expect(toCombinedExport(project)).toEqual(example)
  })
})

describe('packaging', () => {
  it('hands back one envelope per room, carrying its tab', () => {
    const { project, map, left, right } = twoRooms()
    const files = toRoomExports(project)

    expect(files.map((file) => file.room.id)).toEqual([left.id, right.id])
    expect(files[0].tab).toEqual({ id: map.id, name: map.name, notes: map.notes })
  })

  it('builds a room object identical to the combined one', () => {
    const { project, left } = twoRooms()
    const combined = roomOf(toCombinedExport(project).tabs, left.id)
    const perRoom = toRoomExports(project).find((file) => file.room.id === left.id)!

    expect(JSON.stringify(perRoom.room)).toBe(JSON.stringify(combined))
  })
})

describe('scope', () => {
  it('exports the whole project when none is given', () => {
    const { project, left, right } = twoRooms()
    const out = toCombinedExport(project)
    expect(out.tabs[0].rooms.map((room) => room.id)).toEqual([left.id, right.id])
  })

  it('takes only the rooms it names', () => {
    const { project, map, left } = twoRooms()
    const out = toCombinedExport(project, scopeOf(map.id, left.id))
    expect(out.tabs[0].rooms.map((room) => room.id)).toEqual([left.id])
  })

  it('omits a tab with no rooms in scope', () => {
    const { project, map, left } = twoRooms()
    const second = tx()
    const other = addMap(second, project, 'Map 2')
    second.commit()
    makeRoom(project, other, rect(0, 0, 1, 1))

    const out = toCombinedExport(project, scopeOf(map.id, left.id))
    expect(out.tabs.map((tab) => tab.id)).toEqual([map.id])
  })

  it('omits a tab holding no rooms at all', () => {
    const { project } = twoRooms()
    const second = tx()
    addMap(second, project, 'Empty')
    second.commit()

    expect(toCombinedExport(project).tabs).toHaveLength(1)
  })

  it('leaves a reference to an out-of-scope room standing', () => {
    const { project, map, left, right } = twoRooms()
    const out = toCombinedExport(project, scopeOf(map.id, left.id))
    const room = roomOf(out.tabs, left.id)

    expect(room.transitions[0].to.room).toBe(right.id)
    expect(out.tabs[0].rooms.map((each) => each.id)).not.toContain(right.id)
  })
})

describe('the room object', () => {
  it('writes cells row-major and absolute, negatives included', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, ['-1,0', '-2,-1', '-1,-1'])
    const exported = roomOf(toCombinedExport(project).tabs, room.id)

    expect(exported.cells).toEqual([
      [-2, -1],
      [-1, -1],
      [-1, 0],
    ])
    expect(exported.bounds).toEqual({ min: [-2, -1], max: [-1, 0], size: [2, 2] })
  })

  it('inlines the area whole, keeping unset colours null', () => {
    const { project, map } = setup()
    const world = makeRoom(project, map, rect(0, 0, 1, 1))

    const naming = tx()
    const area = createNewArea(naming, project, 'Crateria', '#3a5f7d', '#7fb2d9')
    naming.commit()
    const painted = tx(map)
    const crateria = paintCells(painted, project, map, rect(4, 0, 1, 1), { areaId: area.id })
    painted.commit()

    const tabs = toCombinedExport(project).tabs
    expect(roomOf(tabs, world.id).area).toEqual({
      id: WORLD_AREA_ID,
      name: 'World',
      cellColor: null,
      wallColor: null,
      notes: '',
    })
    expect(roomOf(tabs, crateria.id).area).toEqual({
      id: area.id,
      name: 'Crateria',
      cellColor: '#3a5f7d',
      wallColor: '#7fb2d9',
      notes: '',
    })
  })

  it('gives each room only the icons standing in it', () => {
    const { project, map, left, right } = twoRooms()
    const marking = tx(map)
    const icon = ok(placeIcon(marking, map, '0,0', 'save', TEST_ICON_COLORS))
    ok(placeIcon(marking, map, '3,1', 'missile', TEST_ICON_COLORS))
    marking.commit()

    const tabs = toCombinedExport(project).tabs
    expect(roomOf(tabs, left.id).icons).toEqual([
      {
        id: icon.id,
        type: 'save',
        cell: [0, 0],
        label: '',
        plateColor: TEST_ICON_COLORS.plateColor,
        glyphColor: TEST_ICON_COLORS.glyphColor,
        notes: '',
      },
    ])
    expect(roomOf(tabs, right.id).icons.map((each) => each.type)).toEqual(['missile'])
  })
})

describe('walls', () => {
  it('emits an outer wall once and an inner wall from both its cells', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 1))
    const drawing = tx(map)
    ok(drawInnerWall(drawing, map, room.id, edgeOfCell('0,0', 'E'), 'dotted'))
    drawing.commit()

    const walls = roomOf(toCombinedExport(project).tabs, room.id).walls
    expect(walls).toEqual([
      { cell: [0, 0], side: 'N', boundary: 'outer', style: 'solid' },
      { cell: [0, 0], side: 'E', boundary: 'inner', style: 'dotted' },
      { cell: [0, 0], side: 'S', boundary: 'outer', style: 'solid' },
      { cell: [0, 0], side: 'W', boundary: 'outer', style: 'solid' },
      { cell: [1, 0], side: 'N', boundary: 'outer', style: 'solid' },
      { cell: [1, 0], side: 'E', boundary: 'outer', style: 'solid' },
      { cell: [1, 0], side: 'S', boundary: 'outer', style: 'solid' },
      { cell: [1, 0], side: 'W', boundary: 'inner', style: 'dotted' },
    ])
  })

  it('keeps an inner wall style and always calls an outer wall solid', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 1))
    const drawing = tx(map)
    ok(drawInnerWall(drawing, map, room.id, edgeOfCell('0,0', 'E'), 'doorway'))
    drawing.commit()

    const walls = roomOf(toCombinedExport(project).tabs, room.id).walls
    expect(walls.filter((wall) => wall.boundary === 'inner').map((wall) => wall.style)).toEqual([
      'doorway',
      'doorway',
    ])
    expect(
      walls.filter((wall) => wall.boundary === 'outer').every((w) => w.style === 'solid'),
    ).toBe(true)
  })

  it('emits no wall on an edge a door occupies', () => {
    const { project, left, right } = twoRooms()
    const tabs = toCombinedExport(project).tabs

    expect(roomOf(tabs, left.id).walls).not.toContainEqual(
      expect.objectContaining({ cell: [1, 0], side: 'E' }),
    )
    expect(roomOf(tabs, right.id).walls).not.toContainEqual(
      expect.objectContaining({ cell: [2, 0], side: 'W' }),
    )
    // The rest of the seam, where no door sits, keeps its outer wall.
    expect(roomOf(tabs, left.id).walls).toContainEqual({
      cell: [1, 1],
      side: 'E',
      boundary: 'outer',
      style: 'solid',
    })
  })

  it('emits no wall on an edge an elevator end occupies', () => {
    const { project, map } = setup()
    const lower = makeRoom(project, map, rect(0, 0, 1, 1))
    const upper = makeRoom(project, map, rect(0, 3, 1, 1))
    const building = tx(map)
    ok(createFromBox(building, project, map, '0,0', '0,3'))
    building.commit()

    const tabs = toCombinedExport(project).tabs
    expect(roomOf(tabs, lower.id).walls.map((wall) => wall.side)).toEqual(['N', 'E', 'W'])
    expect(roomOf(tabs, upper.id).walls.map((wall) => wall.side)).toEqual(['E', 'S', 'W'])
  })

  it('leaves the outline intact around a teleport, which sits on no edge', () => {
    const { project, map } = setup()
    const here = makeRoom(project, map, rect(0, 0, 1, 1))
    makeRoom(project, map, rect(5, 0, 1, 1))
    const linking = tx(map)
    ok(
      createTeleport(
        linking,
        project,
        { mapId: map.id, cell: '0,0' },
        { mapId: map.id, cell: '5,0' },
      ),
    )
    linking.commit()

    expect(roomOf(toCombinedExport(project).tabs, here.id).walls).toHaveLength(4)
  })
})

describe('transitions', () => {
  it('leads with this room in both of the rooms it joins', () => {
    const { project, left, right } = twoRooms()
    const tabs = toCombinedExport(project).tabs

    const fromLeft = roomOf(tabs, left.id).transitions[0]
    expect(fromLeft.from.room).toBe(left.id)
    expect(fromLeft.from.cells).toEqual([[1, 0]])
    expect(fromLeft.from.side).toBe('E')
    expect(fromLeft.to.room).toBe(right.id)
    expect(fromLeft.to.cells).toEqual([[2, 0]])
    expect(fromLeft.to.side).toBe('W')

    const fromRight = roomOf(tabs, right.id).transitions[0]
    expect(fromRight.id).toBe(fromLeft.id)
    expect(fromRight.from.room).toBe(right.id)
    expect(fromRight.from.side).toBe('W')
    expect(fromRight.to.room).toBe(left.id)
    expect(fromRight.to.side).toBe('E')
  })

  it('follows the lock to whichever end holds it', () => {
    const { project, map, left, right, door } = twoRooms()
    const locking = tx(map)
    const missile = createNewLockType(locking, project, 'Missile Door', '#e23b3b', 'M')
    setLock(locking, project, map, door.id, 'a', missile.id)
    locking.commit()

    const tabs = toCombinedExport(project).tabs
    expect(roomOf(tabs, left.id).transitions[0].from.lock).toEqual({
      id: missile.id,
      name: 'Missile Door',
      color: '#e23b3b',
      glyph: 'M',
    })
    expect(roomOf(tabs, left.id).transitions[0].to.lock.id).toBe('open')
    expect(roomOf(tabs, right.id).transitions[0].from.lock.id).toBe('open')
    expect(roomOf(tabs, right.id).transitions[0].to.lock.id).toBe(missile.id)
  })

  it('restates direction against from, so a one-way reverses in the far room', () => {
    const { project, map, left, right, door } = twoRooms()
    const turning = tx(map)
    setDirection(turning, project, map, door.id, 'aToB')
    turning.commit()

    const tabs = toCombinedExport(project).tabs
    expect(roomOf(tabs, left.id).transitions[0].direction).toBe('fromTo')
    expect(roomOf(tabs, right.id).transitions[0].direction).toBe('toFrom')
  })

  it('restates a reversed one-way the same way', () => {
    const { project, map, left, right, door } = twoRooms()
    const turning = tx(map)
    setDirection(turning, project, map, door.id, 'bToA')
    turning.commit()

    const tabs = toCombinedExport(project).tabs
    expect(roomOf(tabs, left.id).transitions[0].direction).toBe('toFrom')
    expect(roomOf(tabs, right.id).transitions[0].direction).toBe('fromTo')
  })

  it('leaves a two-way transition undirected in both rooms', () => {
    const { project, left, right } = twoRooms()
    const tabs = toCombinedExport(project).tabs
    expect(roomOf(tabs, left.id).transitions[0].direction).toBe('both')
    expect(roomOf(tabs, right.id).transitions[0].direction).toBe('both')
  })

  it('states an N-wide door as one transition holding every cell it spans', () => {
    const { project, map } = setup()
    const left = makeRoom(project, map, rect(0, 0, 2, 3))
    const right = makeRoom(project, map, rect(2, 0, 2, 3))
    const building = tx(map)
    ok(createFromBox(building, project, map, '1,0', '2,2'))
    building.commit()

    const exported = roomOf(toCombinedExport(project).tabs, left.id).transitions[0]
    expect(exported.from.cells).toEqual([
      [1, 0],
      [1, 1],
      [1, 2],
    ])
    expect(exported.from.side).toBe('E')
    expect(exported.to.room).toBe(right.id)
  })

  it('carries the axis and the facing sides of an elevator', () => {
    const { project, map } = setup()
    const lower = makeRoom(project, map, rect(0, 0, 1, 1))
    const upper = makeRoom(project, map, rect(0, 3, 1, 1))
    const building = tx(map)
    ok(createFromBox(building, project, map, '0,0', '0,3'))
    building.commit()

    const exported = roomOf(toCombinedExport(project).tabs, lower.id).transitions[0]
    expect(exported.kind).toBe('elevator')
    expect(exported.axis).toBe('v')
    expect(exported.from).toMatchObject({ room: lower.id, cells: [[0, 0]], side: 'S' })
    expect(exported.to).toMatchObject({ room: upper.id, cells: [[0, 3]], side: 'N' })
  })

  it('gives a teleport no side, since it sits in a cell', () => {
    const { project, map } = setup()
    const here = makeRoom(project, map, rect(0, 0, 1, 1))
    const there = makeRoom(project, map, rect(5, 0, 1, 1))
    const linking = tx(map)
    ok(
      createTeleport(
        linking,
        project,
        { mapId: map.id, cell: '0,0' },
        { mapId: map.id, cell: '5,0' },
      ),
    )
    linking.commit()

    const exported = roomOf(toCombinedExport(project).tabs, here.id).transitions[0]
    expect(exported.kind).toBe('teleport')
    expect(exported.from.side).toBeUndefined()
    expect(exported.to.side).toBeUndefined()
    expect(exported.to.room).toBe(there.id)
    expect(exported.axis).toBeUndefined()
  })

  it('reaches a cross-tab teleport from the tab it lands on', () => {
    const { project, map } = setup()
    const here = makeRoom(project, map, rect(0, 0, 1, 1))
    const adding = tx()
    const other = addMap(adding, project, 'Map 2')
    adding.commit()
    const there = makeRoom(project, other, rect(9, 9, 1, 1))
    const linking = tx(map)
    ok(
      createTeleport(
        linking,
        project,
        { mapId: map.id, cell: '0,0' },
        { mapId: other.id, cell: '9,9' },
      ),
    )
    linking.commit()

    const tabs = toCombinedExport(project).tabs
    // The transition is stored under the origin tab only, so the destination
    // room finds it through the far-end index or not at all.
    const arriving = roomOf(tabs, there.id).transitions[0]
    expect(arriving.from).toMatchObject({ tab: other.id, room: there.id, cells: [[9, 9]] })
    expect(arriving.to).toMatchObject({ tab: map.id, room: here.id, cells: [[0, 0]] })
    expect(roomOf(tabs, here.id).transitions[0].to.tab).toBe(other.id)
  })
})

describe('ordering', () => {
  it('writes a room the same way however its cells were built', () => {
    const forwards = setup()
    const backwards = setup()

    const first = tx(forwards.map)
    paintCells(first, forwards.project, forwards.map, ['0,0', '1,0', '0,1', '1,1'], {
      areaId: WORLD_AREA_ID,
    })
    first.commit()

    const second = tx(backwards.map)
    paintCells(second, backwards.project, backwards.map, ['1,1', '0,1', '1,0', '0,0'], {
      areaId: WORLD_AREA_ID,
    })
    second.commit()

    expect(toCombinedExport(forwards.project).tabs[0].rooms[0].cells).toEqual(
      toCombinedExport(backwards.project).tabs[0].rooms[0].cells,
    )
  })

  it('survives cells being taken away and given back', () => {
    const { project, map } = setup()
    const build = tx(map)
    const room = paintCells(build, project, map, rect(0, 0, 3, 2), { areaId: WORLD_AREA_ID })
    drawInnerWall(build, map, room.id, edgeOfCell('0,0', 'E'), 'dotted')
    build.commit()
    const before = JSON.stringify(toCombinedExport(project))

    const merge = tx(map)
    paintCells(merge, project, map, ['5,0', '4,0', '3,0', '2,0'], { areaId: WORLD_AREA_ID })
    merge.commit()
    merge.replayUndo()

    expect(JSON.stringify(toCombinedExport(project))).toBe(before)
  })
})
