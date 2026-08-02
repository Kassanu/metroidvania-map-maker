import { describe, it, expect } from 'vitest'
import { edgeOfCell } from '../cell'
import { getFarEnd } from '../farEnds'
import { OPEN_LOCK_ID, WORLD_AREA_ID } from '../ids'
import { createTeleport, createFromBox } from '../ops/doors'
import { addMap } from '../ops/maps'
import { createNewArea, createNewLockType } from '../ops/project'
import { drawInnerWall, paintCells } from '../ops/rooms'
import { createLine, placeIcon } from '../ops/markup'
import { checkInvariants, makeRoom, ok, rect, setup, sorted, tx } from '../testUtils'
import { InvalidFileError, fromJSON, openProject, toJSON } from './index'
import type { LoadEvent, LoadEventKind, LoadReport } from './index'
import { UnsupportedVersionError } from './migrate'
import { FILE_FORMAT, FILE_VERSION } from './schema'
import type { JsonFile } from './schema'

// Narrows to one kind of repair, so a test asserting about dropped icons is
// not disturbed by an unrelated event appearing alongside it.
function eventsOf<K extends LoadEventKind>(
  report: LoadReport,
  kind: K,
): Extract<LoadEvent, { kind: K }>[] {
  return report.events.filter((event): event is Extract<LoadEvent, { kind: K }> => {
    return event.kind === kind
  })
}

// Builds a project exercising every persisted construct.
function populated() {
  const { project, map } = setup()

  const setupTx = tx()
  const brinstar = createNewArea(setupTx, project, 'Brinstar', '#2b6', '#efe')
  const missile = createNewLockType(setupTx, project, 'Missile', '#e23b3b', '▲')
  const second = addMap(setupTx, project, 'Map 2')
  setupTx.commit()

  const content = tx(map)
  const a = paintCells(content, project, map, rect(0, 0, 2, 3), { areaId: brinstar.id })!
  const b = paintCells(content, project, map, rect(2, 0, 2, 3), { areaId: WORLD_AREA_ID })!
  a.name = 'Landing Site'
  a.notes = 'ship'
  drawInnerWall(content, map, a.id, edgeOfCell('0,0', 'S'), 'dotted')
  ok(placeIcon(content, map, '1,1', 'save'))
  ok(
    createLine(content, map, ['0,0', '1,1', '2,1'], {
      color: '#ffcc00',
      arrowStart: false,
      arrowEnd: true,
    }),
  )
  const [door] = ok(createFromBox(content, project, map, '1,0', '2,2'))
  door.locks = { a: missile.id, b: OPEN_LOCK_ID }
  door.oneWay = true
  content.commit()

  const far = tx(second)
  paintCells(far, project, second, ['9,9'], { areaId: WORLD_AREA_ID })
  far.commit()

  const link = tx(map)
  ok(
    createTeleport(
      link,
      project,
      { mapId: map.id, cell: '0,2' },
      { mapId: second.id, cell: '9,9' },
    ),
  )
  link.commit()

  return { project, map, second, a, b, brinstar, missile, door }
}

describe('round trip', () => {
  it('re-reads a full project to the same model', () => {
    const { project } = populated()
    const { project: reloaded, report } = fromJSON(toJSON(project))

    // A clean round trip repairs nothing at all, which is now one assertion
    // rather than one per counter. It covers kinds added later for free.
    expect(report.events).toEqual([])

    // Serialising the reload must produce byte-identical JSON.
    expect(toJSON(reloaded)).toEqual(toJSON(project))
  })

  it('preserves tab order and Hierarchy room order', () => {
    const { project } = populated()
    const { project: reloaded } = fromJSON(toJSON(project))
    expect(reloaded.maps).toEqual(project.maps)

    const original = project.mapsById.get(project.maps[0])!
    const copy = reloaded.mapsById.get(reloaded.maps[0])!
    expect(copy.roomOrder).toEqual(original.roomOrder)
  })

  it('rebuilds the cell-owner index and derives walls rather than storing them', () => {
    const { project, map } = populated()
    const file = toJSON(project)

    // Outer walls are never persisted: only cells and inner walls are.
    const room = file.project.maps[0].rooms[0]
    expect(room).not.toHaveProperty('outerWalls')
    expect(room.innerWalls).toHaveLength(1)

    const { project: reloaded } = fromJSON(file)
    const copy = reloaded.mapsById.get(map.id)!
    expect(sorted(copy.cellOwner.keys())).toEqual(sorted(map.cellOwner.keys()))
  })

  it('rebuilds the cross-tab teleport far-end index', () => {
    const { project, second } = populated()
    const { project: reloaded } = fromJSON(toJSON(project))
    expect(getFarEnd(reloaded.teleportFarEnds, second.id, '9,9')).toBeDefined()
    // Stored once, under the origin map only.
    expect(reloaded.mapsById.get(second.id)!.transitions.size).toBe(0)
  })

  it('rebuilds the edge and cell hit-testing indices', () => {
    const { project, map, door } = populated()
    const { project: reloaded } = fromJSON(toJSON(project))
    const copy = reloaded.mapsById.get(map.id)!
    expect(copy.transitionsAtEdge.get(edgeOfCell('1,0', 'E'))?.has(door.id)).toBe(true)
    expect(copy.transitionsAtCell.get('0,2')?.size).toBe(1)
  })

  it('keeps per-end locks and one-way direction', () => {
    const { project, door, missile } = populated()
    const { project: reloaded } = fromJSON(toJSON(project))
    const copy = [...reloaded.mapsById.values()]
      .flatMap((map) => [...map.transitions.values()])
      .find((transition) => transition.id === door.id)!
    expect(copy.locks).toEqual({ a: missile.id, b: OPEN_LOCK_ID })
    expect(copy.oneWay).toBe(true)
  })
})

