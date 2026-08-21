import { describe, it, expect } from 'vitest'
import { selectionBounds } from './selectionBounds'
import { createProject } from '@/core/factory'
import { Transaction } from '@/core/journal'
import { addMap } from '@/core/ops/maps'
import { createNewArea } from '@/core/ops/project'
import { assignRoomArea, paintCells } from '@/core/ops/rooms'
import { createFromBox, createTeleport } from '@/core/ops/doors'
import { createLine, placeIcon } from '@/core/ops/markup'
import { WORLD_AREA_ID } from '@/core/ids'
import { wasRefused } from '@/core/outcome'
import type { CellKey } from '@/core/cell'
import type { MapModel, ObjectRef, ProjectModel } from '@/core/types'

// One describe per ObjectRef kind, because the kinds are the cross product:
// what each contributes is the whole of what this function decides.

const TEST_SEED = {
  projectName: 'Test',
  firstMapName: 'Map 1',
  worldAreaName: 'World',
  openLockName: 'Open',
  lockedLockName: 'Locked',
}

function setup() {
  const project = createProject(TEST_SEED)
  const map = project.mapsById.get(project.maps[0])!
  return { project, map }
}

function edit<T>(map: MapModel | null, body: (tx: Transaction) => T): T {
  return body(new Transaction('test', map ? { kind: 'map', mapId: map.id } : { kind: 'project' }))
}

function paint(project: ProjectModel, map: MapModel, cells: string[]) {
  return edit(map, (tx) =>
    paintCells(tx, project, map, cells as CellKey[], { areaId: WORLD_AREA_ID }),
  )
}

describe('a cell ref', () => {
  it('is its own one-cell box', () => {
    const { map } = setup()
    expect(selectionBounds([{ kind: 'cell', id: '3,4' as CellKey }], map)).toEqual({
      minCol: 3,
      minRow: 4,
      maxCol: 3,
      maxRow: 4,
    })
  })
})

describe('a room ref', () => {
  it('covers every cell the room owns', () => {
    const { project, map } = setup()
    paint(project, map, ['2,2', '3,2', '2,3'])
    const roomId = [...map.rooms.keys()][0]

    expect(selectionBounds([{ kind: 'room', id: roomId }], map)).toEqual({
      minCol: 2,
      minRow: 2,
      maxCol: 3,
      maxRow: 3,
    })
  })

  it('contributes nothing when the room is not on this map', () => {
    const { project, map } = setup()
    const other = edit(null, (tx) => addMap(tx, project, 'Map 2'))
    paint(project, map, ['0,0'])
    const roomId = [...map.rooms.keys()][0]

    expect(selectionBounds([{ kind: 'room', id: roomId }], other)).toBeNull()
  })
})

describe('an area ref', () => {
  it('covers its rooms on this map, through the model derivation', () => {
    const { project, map } = setup()
    const area = edit(null, (tx) => createNewArea(tx, project, 'Crateria', '#446688', '#223344'))
    paint(project, map, ['5,5', '6,5'])
    const roomId = [...map.rooms.keys()][0]
    edit(map, (tx) => assignRoomArea(tx, map, roomId, area.id))

    expect(selectionBounds([{ kind: 'area', id: area.id }], map)).toEqual({
      minCol: 5,
      minRow: 5,
      maxCol: 6,
      maxRow: 5,
    })
  })

  it('contributes nothing when it has no rooms here', () => {
    const { project, map } = setup()
    const area = edit(null, (tx) => createNewArea(tx, project, 'Empty', '#446688', '#223344'))
    expect(selectionBounds([{ kind: 'area', id: area.id }], map)).toBeNull()
  })
})

describe('an icon ref', () => {
  it('is the cell it sits in', () => {
    const { project, map } = setup()
    paint(project, map, ['4,7'])
    const icon = edit(map, (tx) =>
      placeIcon(tx, map, '4,7' as CellKey, 'save', { plateColor: '#111', glyphColor: '#eee' }),
    )
    expect(wasRefused(icon)).toBe(false)
    if (wasRefused(icon)) return

    expect(selectionBounds([{ kind: 'icon', id: icon.id }], map)).toEqual({
      minCol: 4,
      minRow: 7,
      maxCol: 4,
      maxRow: 7,
    })
  })
})

describe('a line ref', () => {
  it('covers every point, including the ones outside any room', () => {
    const { map } = setup()
    const line = edit(map, (tx) =>
      createLine(tx, map, ['1,1', '2,1', '3,1'] as CellKey[], {
        color: '#fff',
        arrowStart: false,
        arrowEnd: true,
      }),
    )
    expect(wasRefused(line)).toBe(false)
    if (wasRefused(line)) return

    expect(selectionBounds([{ kind: 'line', id: line.id }], map)).toEqual({
      minCol: 1,
      minRow: 1,
      maxCol: 3,
      maxRow: 1,
    })
  })
})

describe('a transition ref', () => {
  it('covers both cells either side of an edge door', () => {
    const { project, map } = setup()
    // Two rooms, painted separately: an edge door joins a pair, so one room
    // spanning both cells has nothing to connect.
    paint(project, map, ['0,0'])
    paint(project, map, ['1,0'])
    const made = edit(map, (tx) =>
      createFromBox(tx, project, map, '0,0' as CellKey, '1,0' as CellKey),
    )
    expect(wasRefused(made)).toBe(false)
    if (wasRefused(made)) return

    const box = selectionBounds([{ kind: 'transition', id: made[0].id }], map)
    // The door sits on the edge between them and belongs to neither more than
    // the other, so both count.
    expect(box).toEqual({ minCol: 0, minRow: 0, maxCol: 1, maxRow: 0 })
  })

  it('counts only the end of a cross-tab teleport that is on this map', () => {
    const { project, map } = setup()
    const other = edit(null, (tx) => addMap(tx, project, 'Map 2'))
    const otherMap = project.mapsById.get(other.id)!
    paint(project, map, ['2,2'])
    paint(project, otherMap, ['90,90'])

    const made = edit(map, (tx) =>
      createTeleport(
        tx,
        project,
        { mapId: map.id, cell: '2,2' as CellKey },
        { mapId: other.id, cell: '90,90' as CellKey },
      ),
    )
    expect(wasRefused(made)).toBe(false)
    if (wasRefused(made)) return

    const ref: ObjectRef = { kind: 'transition', id: made.id }
    // The far end's coordinates name nothing on this map, so the box must not
    // stretch to reach them.
    expect(selectionBounds([ref], map)).toEqual({ minCol: 2, minRow: 2, maxCol: 2, maxRow: 2 })
  })
})

describe('a mixed selection', () => {
  it('is the union of everything it can see here', () => {
    const { project, map } = setup()
    paint(project, map, ['0,0'])
    const roomId = [...map.rooms.keys()][0]

    expect(
      selectionBounds(
        [
          { kind: 'room', id: roomId },
          { kind: 'cell', id: '9,4' as CellKey },
        ],
        map,
      ),
    ).toEqual({ minCol: 0, minRow: 0, maxCol: 9, maxRow: 4 })
  })

  it('is null when nothing in it is on this map', () => {
    const { map } = setup()
    expect(selectionBounds([], map)).toBeNull()
  })
})
