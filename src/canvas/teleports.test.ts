import { describe, it, expect } from 'vitest'
import { cellCentre, firstLetter, teleportScene } from './teleports'
import { createProject } from '@/core/factory'
import { Transaction } from '@/core/journal'
import { createTeleport, setDirection } from '@/core/ops/doors'
import { addMap, renameMap } from '@/core/ops/maps'
import { paintCells } from '@/core/ops/rooms'
import { ok } from '@/core/testUtils'
import { OPEN_LOCK_ID, WORLD_AREA_ID } from '@/core/ids'
import type { MapId } from '@/core/ids'
import type { ProjectModel } from '@/core/types'

// Two maps, four rooms: Surface has rooms at (0,0) and (5,5); Caves has one at
// (2,2). Enough for a same-map teleport, a cross-map one, and a destination tab
// whose name has a first letter worth reading.
function twoMaps(build: (tx: Transaction, project: ProjectModel, ids: [MapId, MapId]) => void) {
  const project = createProject({
    projectName: 'Fixture',
    firstMapName: 'Surface',
    worldAreaName: 'World',
    openLockName: 'Open',
    lockedLockName: 'Locked',
  })
  const surfaceId = project.maps[0]
  const tx = new Transaction('build', { kind: 'project' })
  const caves = addMap(tx, project, 'Caves')
  const surface = project.mapsById.get(surfaceId)!

  paintCells(tx, project, surface, ['0,0'], { areaId: WORLD_AREA_ID })
  paintCells(tx, project, surface, ['5,5'], { areaId: WORLD_AREA_ID })
  paintCells(tx, project, caves, ['2,2'], { areaId: WORLD_AREA_ID })

  build(tx, project, [surfaceId, caves.id])
  tx.commit()
  return { project, surfaceId, cavesId: caves.id }
}

