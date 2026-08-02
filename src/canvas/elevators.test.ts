import { describe, it, expect } from 'vitest'
import { elevatorShafts } from './elevators'
import { createProject } from '@/core/factory'
import { Transaction } from '@/core/journal'
import { createFromBox } from '@/core/ops/doors'
import { paintCells } from '@/core/ops/rooms'
import { edgeOfCell } from '@/core/cell'
import { ok } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { MapModel, ProjectModel } from '@/core/types'

function withMap(build: (tx: Transaction, project: ProjectModel, map: MapModel) => void) {
  const project = createProject({
    projectName: 'Fixture',
    firstMapName: 'Map 1',
    worldAreaName: 'World',
    openLockName: 'Open',
    lockedLockName: 'Locked',
  })
  const map = project.mapsById.get(project.maps[0])!
  const tx = new Transaction('build', { kind: 'map', mapId: map.id })
  build(tx, project, map)
  tx.commit()
  return { project, map }
}

// Two rooms on row 0 with a three-cell gap between them, and an elevator
// across it: the horizontal case, built the way a box drag would build it.
function acrossAGap(build?: (tx: Transaction, project: ProjectModel, map: MapModel) => void) {
  return withMap((tx, project, map) => {
    paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
    paintCells(tx, project, map, ['4,0'], { areaId: WORLD_AREA_ID })
    ok(createFromBox(tx, project, map, '0,0', '4,0'))
    build?.(tx, project, map)
  })
}

describe('elevatorShafts', () => {
  it('is empty for a map with no elevators', () => {
    const { map } = withMap((tx, project, map) =>
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID }),
    )
    expect(elevatorShafts(map)).toEqual([])
  })

  it('spans the gap cells between the endpoints, excluding both rooms', () => {
    const { map } = acrossAGap()

    const shafts = elevatorShafts(map)
    expect(shafts).toHaveLength(1)
    expect(shafts[0].axis).toBe('h')
    // Strictly between: the endpoint cells are inside their rooms and are drawn
    // by the room, not the shaft.
    expect(shafts[0].openCells).toEqual(['1,0', '2,0', '3,0'])
  })

  it('reports the facing edges, A first', () => {
    const { map } = acrossAGap()

    // Where the shaft meets each room: the east side of the left room, the west
    // side of the right one.
    expect(elevatorShafts(map)[0].ends).toEqual([edgeOfCell('0,0', 'E'), edgeOfCell('4,0', 'W')])
  })

  it('walks the gap A to B, so the direction survives a right-to-left drag', () => {
    const { map } = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['3,0'], { areaId: WORLD_AREA_ID })
      // Dragged from the right-hand room, so A is at x=3 and the shaft runs west.
      ok(createFromBox(tx, project, map, '3,0', '0,0'))
    })

    expect(elevatorShafts(map)[0].openCells).toEqual(['2,0', '1,0'])
  })

  it('runs down a column for a vertical elevator', () => {
    const { map } = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['0,3'], { areaId: WORLD_AREA_ID })
      ok(createFromBox(tx, project, map, '0,0', '0,3'))
    })

    const shaft = elevatorShafts(map)[0]
    expect(shaft.axis).toBe('v')
    expect(shaft.openCells).toEqual(['0,1', '0,2'])
    expect(shaft.ends).toEqual([edgeOfCell('0,0', 'S'), edgeOfCell('0,3', 'N')])
  })

  // A third room in the gap is explicitly legal (`isGapIntact` allows it), so
  // the shaft renders behind room cells and only draws in empty cells: this is
  // the expected case, not an oddity.
  it('leaves out a cell a third room occupies', () => {
    const { map } = acrossAGap((tx, project, map) => {
      paintCells(tx, project, map, ['2,0'], { areaId: WORLD_AREA_ID })
    })

    // The elevator is still valid, and the shaft is now two pieces with the room
    // showing through between them.
    expect(map.transitions.size).toBe(1)
    expect(elevatorShafts(map)[0].openCells).toEqual(['1,0', '3,0'])
  })

  // The degenerate end of the same rule: nothing to draw, and still a live,
  // valid elevator. A renderer that assumed at least one cell (to place the
  // one-way arrowhead, say) would fail here rather than on a normal map.
  it('draws no shaft at all when rooms fill the whole gap', () => {
    const { map } = acrossAGap((tx, project, map) => {
      paintCells(tx, project, map, ['1,0'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['2,0'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['3,0'], { areaId: WORLD_AREA_ID })
    })

    expect(map.transitions.size).toBe(1)
    expect(elevatorShafts(map)[0].openCells).toEqual([])
  })

  it('ignores doors and teleports', () => {
    const { map } = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['1,0'], { areaId: WORLD_AREA_ID })
      ok(createFromBox(tx, project, map, '0,0', '1,0'))
    })

    expect(map.transitions.size).toBe(1)
    expect(elevatorShafts(map)).toEqual([])
  })

  it('carries the per-end locks and the one-way flag', () => {
    const { map } = acrossAGap()
    const shaft = elevatorShafts(map)[0]

    expect(shaft.locks).toEqual({ a: 'open', b: 'open' })
    expect(shaft.oneWay).toBe(false)
  })
})
