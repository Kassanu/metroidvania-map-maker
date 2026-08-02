import { describe, it, expect } from 'vitest'
import { WORLD_AREA_ID, newAreaId } from '../ids'
import { createArea } from '../factory'
import { putArea } from '../primitives'
import { farEndCount } from '../farEnds'
import { makeRoom, ok, refusal, rect, setup, sorted, TEST_ICON_COLORS, tx } from '../testUtils'
import {
  addMap,
  deleteMap,
  duplicateMap,
  linksDroppedByDuplicate,
  mapDeletionImpact,
  renameMap,
  reorderMap,
} from './maps'
import { createTeleport } from './doors'
import { paintCells } from './rooms'
import { placeIcon } from './markup'
import {
  createNewArea,
  createNewLockType,
  deleteArea,
  deleteLockType,
  transitionsUsingLockType,
  recolorArea,
  renameArea,
  roomsInArea,
  updateLockType,
} from './project'
import { OPEN_LOCK_ID } from '../ids'

describe('maps', () => {
  it('adds and reorders tabs', () => {
    const { project } = setup()
    const transaction = tx()
    const second = addMap(transaction, project, 'Map 2')
    const third = addMap(transaction, project, 'Map 3')
    expect(project.maps).toHaveLength(3)

    reorderMap(transaction, project, third.id, 0)
    expect(project.maps[0]).toBe(third.id)
    expect(project.maps[2]).toBe(second.id)
  })

  it('renames a tab', () => {
    const { project, map } = setup()
    const transaction = tx()
    renameMap(transaction, project, map.id, 'Brinstar')
    expect(map.name).toBe('Brinstar')
  })

  it('replaces the last tab rather than leaving zero', () => {
    const { project, map } = setup()
    const transaction = tx()
    deleteMap(transaction, project, map.id, 'Map 1')
    expect(project.maps).toHaveLength(1)
    expect(project.maps[0]).not.toBe(map.id)
  })

  it('cascades to cross-tab transitions and restores them on undo', () => {
    const { project, map } = setup()
    const seed = tx()
    const second = addMap(seed, project, 'Map 2')
    seed.commit()

    const paint = tx(map)
    makeRoom(project, map, rect(0, 0, 1, 1))
    paintCells(paint, project, second, ['5,5'], { areaId: WORLD_AREA_ID })
    paint.commit()

    const link = tx(map)
    const teleport = ok(
      createTeleport(
        link,
        project,
        { mapId: map.id, cell: '0,0' },
        { mapId: second.id, cell: '5,5' },
      ),
    )
    link.commit()
    expect(farEndCount(project.teleportFarEnds)).toBe(1)

    // Deleting the *destination* tab must remove the teleport stored under
    // the origin tab, and undo must bring back both.
    const transaction = tx()
    deleteMap(transaction, project, second.id, 'Map 3')
    expect(map.transitions.has(teleport.id)).toBe(false)
    expect(farEndCount(project.teleportFarEnds)).toBe(0)

    transaction.rollback()
    expect(project.mapsById.has(second.id)).toBe(true)
    expect(map.transitions.has(teleport.id)).toBe(true)
    expect(farEndCount(project.teleportFarEnds)).toBe(1)
  })

  it('restores a deleted tab with all of its content', () => {
    const { project } = setup()
    const seed = tx()
    const second = addMap(seed, project, 'Map 2')
    seed.commit()

    const paint = tx(second)
    paintCells(paint, project, second, rect(0, 0, 3, 3), { areaId: WORLD_AREA_ID })
    ok(placeIcon(paint, second, '1,1', 'save', TEST_ICON_COLORS))
    paint.commit()

    const transaction = tx()
    deleteMap(transaction, project, second.id, 'Map 3')
    transaction.rollback()

    const restored = project.mapsById.get(second.id)!
    expect(restored.rooms.size).toBe(1)
    expect(restored.icons.size).toBe(1)
    expect(project.maps).toContain(second.id)
  })
})