// A room's cells and inner walls live in a Set and a Map with insertion-order
// iteration. A re-insertion goes to the end, so an undo that moves cells back
// to their original room changes their order in the structure, even though the
// model is logically identical.
describe('canonical ordering', () => {
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

    expect(toJSON(forwards.project).project.maps[0].rooms[0].cells).toEqual(
      toJSON(backwards.project).project.maps[0].rooms[0].cells,
    )
  })

  it('survives cells being taken away and given back', () => {
    const { project, map } = setup()

    const build = tx(map)
    const room = paintCells(build, project, map, rect(0, 0, 3, 2), { areaId: WORLD_AREA_ID })
    drawInnerWall(build, map, room.id, edgeOfCell('0,0', 'E'), 'dotted')
    drawInnerWall(build, map, room.id, edgeOfCell('1,0', 'E'), 'solid')
    build.commit()
    const before = JSON.stringify(toJSON(project))

    // Absorb the room into another and undo it: every cell leaves and comes
    // back, in a different order than it left.
    const merge = tx(map)
    paintCells(merge, project, map, ['5,0', '4,0', '3,0', '2,0'], { areaId: WORLD_AREA_ID })
    merge.commit()
    merge.replayUndo()

    expect(JSON.stringify(toJSON(project))).toBe(before)
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('file envelope', () => {
  it('writes the format marker and version', () => {
    const { project } = setup()
    const file = toJSON(project)
    expect(file.format).toBe(FILE_FORMAT)
    expect(file.version).toBe(FILE_VERSION)
  })

  it('rejects anything that is not one of our files', () => {
    expect(() => fromJSON(null)).toThrow(InvalidFileError)
    expect(() => fromJSON({ format: 'something-else', version: 1, project: {} })).toThrow(
      InvalidFileError,
    )
    expect(() => fromJSON({ format: FILE_FORMAT, project: {} })).toThrow(InvalidFileError)
  })

  it('refuses a file from a newer build rather than mangling it', () => {
    const { project } = setup()
    const file = { ...toJSON(project), version: FILE_VERSION + 1 }
    expect(() => fromJSON(file)).toThrow(UnsupportedVersionError)
  })
})

describe('repair on load', () => {
  function fileWith(mutate: (file: JsonFile) => void): JsonFile {
    const { project } = setup()
    const seed = tx()
    const map = project.mapsById.get(project.maps[0])!
    seed.commit()
    makeRoom(project, map, rect(0, 0, 2, 1))
    const file = toJSON(project)
    mutate(file)
    return file
  }

  it('drops overlapping cells first-wins: rooms never overlap', () => {
    const file = fileWith((f) => {
      f.project.maps[0].rooms.push({
        id: 'room_intruder',
        areaId: WORLD_AREA_ID,
        cells: [
          [0, 0],
          [5, 5],
        ],
      })
    })
    const { project, report } = fromJSON(file)
    expect(eventsOf(report, 'cell-dropped')).toHaveLength(1)
    const map = project.mapsById.get(project.maps[0])!
    expect(map.cellOwner.get('0,0')).not.toBe('room_intruder')
    expect(map.cellOwner.get('5,5')).toBe('room_intruder')
  })

  it('splits a room whose stored cells are disconnected', () => {
    const file = fileWith((f) => {
      f.project.maps[0].rooms[0].cells = [
        [0, 0],
        [9, 9],
      ]
    })
    const { project, report } = fromJSON(file)
    expect(eventsOf(report, 'room-split')).toEqual([
      expect.objectContaining({ kind: 'room-split', into: 2 }),
    ])
    expect(project.mapsById.get(project.maps[0])!.rooms.size).toBe(2)
  })

  it('falls back to World for an unknown area reference', () => {
    const file = fileWith((f) => {
      f.project.maps[0].rooms[0].areaId = 'area_deleted'
    })
    const { project, report } = fromJSON(file)
    expect(eventsOf(report, 'area-remapped')).toHaveLength(1)
    const room = [...project.mapsById.get(project.maps[0])!.rooms.values()][0]
    expect(room.areaId).toBe(WORLD_AREA_ID)
  })

  it('falls back to Open for an unknown lock reference', () => {
    const file = fileWith((f) => {
      // A second room because a teleport's two ends must be in different
      // rooms. The base fixture's single 2x1 room would make it invalid, and
      // load now drops invalid transitions rather than trusting the file.
      f.project.maps[0].rooms.push({
        id: 'room_far',
        areaId: WORLD_AREA_ID,
        cells: [[8, 8]],
      })
      f.project.maps[0].transitions.push({
        id: 'tr_x',
        type: 'teleport',
        locks: { a: 'lock_gone', b: 'lock_gone' },
        geometry: {
          a: { mapId: f.project.maps[0].id, cell: [0, 0] },
          b: { mapId: f.project.maps[0].id, cell: [8, 8] },
        },
      })
    })
    const { project, report } = fromJSON(file)
    expect(eventsOf(report, 'lock-remapped')).toHaveLength(2)
    const transition = [...project.mapsById.get(project.maps[0])!.transitions.values()][0]
    expect(transition.locks).toEqual({ a: OPEN_LOCK_ID, b: OPEN_LOCK_ID })
  })

  it('drops an inner wall that is not strictly interior', () => {
    const file = fileWith((f) => {
      f.project.maps[0].rooms[0].innerWalls = [
        // The north boundary of the room: an outer wall, never storable.
        {
          seg: [
            [0, 0],
            [1, 0],
          ],
          style: 'solid',
        },
      ]
    })
    const { report } = fromJSON(file)
    expect(eventsOf(report, 'inner-wall-dropped')).toEqual([
      expect.objectContaining({ reason: 'not-interior' }),
    ])
  })

  it('drops an icon outside every room, and a second icon on one cell', () => {
    const file = fileWith((f) => {
      f.project.maps[0].icons.push(
        { id: 'ic_1', iconType: 'save', cell: [0, 0] },
        { id: 'ic_2', iconType: 'boss', cell: [0, 0] },
        { id: 'ic_3', iconType: 'item', cell: [40, 40] },
      )
    })
    const { project, report } = fromJSON(file)
    // Two different failures, reported as two different reasons.
    expect(eventsOf(report, 'icon-dropped').map((event) => event.reason)).toEqual([
      'cell-occupied',
      'not-in-a-room',
    ])
    expect(project.mapsById.get(project.maps[0])!.icons.size).toBe(1)
  })

  it('never lets a file redefine World’s colours or Open’s', () => {
    const file = fileWith((f) => {
      f.project.areas = [
        { id: WORLD_AREA_ID, name: 'Hacked', cellColor: '#ff0000', wallColor: '#00ff00' },
      ]
      f.project.lockTypes = [{ id: OPEN_LOCK_ID, name: 'Hacked', color: '#ff0000' }]
    })
    const { project } = fromJSON(file)
    // The name is content and carries over; the immutable guarantees do not.
    expect(project.areas.get(WORLD_AREA_ID)!.name).toBe('Hacked')
    expect(project.areas.get(WORLD_AREA_ID)!.cellColor).toBeNull()
    expect(project.lockTypes.get(OPEN_LOCK_ID)!.color).toBeNull()
  })

  it('drops a line with fewer than two points', () => {
    const file = fileWith((f) => {
      f.project.maps[0].lines.push({ id: 'ln_1', color: '#fff', points: [[0, 0]] })
    })
    const { project } = fromJSON(file)
    expect(project.mapsById.get(project.maps[0])!.lines.size).toBe(0)
  })

  it('loads transitions after every map, so a cross-tab teleport resolves', () => {
    const { project, second } = populated()
    const file = toJSON(project)
    // Put the destination map first: the teleport under map 1 still has to
    // resolve against map 2's rooms.
    file.project.maps.reverse()
    const { project: reloaded } = fromJSON(file)
    expect(getFarEnd(reloaded.teleportFarEnds, second.id, '9,9')).toBeDefined()
  })
})

describe('open with confirmation', () => {
  function fileWithBadRoom() {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 2, 1))
    const file = toJSON(project)
    file.project.maps[0].rooms.push({
      id: 'room_intruder',
      areaId: WORLD_AREA_ID,
      cells: [
        [0, 0],
        [5, 5],
      ],
    })
    return file
  }

  it('does not ask when the file was clean', () => {
    const { project } = setup()
    const pending = openProject(toJSON(project))
    expect(pending.requiresConfirmation).toBe(false)
    expect(pending.accept()).toBeDefined()
  })

  it('asks before a repaired project becomes live, and reports what changed', () => {
    const pending = openProject(fileWithBadRoom())
    expect(pending.requiresConfirmation).toBe(true)
    expect(eventsOf(pending.report, 'cell-dropped')).toHaveLength(1)
  })

  it('declining simply drops it: nothing was mutated on the way', () => {
    const file = fileWithBadRoom()
    const before = JSON.stringify(file)
    const pending = openProject(file)
    expect(pending.requiresConfirmation).toBe(true)
    // Never call accept(). The parsed file is untouched, and no project exists.
    expect(JSON.stringify(file)).toBe(before)
  })

  it('accepting yields a project that satisfies the invariants', () => {
    const pending = openProject(fileWithBadRoom())
    const project = pending.accept()
    expect(checkInvariants(project)).toEqual([])
  })
})
