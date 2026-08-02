import { describe, it, expect } from 'vitest'
import { cellAt, grabBand, hitTest, type HitScene } from './hitTest'
import { createProject } from '@/core/factory'
import { Transaction } from '@/core/journal'
import { paintCells } from '@/core/ops/rooms'
import { placeIcon, createLine } from '@/core/ops/markup'
import { createFromBox, createTeleport } from '@/core/ops/doors'
import { addMap } from '@/core/ops/maps'
import { WORLD_AREA_ID } from '@/core/ids'
import { ok } from '@/core/testUtils'
import type { MapModel, ProjectModel } from '@/core/types'

const TILE = 32

// Zoom 1, no pan, so a screen point is a world coordinate times the tile size
// and the arithmetic in each test reads directly off the grid.
function sceneOf(project: ProjectModel, map: MapModel): HitScene {
  return { project, map, camera: { pan: { x: 0, y: 0 }, zoom: 1 }, tileSize: TILE }
}

// Screen point at a world coordinate: `at(1.5, 0.5)` is the centre of (1,0).
function at(x: number, y: number) {
  return { x: x * TILE, y: y * TILE }
}

function build(make: (tx: Transaction, project: ProjectModel, map: MapModel) => void) {
  const project = createProject({
    projectName: 'Fixture',
    firstMapName: 'Map 1',
    worldAreaName: 'World',
    openLockName: 'Open',
    lockedLockName: 'Locked',
  })
  const map = project.mapsById.get(project.maps[0])!
  const tx = new Transaction('build', { kind: 'map', mapId: map.id })
  make(tx, project, map)
  tx.commit()
  return { project, map, scene: sceneOf(project, map) }
}

describe('cellAt', () => {
  it('floors to the containing cell', () => {
    const camera = { pan: { x: 0, y: 0 }, zoom: 1 }
    expect(cellAt(at(0.1, 0.1), camera, TILE)).toBe('0,0')
    expect(cellAt(at(2.9, 1.9), camera, TILE)).toBe('2,1')
  })

  // The grid is unbounded, so there is no "off the grid": only cells with
  // nothing in them, and negative coordinates are ordinary.
  it('answers for empty and negative space', () => {
    const camera = { pan: { x: 0, y: 0 }, zoom: 1 }
    expect(cellAt(at(-0.5, -1.5), camera, TILE)).toBe('-1,-2')
  })

  it('follows the camera', () => {
    expect(cellAt(at(0.5, 0.5), { pan: { x: 10, y: 10 }, zoom: 1 }, TILE)).toBe('10,10')
    expect(cellAt({ x: TILE, y: TILE }, { pan: { x: 0, y: 0 }, zoom: 2 }, TILE)).toBe('0,0')
  })
})