describe('deletion impact', () => {
  // Builds: target holds two rooms, an icon and one same-map teleport;
  // "Origin A" links into it twice and "Origin B" once.
  function withIncomingLinks() {
    const { project, map } = setup()
    const seed = tx()
    const target = addMap(seed, project, 'Target')
    const originA = addMap(seed, project, 'Origin A')
    const originB = addMap(seed, project, 'Origin B')
    seed.commit()

    const paint = tx()
    paintCells(paint, project, target, rect(0, 0, 4, 1), { areaId: WORLD_AREA_ID })
    // Detached, so the same-map teleport below has two rooms to span.
    paintCells(paint, project, target, ['0,2'], { areaId: WORLD_AREA_ID })
    paintCells(paint, project, originA, rect(0, 0, 2, 1), { areaId: WORLD_AREA_ID })
    paintCells(paint, project, originB, ['0,0'], { areaId: WORLD_AREA_ID })
    ok(placeIcon(paint, target, '0,0', 'save', TEST_ICON_COLORS))
    paint.commit()

    const link = tx()
    // The target's own teleport. Same-map, so it goes with the tab and is
    // nobody else's business.
    ok(
      createTeleport(
        link,
        project,
        { mapId: target.id, cell: '0,0' },
        { mapId: target.id, cell: '0,2' },
      ),
    )
    ok(
      createTeleport(
        link,
        project,
        { mapId: originA.id, cell: '0,0' },
        { mapId: target.id, cell: '1,0' },
      ),
    )
    ok(
      createTeleport(
        link,
        project,
        { mapId: originA.id, cell: '1,0' },
        { mapId: target.id, cell: '2,0' },
      ),
    )
    ok(
      createTeleport(
        link,
        project,
        { mapId: originB.id, cell: '0,0' },
        { mapId: target.id, cell: '3,0' },
      ),
    )
    link.commit()

    return { project, map, target, originA, originB }
  }

  it('reports the map’s own content and every other map linking into it', () => {
    const { project, target, originA, originB } = withIncomingLinks()

    const impact = mapDeletionImpact(project, target.id)
    expect(impact.rooms).toBe(2)
    expect(impact.icons).toBe(1)
    expect(impact.transitions).toBe(1)
    expect(impact.replacesLastMap).toBe(false)
    expect(impact.incoming).toEqual([
      { mapId: originA.id, mapName: 'Origin A', teleports: 2 },
      { mapId: originB.id, mapName: 'Origin B', teleports: 1 },
    ])
  })

  it('reports exactly what the delete then removes', () => {
    const { project, target, originA, originB } = withIncomingLinks()
    const impact = mapDeletionImpact(project, target.id)

    const before = new Map(
      [...project.mapsById.values()].map((each) => [each.id, each.transitions.size]),
    )
    const transaction = tx()
    deleteMap(transaction, project, target.id, 'Replacement')

    // The confirmation's numbers are the contract: whatever it promised to
    // remove from each other map is what actually left it.
    for (const source of impact.incoming) {
      const remaining = project.mapsById.get(source.mapId)!.transitions.size
      expect(before.get(source.mapId)! - remaining).toBe(source.teleports)
    }
    expect(project.mapsById.get(originA.id)!.transitions.size).toBe(0)
    expect(project.mapsById.get(originB.id)!.transitions.size).toBe(0)
    expect(farEndCount(project.teleportFarEnds)).toBe(0)
  })

  it('lists incoming sources in tab order, not discovery order', () => {
    const { project, target, originA, originB } = withIncomingLinks()
    const move = tx()
    reorderMap(move, project, originB.id, 0)
    move.commit()

    expect(mapDeletionImpact(project, target.id).incoming.map((each) => each.mapId)).toEqual([
      originB.id,
      originA.id,
    ])
  })

  it('flags the last tab, which is replaced rather than leaving an empty project', () => {
    const { project, map } = setup()
    expect(mapDeletionImpact(project, map.id).replacesLastMap).toBe(true)
    expect(mapDeletionImpact(project, map.id).incoming).toEqual([])
  })
})

describe('duplicate', () => {
  it('copies content into an independent map, inserted right after the original', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 2))
    const seed = tx(map)
    ok(placeIcon(seed, map, '0,0', 'save', TEST_ICON_COLORS))
    seed.commit()

    const transaction = tx()
    const copy = duplicateMap(transaction, project, map.id, 'Map 1 copy')

    expect(project.maps[1]).toBe(copy.id)
    expect(copy.rooms.size).toBe(1)
    expect(copy.icons.size).toBe(1)
    // Independent objects with fresh ids.
    const copiedRoom = [...copy.rooms.values()][0]
    expect(copiedRoom.id).not.toBe(room.id)
    expect(sorted(copiedRoom.cells)).toEqual(sorted(room.cells))
    // Areas are project-wide and deliberately shared, not copied.
    expect(copiedRoom.areaId).toBe(room.areaId)
  })

  it('counts the cross-tab links a copy would lose, and loses exactly those', () => {
    const { project, map } = setup()
    const seed = tx()
    const second = addMap(seed, project, 'Map 2')
    seed.commit()

    const paint = tx()
    paintCells(paint, project, map, rect(0, 0, 4, 1), { areaId: WORLD_AREA_ID })
    paintCells(paint, project, map, ['0,2'], { areaId: WORLD_AREA_ID })
    paintCells(paint, project, second, ['0,0'], { areaId: WORLD_AREA_ID })
    paint.commit()

    const link = tx()
    // One same-map teleport, which copies; one cross-tab, which cannot.
    // Duplicating it would put two teleport endpoints on Map 2's cell 0,0.
    ok(
      createTeleport(link, project, { mapId: map.id, cell: '0,0' }, { mapId: map.id, cell: '0,2' }),
    )
    ok(
      createTeleport(
        link,
        project,
        { mapId: map.id, cell: '3,0' },
        { mapId: second.id, cell: '0,0' },
      ),
    )
    link.commit()

    expect(linksDroppedByDuplicate(project, map.id)).toBe(1)

    const transaction = tx()
    const copy = duplicateMap(transaction, project, map.id, 'Map 1 copy')
    expect(map.transitions.size).toBe(2)
    expect(copy.transitions.size).toBe(1)
    expect([...copy.transitions.values()][0].kind).toBe('teleport')
    // The original's link out is untouched, and no second far end appeared on
    // Map 2. This is the invariant the drop protects.
    expect(farEndCount(project.teleportFarEnds)).toBe(1)
  })
})