describe('teleportScene', () => {
  it('is empty for a map with no teleports', () => {
    const { project, surfaceId } = twoMaps(() => {})
    expect(teleportScene(project, surfaceId)).toEqual({ ends: [], lines: [] })
  })

  it('reports both ends and one line for a same-map teleport', () => {
    const { project, surfaceId } = twoMaps((tx, project, [surface]) => {
      ok(
        createTeleport(
          tx,
          project,
          { mapId: surface, cell: '0,0' },
          { mapId: surface, cell: '5,5' },
        ),
      )
    })

    const scene = teleportScene(project, surfaceId)
    expect(scene.ends.map((end) => end.cell).sort()).toEqual(['0,0', '5,5'])
    expect(scene.lines).toHaveLength(1)
    expect([scene.lines[0].from, scene.lines[0].to]).toEqual(['0,0', '5,5'])
    // Nothing to label: the other end is visible at the far end of the line.
    expect(scene.ends.every((end) => end.leadsTo === null)).toBe(true)
  })

  // The reconciliation that makes a cross-tab teleport work at all: it is stored
  // once, under Surface, and Caves still has to draw a marker.
  it('gives both tabs an end for a cross-map teleport, from one stored object', () => {
    const { project, surfaceId, cavesId } = twoMaps((tx, project, [surface, caves]) => {
      ok(
        createTeleport(tx, project, { mapId: surface, cell: '0,0' }, { mapId: caves, cell: '2,2' }),
      )
    })

    const surface = teleportScene(project, surfaceId)
    const caves = teleportScene(project, cavesId)

    expect(surface.ends).toHaveLength(1)
    expect(surface.ends[0].cell).toBe('0,0')
    expect(caves.ends).toHaveLength(1)
    expect(caves.ends[0].cell).toBe('2,2')
    // One object, so one id: the far end is the same teleport, not a copy.
    expect(caves.ends[0].id).toBe(surface.ends[0].id)
    // No line on either tab: there is no second point on this map to draw to.
    expect(surface.lines).toEqual([])
    expect(caves.lines).toEqual([])
  })

  // Each end names where it goes, not where it is. The origin tab needs the
  // label as much as the destination does: without it, a cross-tab teleport is
  // indistinguishable from a same-map one whose line is switched off.
  it('labels each cross-map end with the other tab’s first letter', () => {
    const { project, surfaceId, cavesId } = twoMaps((tx, project, [surface, caves]) => {
      ok(
        createTeleport(tx, project, { mapId: surface, cell: '0,0' }, { mapId: caves, cell: '2,2' }),
      )
    })

    const fromSurface = teleportScene(project, surfaceId).ends[0]
    const fromCaves = teleportScene(project, cavesId).ends[0]

    expect(fromSurface.leadsTo).toEqual({ mapId: cavesId, cell: '2,2', label: 'C' })
    expect(fromCaves.leadsTo).toEqual({ mapId: surfaceId, cell: '0,0', label: 'S' })
  })

  it('follows a rename, because the label is derived and never stored', () => {
    const { project, surfaceId, cavesId } = twoMaps((tx, project, [surface, caves]) => {
      ok(
        createTeleport(tx, project, { mapId: surface, cell: '0,0' }, { mapId: caves, cell: '2,2' }),
      )
      renameMap(tx, project, caves, 'Norfair')
    })

    expect(teleportScene(project, surfaceId).ends[0].leadsTo?.label).toBe('N')
    expect(teleportScene(project, cavesId).ends[0].leadsTo?.label).toBe('S')
  })

  // B -> A on a cross-tab teleport swaps the endpoints, which re-homes the
  // object to the other map, so the tab that stores it and the tab that
  // derives it trade places. Both tabs must still show one end each, or the
  // direction selector would make a teleport vanish from one side.
  it('survives the endpoints being swapped, which changes which map stores it', () => {
    const { project, surfaceId, cavesId } = twoMaps((tx, project, [surface, caves]) => {
      const teleport = ok(
        createTeleport(tx, project, { mapId: surface, cell: '0,0' }, { mapId: caves, cell: '2,2' }),
      )
      setDirection(tx, project, project.mapsById.get(surface)!, teleport.id, 'bToA')
    })

    // Stored under Caves now.
    expect(project.mapsById.get(cavesId)!.transitions.size).toBe(1)
    expect(project.mapsById.get(surfaceId)!.transitions.size).toBe(0)

    const fromSurface = teleportScene(project, surfaceId)
    const fromCaves = teleportScene(project, cavesId)
    expect(fromSurface.ends.map((end) => end.cell)).toEqual(['0,0'])
    expect(fromCaves.ends.map((end) => end.cell)).toEqual(['2,2'])
    expect(fromSurface.ends[0].leadsTo?.mapId).toBe(cavesId)
    expect(fromCaves.ends[0].leadsTo?.mapId).toBe(surfaceId)
  })

  it('carries the lock facing each end’s own room', () => {
    const { project, surfaceId } = twoMaps((tx, project, [surface]) => {
      ok(
        createTeleport(
          tx,
          project,
          { mapId: surface, cell: '0,0' },
          { mapId: surface, cell: '5,5' },
        ),
      )
    })

    expect(teleportScene(project, surfaceId).ends.map((end) => end.lock)).toEqual([
      OPEN_LOCK_ID,
      OPEN_LOCK_ID,
    ])
  })

  it('answers with an empty scene for a map that is not in the project', () => {
    const { project } = twoMaps(() => {})
    expect(teleportScene(project, 'map_gone' as MapId)).toEqual({ ends: [], lines: [] })
  })
})

describe('firstLetter', () => {
  it('takes the first letter, upper-cased', () => {
    expect(firstLetter('Caves')).toBe('C')
    expect(firstLetter('norfair')).toBe('N')
  })

  // A tab name is a text input, so all three of these are reachable and none of
  // them should produce a blank marker.
  it('skips leading space, keeps an astral character whole, and never draws blank', () => {
    expect(firstLetter('  Brinstar')).toBe('B')
    expect(firstLetter('🌋 Magmoor')).toBe('🌋')
    expect(firstLetter('   ')).toBe('?')
  })
})

describe('cellCentre', () => {
  it('is the middle of the cell, including for negative coordinates', () => {
    expect(cellCentre('3,4')).toEqual({ x: 3.5, y: 4.5 })
    expect(cellCentre('-2,-1')).toEqual({ x: -1.5, y: -0.5 })
  })
})