describe('hitTest', () => {
  it('returns null on empty grid', () => {
    const { scene } = build(() => {})
    expect(hitTest(at(0.5, 0.5), scene)).toBeNull()
  })

  it('finds the room owning the cell', () => {
    const { scene, map } = build((tx, project, map) =>
      paintCells(tx, project, map, ['0,0', '1,0'], { areaId: WORLD_AREA_ID }),
    )
    const roomId = map.cellOwner.get('1,0')!
    expect(hitTest(at(1.5, 0.5), scene)).toEqual({ kind: 'room', id: roomId })
    // One cell over is outside the room.
    expect(hitTest(at(2.5, 0.5), scene)).toBeNull()
  })

  describe('the precedence table', () => {
    // Ties break by paint order, topmost first. An icon is painted over the
    // room it sits in, so it takes the cell.
    it('an icon beats the room under it', () => {
      const { scene } = build((tx, project, map) => {
        paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
        ok(placeIcon(tx, map, '0,0', 'save'))
      })
      expect(hitTest(at(0.5, 0.5), scene)?.kind).toBe('icon')
    })

    it('a line beats an icon it crosses', () => {
      const { scene } = build((tx, project, map) => {
        paintCells(tx, project, map, ['0,0', '1,0', '2,0'], { areaId: WORLD_AREA_ID })
        ok(placeIcon(tx, map, '1,0', 'save'))
        ok(
          createLine(tx, map, ['0,0', '1,0', '2,0'], {
            color: '#fff',
            arrowStart: false,
            arrowEnd: false,
          }),
        )
      })
      // Dead on the line, which runs through the cell centres.
      expect(hitTest(at(1.5, 0.5), scene)?.kind).toBe('line')
      // Off the line but still in the icon's cell: the icon again.
      expect(hitTest(at(1.5, 0.9), scene)?.kind).toBe('icon')
    })

    // The one thing paint order cannot settle: an edge door's band straddles
    // two cells that both have a full area claim, so without 1-D-before-2-D it
    // would be unreachable inside a room.
    it('an edge door beats the rooms either side of it', () => {
      const { scene, map } = build((tx, project, map) => {
        paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
        paintCells(tx, project, map, ['1,0'], { areaId: WORLD_AREA_ID })
        ok(createFromBox(tx, project, map, '0,0', '1,0'))
      })
      expect(map.transitionsAtEdge.size).toBeGreaterThan(0)

      // Right on the shared edge at x=1.
      expect(hitTest(at(1, 0.5), scene)?.kind).toBe('transition')
      // Well away from it, still inside the left room.
      expect(hitTest(at(0.2, 0.5), scene)?.kind).toBe('room')
    })

    it('a teleport endpoint beats the room but loses to an icon', () => {
      const { scene } = build((tx, project, map) => {
        paintCells(tx, project, map, ['0,0', '5,5'], { areaId: WORLD_AREA_ID })
        ok(
          createTeleport(
            tx,
            project,
            { mapId: map.id, cell: '0,0' },
            { mapId: map.id, cell: '5,5' },
          ),
        )
      })
      expect(hitTest(at(0.5, 0.5), scene)?.kind).toBe('transition')

      const withIcon = build((tx, project, map) => {
        paintCells(tx, project, map, ['0,0', '5,5'], { areaId: WORLD_AREA_ID })
        ok(
          createTeleport(
            tx,
            project,
            { mapId: map.id, cell: '0,0' },
            { mapId: map.id, cell: '5,5' },
          ),
        )
        ok(placeIcon(tx, map, '0,0', 'save'))
      })
      expect(hitTest(at(0.5, 0.5), withIcon.scene)?.kind).toBe('icon')
    })

    // A cross-tab teleport is editable from either tab: the far end is a real
    // target on the destination tab even though the transition is stored
    // under the origin map.
    it('hits a cross-tab teleport from the destination tab', () => {
      const project = createProject({
        projectName: 'Fixture',
        firstMapName: 'Surface',
        worldAreaName: 'World',
        openLockName: 'Open',
        lockedLockName: 'Locked',
      })
      const surface = project.mapsById.get(project.maps[0])!
      const tx = new Transaction('build', { kind: 'project' })
      const caves = addMap(tx, project, 'Caves')
      paintCells(tx, project, surface, ['0,0'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, caves, ['3,3'], { areaId: WORLD_AREA_ID })
      const teleport = ok(
        createTeleport(
          tx,
          project,
          { mapId: surface.id, cell: '0,0' },
          { mapId: caves.id, cell: '3,3' },
        ),
      )
      tx.commit()

      // Stored under Surface only...
      expect(surface.transitions.has(teleport.id)).toBe(true)
      expect(caves.transitions.has(teleport.id)).toBe(false)

      // ...but hit-testable from Caves, resolving to the same transition.
      const hit = hitTest(at(3.5, 3.5), sceneOf(project, caves))
      expect(hit).toEqual({ kind: 'transition', id: teleport.id })
    })
  })

  describe('the grab band', () => {
    it('is a capsule, not an infinite strip', () => {
      const { scene } = build((tx, project, map) => {
        paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
        paintCells(tx, project, map, ['1,0'], { areaId: WORLD_AREA_ID })
        ok(createFromBox(tx, project, map, '0,0', '1,0'))
      })
      // On the edge's line but three cells past its end: not a hit.
      expect(hitTest(at(1, 3.5), scene)).toBeNull()
    })

    // Derived from the drawn wall weight rather than chosen separately, so a
    // band can never end up narrower than the line it is supposed to grab.
    it('is never narrower than half the wall it grabs', () => {
      for (const zoom of [0.1, 0.5, 1, 2, 8]) {
        const band = grabBand({ camera: { pan: { x: 0, y: 0 }, zoom } })
        expect(band).toBeGreaterThan(0)
        expect(band).toBeLessThan(TILE / 2)
      }
    })

    // A screen-space band means the target is the same size under the pointer
    // at every zoom, which is the point of it being in screen px.
    it('holds its screen size as the view zooms', () => {
      const { project, map } = build((tx, project, map) => {
        paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
        paintCells(tx, project, map, ['1,0'], { areaId: WORLD_AREA_ID })
        ok(createFromBox(tx, project, map, '0,0', '1,0'))
      })

      for (const zoom of [0.5, 1, 4]) {
        const scene: HitScene = {
          project,
          map,
          camera: { pan: { x: 0, y: 0 }, zoom },
          tileSize: TILE,
        }
        const edgeX = 1 * TILE * zoom
        const band = grabBand(scene)
        // Just inside the band hits; just outside it does not.
        expect(hitTest({ x: edgeX + band - 0.5, y: 0.5 * TILE * zoom }, scene)?.kind).toBe(
          'transition',
        )
        expect(hitTest({ x: edgeX + band + 2, y: 0.5 * TILE * zoom }, scene)?.kind).not.toBe(
          'transition',
        )
      }
    })
  })
})