describe('areas', () => {
  it('refuses to rename, recolour or delete World', () => {
    const { project } = setup()
    const transaction = tx()
    expect(refusal(renameArea(transaction, project, WORLD_AREA_ID, 'Nope'))).toBe('immutable')
    expect(refusal(recolorArea(transaction, project, WORLD_AREA_ID, '#000', '#fff'))).toBe(
      'immutable',
    )
    expect(refusal(deleteArea(transaction, project, WORLD_AREA_ID))).toBe('immutable')
    expect(project.areas.get(WORLD_AREA_ID)!.name).toBe('World')
  })

  it('reassigns rooms to World when an area is deleted, project-wide', () => {
    const { project, map } = setup()
    const create = tx()
    const area = createNewArea(create, project, 'Brinstar', '#111', '#eee')
    const second = addMap(create, project, 'Map 2')
    create.commit()

    const paint = tx()
    paintCells(paint, project, map, ['0,0'], { areaId: area.id })
    paintCells(paint, project, second, ['0,0'], { areaId: area.id })
    paint.commit()
    expect(roomsInArea(project, area.id)).toBe(2)

    const transaction = tx()
    ok(deleteArea(transaction, project, area.id))
    expect(roomsInArea(project, area.id)).toBe(0)
    expect(roomsInArea(project, WORLD_AREA_ID)).toBe(2)

    // One undo restores the area and every room's membership in it.
    transaction.rollback()
    expect(roomsInArea(project, area.id)).toBe(2)
  })

  it('creates a user area with concrete colours, unlike World’s theme-derived ones', () => {
    const { project } = setup()
    const other = createArea(newAreaId(), 'Maridia', '#0af', '#fff')
    const transaction = tx()
    putArea(transaction, project, other)
    expect(project.areas.get(other.id)!.cellColor).toBe('#0af')
    expect(project.areas.get(WORLD_AREA_ID)!.cellColor).toBeNull()
  })
})

describe('lock types', () => {
  it('refuses to edit or delete Open', () => {
    const { project } = setup()
    const transaction = tx()
    expect(refusal(updateLockType(transaction, project, OPEN_LOCK_ID, { name: 'Nope' }))).toBe(
      'immutable',
    )
    expect(refusal(deleteLockType(transaction, project, OPEN_LOCK_ID))).toBe('immutable')
    expect(project.lockTypes.get(OPEN_LOCK_ID)!.color).toBeNull()
  })

  it('reassigns every end using a deleted lock type to Open', () => {
    const { project, map } = setup()
    const create = tx()
    const missile = createNewLockType(create, project, 'Missile', '#e23b3b', '▲')
    create.commit()

    makeRoom(project, map, rect(0, 0, 1, 1))
    makeRoom(project, map, rect(3, 0, 1, 1))
    const link = tx(map)
    const teleport = ok(
      createTeleport(link, project, { mapId: map.id, cell: '0,0' }, { mapId: map.id, cell: '3,0' }),
    )
    teleport.locks = { a: missile.id, b: missile.id }
    link.commit()

    // One transition, both ends Missile. The count is of transitions, not ends.
    // It used to count ends, so every symmetric door (the panel's default, since
    // locks are synced) reported double.
    expect(transitionsUsingLockType(project, missile.id)).toBe(1)

    const transaction = tx()
    ok(deleteLockType(transaction, project, missile.id))
    expect(teleport.locks).toEqual({ a: OPEN_LOCK_ID, b: OPEN_LOCK_ID })
    expect(project.lockTypes.has(missile.id)).toBe(false)
  })

  it('restores a deleted lock type to its original position in the list', () => {
    const { project } = setup()
    const create = tx()
    createNewLockType(create, project, 'Missile')
    const superMissile = createNewLockType(create, project, 'Super')
    createNewLockType(create, project, 'Power Bomb')
    create.commit()

    const before = [...project.lockTypes.keys()]
    const transaction = tx()
    deleteLockType(transaction, project, superMissile.id)
    transaction.rollback()
    expect([...project.lockTypes.keys()]).toEqual(before)
  })
})
