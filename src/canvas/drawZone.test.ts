import { describe, it, expect } from 'vitest'
import {
  MAX_BAND_FRACTION,
  resolveZone,
  zoneTolerances,
  VERTEX_RADIUS_FACTOR,
  type ZoneScene,
} from './drawZone'
import { grabBand } from './hitTest'
import { createProject } from '@/core/factory'
import { paintCells, drawInnerWall } from '@/core/ops/rooms'
import { Transaction } from '@/core/journal'
import { edgeKey } from '@/core/cell'
import { WORLD_AREA_ID } from '@/core/ids'
import { MIN_ZOOM } from '@/canvas/camera'
import type { MapModel, ProjectModel } from '@/core/types'
import type { Transaction as Tx } from '@/core/journal'

// One test per rule for how the pointer resolves to a target (empty, interior,
// edge run, vertex, inner wall).

const TILE = 32

function withMap(build: (tx: Tx, project: ProjectModel, map: MapModel) => void) {
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

function sceneFor(map: MapModel, zoom = 1): ZoneScene {
  return { map, camera: { pan: { x: 0, y: 0 }, zoom }, tileSize: TILE }
}

// Screen point for a world coordinate, at pan 0. Keeping the camera trivial
// means a failure is about the zone rules rather than about the projection,
// which `viewport.test.ts` already owns.
function at(x: number, y: number, zoom = 1) {
  return { x: x * TILE * zoom, y: y * TILE * zoom }
}

// A 3x3 room at (0,0)-(2,2): every side is a run of 3, and (1,1) and (2,2) are
// among its four interior vertices.
function room3x3() {
  return withMap((tx, project, map) =>
    paintCells(tx, project, map, ['0,0', '1,0', '2,0', '0,1', '1,1', '2,1', '0,2', '1,2', '2,2'], {
      areaId: WORLD_AREA_ID,
    }),
  )
}

describe('resolveZone', () => {
  describe('empty grid', () => {
    it('answers rather than returning nothing; the grid is unbounded', () => {
      const { map } = room3x3()
      const zone = resolveZone(at(8.5, 8.5), sceneFor(map))
      expect(zone).toEqual({ kind: 'empty', cell: '8,8' })
    })

    // A grab band straddles a wall, so half lies outside. Letting that half
    // resolve to the room would make painting flush against it trigger a resize.
    it('stays empty just outside a wall, where the band still reaches', () => {
      const { map } = room3x3()
      const band = zoneTolerances(sceneFor(map)).band
      expect(band).toBeGreaterThan(1)

      // A pixel outside the room's west wall, well within the band.
      const zone = resolveZone({ x: -1, y: 1.5 * TILE }, sceneFor(map))
      expect(zone.kind).toBe('empty')
    })
  })

  describe('interior', () => {
    it('resolves the middle of a cell', () => {
      const { map } = room3x3()
      const zone = resolveZone(at(1.5, 1.5), sceneFor(map))
      expect(zone.kind).toBe('interior')
      expect(zone.cell).toBe('1,1')
    })

    // A length-1 edge has no handle; grow by painting instead.
    it('resolves an outer edge whose run is a single cell', () => {
      // A plus shape: the tip cell (1,0) has a north face of length 1.
      const { map } = withMap((tx, project, map) =>
        paintCells(tx, project, map, ['1,0', '0,1', '1,1', '2,1', '1,2'], {
          areaId: WORLD_AREA_ID,
        }),
      )

      const zone = resolveZone({ x: 1.5 * TILE, y: 1 }, sceneFor(map))
      expect(zone.kind).toBe('interior')
      expect(zone.cell).toBe('1,0')
    })
  })

  describe('edge runs', () => {
    it('resolves an outer edge belonging to a run of 2 or more', () => {
      const { map } = room3x3()
      // Just inside the north wall of cell (1,0).
      const zone = resolveZone({ x: 1.5 * TILE, y: 1 }, sceneFor(map))

      expect(zone.kind).toBe('edgeRun')
      if (zone.kind !== 'edgeRun') throw new Error('unreachable')
      expect(zone.run.side).toBe('N')
      expect(zone.run.cells).toEqual(['0,0', '1,0', '2,0'])
    })

    // The whole run comes back, not just the edge under the pointer.
    it('hands back the whole grabbed run', () => {
      const { map } = room3x3()
      const zone = resolveZone({ x: 0.5 * TILE, y: 1 }, sceneFor(map))

      if (zone.kind !== 'edgeRun') throw new Error('expected an edge run')
      expect(zone.run.cells).toHaveLength(3)
    })

    // Only candidate edges compete. The edge between two cells of the same
    // room carries no wall and no handle, so it must not shadow a real target
    // by being nearer.
    it('is not shadowed by the shared edge between two cells of the room', () => {
      const { map } = withMap((tx, project, map) =>
        paintCells(tx, project, map, ['0,0', '1,0', '2,0'], { areaId: WORLD_AREA_ID }),
      )

      // One pixel inside the shared edge at x=32, four pixels under the north
      // wall: a run of 3 is the only grabbable target.
      const zone = resolveZone({ x: 33, y: 4 }, sceneFor(map))

      expect(zone.kind).toBe('edgeRun')
      if (zone.kind !== 'edgeRun') throw new Error('unreachable')
      expect(zone.run.side).toBe('N')
    })

    it('picks the nearer of two candidate runs near a corner', () => {
      const { map } = room3x3()

      // Two pixels under the north wall, ten inside the west wall.
      const north = resolveZone({ x: 10, y: 2 }, sceneFor(map))
      expect(north.kind === 'edgeRun' && north.run.side).toBe('N')

      // The mirror image.
      const west = resolveZone({ x: 2, y: 10 }, sceneFor(map))
      expect(west.kind === 'edgeRun' && west.run.side).toBe('W')
    })

    it('resolves each of the four sides', () => {
      const { map } = room3x3()
      const sides = [
        resolveZone({ x: 1.5 * TILE, y: 1 }, sceneFor(map)),
        resolveZone({ x: 3 * TILE - 1, y: 1.5 * TILE }, sceneFor(map)),
        resolveZone({ x: 1.5 * TILE, y: 3 * TILE - 1 }, sceneFor(map)),
        resolveZone({ x: 1, y: 1.5 * TILE }, sceneFor(map)),
      ]
      expect(sides.map((zone) => (zone.kind === 'edgeRun' ? zone.run.side : zone.kind))).toEqual([
        'N',
        'E',
        'S',
        'W',
      ])
    })
  })

  describe('interior vertices', () => {
    it('resolves the lattice point where four room cells meet', () => {
      const { map } = room3x3()
      const zone = resolveZone(at(1, 1), sceneFor(map))

      expect(zone.kind).toBe('vertex')
      if (zone.kind !== 'vertex') throw new Error('unreachable')
      expect(zone.vertex).toEqual({ x: 1, y: 1 })
    })

    // A vertex is interior when all four cells meeting at it belong to the
    // room. A corner is not one.
    it('ignores a corner of the room, which is not interior', () => {
      const { map } = room3x3()
      const zone = resolveZone(at(0, 0), sceneFor(map))
      expect(zone.kind).not.toBe('vertex')
    })

    it('ignores a vertex on the boundary between two rooms', () => {
      const { map } = withMap((tx, project, map) => {
        paintCells(tx, project, map, ['0,0', '1,0', '0,1', '1,1'], { areaId: WORLD_AREA_ID })
        paintCells(tx, project, map, ['2,0', '2,1'], { areaId: WORLD_AREA_ID })
      })

      // (2,1) is a corner of the first room, not an interior vertex of it.
      const zone = resolveZone({ x: 2 * TILE - 1, y: 1 * TILE }, sceneFor(map))
      expect(zone.kind).not.toBe('vertex')
    })

    // 0-D beats 1-D: vertices beat walls. An inner wall runs between interior
    // vertices and is in band wherever its end vertex is. Without this order,
    // the vertex would be unreachable where walls meet.
    it('beats an inner wall that meets the same vertex', () => {
      const { map } = withMap((tx, project, map) => {
        const room = paintCells(
          tx,
          project,
          map,
          ['0,0', '1,0', '2,0', '0,1', '1,1', '2,1', '0,2', '1,2', '2,2'],
          { areaId: WORLD_AREA_ID },
        )
        // Runs from vertex (1,1) down to vertex (1,2).
        drawInnerWall(tx, map, room.id, edgeKey(1, 1, 'V'), 'solid')
      })

      // One pixel off the wall, two below the vertex it starts at: both are
      // comfortably within their tolerances, and the vertex takes it.
      expect(resolveZone({ x: 33, y: 34 }, sceneFor(map)).kind).toBe('vertex')

      // The other half of the assertion, and what stops this going vacuous: the
      // same wall, the same one-pixel offset, but far enough down that neither
      // end vertex is in range. Now it resolves as the wall.
      expect(resolveZone({ x: 33, y: 48 }, sceneFor(map)).kind).toBe('innerWall')
    })
  })

  describe('inner walls', () => {
    function withInnerWall() {
      return withMap((tx, project, map) => {
        const room = paintCells(
          tx,
          project,
          map,
          ['0,0', '1,0', '2,0', '0,1', '1,1', '2,1', '0,2', '1,2', '2,2'],
          { areaId: WORLD_AREA_ID },
        )
        // Vertical edge on the west side of (1,1), strictly interior.
        drawInnerWall(tx, map, room.id, edgeKey(1, 1, 'V'), 'solid')
      })
    }

    it('resolves a drawn segment, and hands back the edge', () => {
      const { map } = withInnerWall()
      const zone = resolveZone({ x: 1 * TILE + 1, y: 1.5 * TILE }, sceneFor(map))

      expect(zone.kind).toBe('innerWall')
      if (zone.kind !== 'innerWall') throw new Error('unreachable')
      expect(zone.edge).toBe(edgeKey(1, 1, 'V'))
    })

    // The same edge is reachable from either of the two cells it separates,
    // because each cell tests its own four edges and the edge key is canonical.
    it('resolves from either side of the segment', () => {
      const { map } = withInnerWall()
      const fromWest = resolveZone({ x: 1 * TILE - 1, y: 1.5 * TILE }, sceneFor(map))
      const fromEast = resolveZone({ x: 1 * TILE + 1, y: 1.5 * TILE }, sceneFor(map))

      expect(fromWest.kind).toBe('innerWall')
      expect(fromEast.kind).toBe('innerWall')
      expect(fromWest.cell).toBe('0,1')
      expect(fromEast.cell).toBe('1,1')
    })

    // Ties go to the inner wall: inner walls are drawn on top and hit first.
    // A 2x1 room with a wall on its shared edge, probed 2px from both wall and
    // north run, exactly equal in integer pixels.
    it('beats a tied outer run, being drawn on top', () => {
      const { map } = withMap((tx, project, map) => {
        const room = paintCells(tx, project, map, ['0,0', '1,0'], { areaId: WORLD_AREA_ID })
        drawInnerWall(tx, map, room.id, edgeKey(1, 0, 'V'), 'solid')
      })

      const zone = resolveZone({ x: 30, y: 2 }, sceneFor(map))

      expect(zone.kind).toBe('innerWall')
      if (zone.kind !== 'innerWall') throw new Error('unreachable')
      expect(zone.edge).toBe(edgeKey(1, 0, 'V'))
    })

    it('is interior again once the segment is gone', () => {
      const { map } = room3x3()
      const zone = resolveZone({ x: 1 * TILE + 1, y: 1.5 * TILE }, sceneFor(map))
      expect(zone.kind).toBe('interior')
    })
  })

  describe('tolerances', () => {
    it('takes the edge band from hit-testing rather than inventing one', () => {
      const scene = sceneFor(room3x3().map, 4)
      expect(zoneTolerances(scene).band).toBe(grabBand(scene))
    })

    it('gives a vertex more room than a wall, being a point target', () => {
      const scene = sceneFor(room3x3().map, 4)
      const { band, vertexRadius } = zoneTolerances(scene)
      expect(vertexRadius).toBeCloseTo(band * VERTEX_RADIUS_FACTOR)
      expect(vertexRadius).toBeGreaterThan(band)
    })

    // The load-bearing clamp. At MIN_ZOOM a cell is 3.2px and the unclamped
    // band is 4.5px, so without this every point in every cell is within a band
    // of some edge. `interior` never resolves, so no active room, no painting,
    // no growing.
    it('never lets the band swallow the cell when zoomed out', () => {
      const scene = sceneFor(room3x3().map, MIN_ZOOM)
      const cellPx = TILE * MIN_ZOOM

      expect(grabBand(scene)).toBeGreaterThan(cellPx / 2)
      expect(zoneTolerances(scene).band).toBeLessThanOrEqual(cellPx * MAX_BAND_FRACTION)
    })

    it('still resolves an interior at the minimum zoom', () => {
      const { map } = room3x3()
      const scene: ZoneScene = {
        map,
        camera: { pan: { x: 0, y: 0 }, zoom: MIN_ZOOM },
        tileSize: TILE,
      }

      const centre = { x: 1.5 * TILE * MIN_ZOOM, y: 1.5 * TILE * MIN_ZOOM }
      expect(resolveZone(centre, scene).kind).toBe('interior')
    })

    // The counterpart: zoomed in, the tolerances are the real ones, so the
    // clamp is genuinely a low-zoom safeguard and not the normal path.
    it('leaves the tolerances alone at ordinary zooms', () => {
      const scene = sceneFor(room3x3().map, 1)
      expect(zoneTolerances(scene).band).toBe(grabBand(scene))
    })
  })

  // Every zone resolves in screen pixels at any zoom.
  describe('at every zoom', () => {
    it.each([MIN_ZOOM, 0.5, 1, 2, 8])('resolves interior and edge run at zoom %s', (zoom) => {
      const { map } = room3x3()
      const scene: ZoneScene = { map, camera: { pan: { x: 0, y: 0 }, zoom }, tileSize: TILE }
      const cellPx = TILE * zoom

      expect(resolveZone({ x: 1.5 * cellPx, y: 1.5 * cellPx }, scene).kind).toBe('interior')
      // A pixel inside the north wall is on the run at every zoom, because the
      // band is measured in screen pixels.
      expect(resolveZone({ x: 1.5 * cellPx, y: 0.5 }, scene).kind).toBe('edgeRun')
    })
  })

  // The camera is not the identity in the app, and a resolver that forgot it
  // would work perfectly in every test that pans to zero.
  it('accounts for the pan', () => {
    const { map } = room3x3()
    const scene: ZoneScene = { map, camera: { pan: { x: -5, y: -3 }, zoom: 1 }, tileSize: TILE }

    const zone = resolveZone({ x: (1.5 + 5) * TILE, y: (1.5 + 3) * TILE }, scene)
    expect(zone.kind).toBe('interior')
    expect(zone.cell).toBe('1,1')
  })
})
