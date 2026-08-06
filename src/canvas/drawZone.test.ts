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
    // room carries no wall and no handle, so it is not a target at all.
    it('resolves interior alongside the shared edge between two cells', () => {
      const { map } = withMap((tx, project, map) =>
        paintCells(tx, project, map, ['0,0', '1,0', '2,0'], { areaId: WORLD_AREA_ID }),
      )

      // One pixel inside the shared edge at x=32, half a cell down so nothing
      // else is in range.
      expect(resolveZone({ x: 33, y: 16 }, sceneFor(map)).kind).toBe('interior')
    })

    // The same rule where it can shadow: a non-candidate nearer than a real
    // target must not win on distance.
    //
    // At zoom 1 this corner belongs to the vertex, which outranks both. The
    // region where two perpendicular candidate edges are in band lies within
    // `band x sqrt(2)` of the lattice point they meet at, and the vertex
    // radius exceeds that from zoom 0.85 up. Below it the clamp on the vertex
    // radius bites first and the 1-D contest is reachable, which is where this
    // rule still decides anything.
    it('is not shadowed by the shared edge, where the vertex leaves room', () => {
      const { map } = withMap((tx, project, map) =>
        paintCells(tx, project, map, ['0,0', '1,0', '2,0'], { areaId: WORLD_AREA_ID }),
      )
      const scene = sceneFor(map, 0.5)
      const { band, vertexRadius } = zoneTolerances(scene)

      // 2.5px inside the shared edge at x=16, 3.5px under the north wall, and
      // 4.3px from the vertex at (16,0): inside both bands, outside the disc.
      const point = { x: 18.5, y: 3.5 }
      expect(Math.hypot(point.x - 16, point.y)).toBeGreaterThan(vertexRadius)
      expect(band).toBeGreaterThan(3.5)

      const zone = resolveZone(point, scene)
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

  describe('wall vertices', () => {
    it('resolves the lattice point where four room cells meet', () => {
      const { map } = room3x3()
      const zone = resolveZone(at(1, 1), sceneFor(map))

      expect(zone.kind).toBe('vertex')
      if (zone.kind !== 'vertex') throw new Error('unreachable')
      expect(zone.vertex).toEqual({ x: 1, y: 1 })
    })

    // The ring on the outer boundary. Vertex (1,0) sits in the middle of the
    // north run, and the edge running down from it into the room is drawable,
    // so it is a target: 0-D beats 1-D, and the run keeps the rest of its
    // length.
    it('resolves a vertex on the outer boundary, over the run it sits on', () => {
      const { map } = room3x3()
      const zone = resolveZone(at(1, 0), sceneFor(map))

      expect(zone.kind).toBe('vertex')
      if (zone.kind !== 'vertex') throw new Error('unreachable')
      expect(zone.vertex).toEqual({ x: 1, y: 0 })
    })

    it('leaves the middle of a run grabbable either side of the vertex', () => {
      const { map } = room3x3()
      // Half a cell along the north run from the vertex at (1,0).
      const zone = resolveZone({ x: 1.5 * TILE, y: 1 }, sceneFor(map))
      expect(zone.kind === 'edgeRun' && zone.run.side).toBe('N')
    })

    // A room one cell thick has no vertex with four cells around it, and the
    // old rule therefore made it undrawable. The two across its waist each
    // have one drawable edge: the edge between the two cells.
    //
    // Probed from just inside the room in both cases. The east one is a pixel
    // west of the lattice point rather than on it, because rule 1 bounds every
    // test by the pointer's own cell and the cell east of the room is empty.
    it('resolves the waist vertices of a room one cell thick', () => {
      const { map } = withMap((tx, project, map) =>
        paintCells(tx, project, map, ['0,0', '0,1'], { areaId: WORLD_AREA_ID }),
      )

      for (const [point, x] of [
        [{ x: 1, y: 1 * TILE }, 0],
        [{ x: 1 * TILE - 1, y: 1 * TILE }, 1],
      ] as const) {
        const zone = resolveZone(point, sceneFor(map))
        expect(zone.kind).toBe('vertex')
        if (zone.kind !== 'vertex') throw new Error('unreachable')
        expect(zone.vertex).toEqual({ x, y: 1 })
      }
    })

    // A corner touches one cell of the room, so no edge there can carry a
    // wall and there is nothing to aim at.
    it('ignores a corner of the room, which has no drawable edge', () => {
      const { map } = room3x3()
      const zone = resolveZone(at(0, 0), sceneFor(map))
      expect(zone.kind).not.toBe('vertex')
    })

    // The lattice point is not the unit: a drawable edge ending there is, and
    // an edge belongs to one room. Rule 1 makes the pointer's own cell decide
    // which room is asked, so the same point answers differently either side.
    it('ignores a lattice point whose only drawable edge belongs to the neighbour', () => {
      const { map } = withMap((tx, project, map) => {
        paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
        paintCells(tx, project, map, ['1,0', '1,1'], { areaId: WORLD_AREA_ID })
      })

      // (1,1) is the lone cell's south-east corner, with nothing to draw from.
      // For the room east of it, it is the south end of the edge across its
      // waist.
      expect(resolveZone({ x: 1 * TILE - 1, y: 1 * TILE - 1 }, sceneFor(map)).kind).not.toBe(
        'vertex',
      )
      expect(resolveZone({ x: 1 * TILE + 1, y: 1 * TILE - 1 }, sceneFor(map)).kind).toBe('vertex')
    })

    // Rule 1 decides the room, and the answer for a shared lattice point is
    // therefore whichever room the pointer is standing in. Both rooms own a
    // drawable edge ending at (2,1), so both offer it.
    it('answers a shared lattice point for the room the pointer is in', () => {
      const { map } = withMap((tx, project, map) => {
        paintCells(tx, project, map, ['0,0', '1,0', '0,1', '1,1'], { areaId: WORLD_AREA_ID })
        paintCells(tx, project, map, ['2,0', '2,1'], { areaId: WORLD_AREA_ID })
      })

      const west = resolveZone({ x: 2 * TILE - 1, y: 1 * TILE }, sceneFor(map))
      const east = resolveZone({ x: 2 * TILE + 1, y: 1 * TILE }, sceneFor(map))

      expect(west.kind).toBe('vertex')
      expect(east.kind).toBe('vertex')
      if (west.kind !== 'vertex' || east.kind !== 'vertex') throw new Error('unreachable')
      expect(west.vertex).toEqual(east.vertex)
      expect(west.roomId).not.toBe(east.roomId)
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
    // A 2x1 room with a wall on its shared edge, probed 3px from both wall and
    // north run, exactly equal in integer pixels.
    //
    // At zoom 0.5 for the same reason as the shared-edge rule above: an inner
    // wall's own endpoints are always wall vertices, so at zoom 1 the disc
    // covers every point equidistant from a wall and a run meeting there.
    it('beats a tied outer run, being drawn on top', () => {
      const { map } = withMap((tx, project, map) => {
        const room = paintCells(tx, project, map, ['0,0', '1,0'], { areaId: WORLD_AREA_ID })
        drawInnerWall(tx, map, room.id, edgeKey(1, 0, 'V'), 'solid')
      })
      const scene = sceneFor(map, 0.5)

      const point = { x: 13, y: 3 }
      expect(Math.hypot(point.x - 16, point.y)).toBeGreaterThan(zoneTolerances(scene).vertexRadius)

      const zone = resolveZone(point, scene)
      expect(zone.kind).toBe('innerWall')
      if (zone.kind !== 'innerWall') throw new Error('unreachable')
      expect(zone.edge).toBe(edgeKey(1, 0, 'V'))
    })

    // And at zoom 1 the same press is the vertex, which is the decided
    // precedence rather than an accident: an inner wall is aimed at along its
    // length, and its ends are where the next segment is started from.
    it('yields to the vertex at its own end', () => {
      const { map } = withMap((tx, project, map) => {
        const room = paintCells(tx, project, map, ['0,0', '1,0'], { areaId: WORLD_AREA_ID })
        drawInnerWall(tx, map, room.id, edgeKey(1, 0, 'V'), 'solid')
      })

      expect(resolveZone({ x: 30, y: 2 }, sceneFor(map)).kind).toBe('vertex')
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
