import { describe, it, expect } from 'vitest'
import { doorCursor, gestureOriginCell, resolveDoorTarget, type DoorTarget } from './doorTarget'
import { GRAB_MARGIN_PX, hitTest } from './hitTest'
import type { HitScene } from './hitTest'
import { createProject } from '@/core/factory'
import { Transaction } from '@/core/journal'
import { createFromBox, createTeleport } from '@/core/ops/doors'
import { addMap } from '@/core/ops/maps'
import { createLine, placeIcon } from '@/core/ops/markup'
import { paintCells } from '@/core/ops/rooms'
import { ok, TEST_ICON_COLORS } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { MapId, RoomId, TransitionId } from '@/core/ids'
import type { ProjectModel } from '@/core/types'

const TILE = 24

// One map holding every kind of target at once, so a resolver that answered
// by accident, because there was only one thing on the map, has nowhere to
// hide.
//
//   rooms A (0,0)-(1,1) and B (2,0)-(3,1), sharing the seam at x = 2
//   a door on the seam's northern edge, at (2,0,V)
//   rooms C (0,4) and D (0,8), with a vertical elevator across the gap
//   a same-map teleport A(0,1) <-> B(3,1)
//   a cross-tab teleport A(1,0) -> Caves(1,1)
//   an icon in a room cell, and a line crossing the door's edge
function fixture() {
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
  const map = project.mapsById.get(surfaceId)!

  const a = paintCells(tx, project, map, ['0,0', '1,0', '0,1', '1,1'], { areaId: WORLD_AREA_ID })
  const b = paintCells(tx, project, map, ['2,0', '3,0', '2,1', '3,1'], { areaId: WORLD_AREA_ID })
  paintCells(tx, project, map, ['0,4'], { areaId: WORLD_AREA_ID })
  paintCells(tx, project, map, ['0,8'], { areaId: WORLD_AREA_ID })
  paintCells(tx, project, caves, ['1,1'], { areaId: WORLD_AREA_ID })

  const [door] = ok(createFromBox(tx, project, map, '1,0', '2,0'))
  const [elevator] = ok(createFromBox(tx, project, map, '0,4', '0,8'))
  const near = ok(
    createTeleport(
      tx,
      project,
      { mapId: surfaceId, cell: '0,1' },
      { mapId: surfaceId, cell: '3,1' },
    ),
  )
  const across = ok(
    createTeleport(
      tx,
      project,
      { mapId: surfaceId, cell: '1,0' },
      { mapId: caves.id, cell: '1,1' },
    ),
  )

  ok(placeIcon(tx, map, '0,0', 'save', TEST_ICON_COLORS))
  // Through the centres of the two cells the door's edge separates, so the line
  // passes exactly over that edge, which is what makes it shadow the door.
  ok(createLine(tx, map, ['1,0', '2,0'], { color: '#d9a441', arrowStart: false, arrowEnd: false }))
  tx.commit()

  return {
    project,
    surfaceId,
    cavesId: caves.id,
    rooms: { a: a.id, b: b.id },
    door: door.id,
    elevator: elevator.id,
    near: near.id,
    across: across.id,
  }
}

function sceneOn(project: ProjectModel, mapId: MapId, zoom = 1): HitScene {
  return {
    project,
    map: project.mapsById.get(mapId)!,
    camera: { pan: { x: 0, y: 0 }, zoom },
    tileSize: TILE,
  }
}

// A world point in screen pixels, at the scene's zoom: the resolver works in
// screen space, which is the whole reason the tolerances are in pixels.
function at(x: number, y: number, zoom = 1) {
  return { x: x * TILE * zoom, y: y * TILE * zoom }
}

describe('resolveDoorTarget', () => {
  it('answers empty on bare grid, in every column of the table', () => {
    const { project, surfaceId } = fixture()
    const target = resolveDoorTarget(at(6.5, 6.5), sceneOn(project, surfaceId))

    expect(target).toEqual({ kind: 'empty', cell: '6,6' })
  })

  it('answers the room for a cell with nothing on it', () => {
    const { project, surfaceId, rooms } = fixture()
    const target = resolveDoorTarget(at(3.5, 0.5), sceneOn(project, surfaceId))

    expect(target).toEqual({ kind: 'room', cell: '3,0', roomId: rooms.b })
  })

  // Select beats create: the door is answered rather than the room cell it
  // sits between, so a press there can never start a new transition.
  it('answers the door for a press near its edge', () => {
    const { project, surfaceId, door, rooms } = fixture()
    const target = resolveDoorTarget(at(2, 0.5), sceneOn(project, surfaceId))

    expect(target).toEqual({ kind: 'door', cell: '2,0', roomId: rooms.b, id: door })
  })

  it('answers the room again a cell away from the same edge', () => {
    const { project, surfaceId, rooms } = fixture()
    // Same seam, the other segment, which carries no door.
    const target = resolveDoorTarget(at(2, 1.5), sceneOn(project, surfaceId))

    expect(target).toEqual({ kind: 'room', cell: '2,1', roomId: rooms.b })
  })

  it('answers an elevator end from the room side, carrying the room', () => {
    const { project, surfaceId, elevator } = fixture()
    // Just inside room C, against its south wall, which is the facing edge.
    const target = resolveDoorTarget(at(0.5, 4.98), sceneOn(project, surfaceId))

    expect(target.kind).toBe('door')
    expect((target as Extract<DoorTarget, { kind: 'door' }>).id).toBe(elevator)
    expect((target as Extract<DoorTarget, { kind: 'door' }>).roomId).not.toBeNull()
  })

  // The same edge, approached from the gap. The elevator is still selectable
  // there (it is drawn there), but the press is standing on no room, which is
  // what stops a box drag starting from it.
  it('answers the same elevator end from the gap side, with no room', () => {
    const { project, surfaceId, elevator } = fixture()
    const target = resolveDoorTarget(at(0.5, 5.02), sceneOn(project, surfaceId))

    expect(target).toEqual({ kind: 'door', cell: '0,5', roomId: null, id: elevator })
  })

  it('answers a same-map teleport endpoint in the cell interior, leading nowhere else', () => {
    const { project, surfaceId, near, rooms } = fixture()
    const target = resolveDoorTarget(at(0.5, 1.5), sceneOn(project, surfaceId))

    expect(target).toEqual({
      kind: 'teleport',
      cell: '0,1',
      roomId: rooms.a,
      id: near,
      leadsTo: null,
    })
  })

  it('answers a cross-tab endpoint with where it leads, from either tab', () => {
    const { project, surfaceId, cavesId, across } = fixture()

    const origin = resolveDoorTarget(at(1.5, 0.5), sceneOn(project, surfaceId))
    expect(origin.kind).toBe('teleport')
    expect((origin as Extract<DoorTarget, { kind: 'teleport' }>).leadsTo).toEqual({
      mapId: cavesId,
      cell: '1,1',
      label: 'C',
    })

    // The far marker, on a tab that stores no transition of its own.
    const far = resolveDoorTarget(at(1.5, 1.5), sceneOn(project, cavesId))
    expect(far.kind).toBe('teleport')
    expect((far as Extract<DoorTarget, { kind: 'teleport' }>).id).toBe(across)
    expect((far as Extract<DoorTarget, { kind: 'teleport' }>).leadsTo).toEqual({
      mapId: surfaceId,
      cell: '1,0',
      label: 'S',
    })
  })

  // An edge door or elevator is selected by clicking near its edge; a teleport
  // by clicking the cell interior. That is what lets several edge-transitions
  // share a cell yet stay individually selectable. Cell (1,0) holds a teleport
  // endpoint and touches the door's edge.
  it('splits one cell between the door on its edge and the teleport in its middle', () => {
    const { project, surfaceId, door, across } = fixture()
    const scene = sceneOn(project, surfaceId)

    const onEdge = resolveDoorTarget(at(2, 0.5), scene)
    const inside = resolveDoorTarget(at(1.5, 0.5), scene)

    expect(onEdge.kind).toBe('door')
    expect((onEdge as Extract<DoorTarget, { kind: 'door' }>).id).toBe(door)
    expect(inside.kind).toBe('teleport')
    expect((inside as Extract<DoorTarget, { kind: 'teleport' }>).id).toBe(across)
  })

  // Door mode has no row for an icon or a line, so neither may shadow what is
  // under it. Both are in the dev fixture, and `hitTest` ranks both above the
  // things this mode does act on: the line above an edge door, the icon above
  // the room cell. Using it unfiltered would make this map partly inert.
  it('sees past an icon to the room cell it sits on', () => {
    const { project, surfaceId, rooms } = fixture()
    const scene = sceneOn(project, surfaceId)
    const point = at(0.5, 0.5)

    // The premise: unfiltered, this point is the icon. Asserted rather than
    // assumed, because the test is worthless if it drifts to a point the icon
    // does not claim: it would then pass with no filtering at all.
    expect(hitTest(point, scene)?.kind).toBe('icon')
    expect(resolveDoorTarget(point, scene)).toEqual({ kind: 'room', cell: '0,0', roomId: rooms.a })
  })

  it('sees past a line to the door it crosses', () => {
    const { project, surfaceId, door } = fixture()
    const scene = sceneOn(project, surfaceId)
    // The line runs through the centres of (1,0) and (2,0), so it passes exactly
    // over the seam at x = 2, where the door is.
    const point = at(2, 0.5)

    // Lines rank above edge doors in `hitTest`, so unfiltered this point is
    // the line and the door beneath it is unreachable.
    expect(hitTest(point, scene)?.kind).toBe('line')
    expect(resolveDoorTarget(point, scene)).toEqual(
      expect.objectContaining({ kind: 'door', id: door }),
    )
  })

  // The band is a screen measure, so the same world point resolves differently
  // at different zooms and the proportion of a cell it claims changes. What has
  // to hold at every zoom is that the edge is reachable and the interior is not
  // swallowed.
  describe('at any zoom', () => {
    for (const zoom of [0.5, 1, 4]) {
      it(`resolves the edge and the interior apart at ${zoom}x`, () => {
        const { project, surfaceId, door, rooms } = fixture()
        const scene = sceneOn(project, surfaceId, zoom)

        // Exactly on the drawn edge.
        expect(resolveDoorTarget(at(2, 0.5, zoom), scene)).toEqual(
          expect.objectContaining({ kind: 'door', id: door }),
        )
        // The far side of the same cell, which no band reaches at these zooms.
        expect(resolveDoorTarget(at(2.9, 0.5, zoom), scene)).toEqual({
          kind: 'room',
          cell: '2,0',
          roomId: rooms.b,
        })
      })

      it(`still catches the edge a few screen pixels off it at ${zoom}x`, () => {
        const { project, surfaceId, door } = fixture()
        const scene = sceneOn(project, surfaceId, zoom)
        // In screen pixels, not cells: the grab margin is a fixed pixel figure,
        // so this offset means the same thing to the pointer at every zoom.
        const point = at(2, 0.5, zoom)

        expect(resolveDoorTarget({ ...point, x: point.x + GRAB_MARGIN_PX }, scene)).toEqual(
          expect.objectContaining({ kind: 'door', id: door }),
        )
      })
    }
  })
})

// All gestures start on a room cell: starting on empty space does nothing.
describe('gestureOriginCell', () => {
  it('starts nothing on bare grid', () => {
    const { project, surfaceId } = fixture()
    expect(
      gestureOriginCell(resolveDoorTarget(at(6.5, 6.5), sceneOn(project, surfaceId))),
    ).toBeNull()
  })

  it('starts on a plain room cell, and on a transition that sits on one', () => {
    const { project, surfaceId } = fixture()
    const scene = sceneOn(project, surfaceId)

    // A room cell with nothing on it.
    expect(gestureOriginCell(resolveDoorTarget(at(3.5, 0.5), scene))).toBe('3,0')
    // An edge door counts too: a drag from any room cell starts a box gesture
    // even where a transition already exists.
    expect(gestureOriginCell(resolveDoorTarget(at(2, 0.5), scene))).toBe('2,0')
    // A teleport endpoint counts too: excluding it would leave a cell holding
    // a teleport from which no door could ever be drawn.
    expect(gestureOriginCell(resolveDoorTarget(at(0.5, 1.5), scene))).toBe('0,1')
  })

  // The case that is easy to miss: an elevator's facing edge is shared with the
  // empty cell on the gap side, so a press there selects a transition while
  // standing on no room. A box drag from it would have no origin room.
  it('starts nothing on the gap side of an elevator end, though it is a target', () => {
    const { project, surfaceId, elevator } = fixture()
    const target = resolveDoorTarget(at(0.5, 5.02), sceneOn(project, surfaceId))

    expect(target).toEqual(expect.objectContaining({ kind: 'door', id: elevator }))
    expect(gestureOriginCell(target)).toBeNull()
  })
})

describe('doorCursor', () => {
  const target = (kind: DoorTarget['kind']): DoorTarget => {
    const id = 'tr_1' as TransitionId
    const roomId = 'room_1' as RoomId
    switch (kind) {
      case 'empty':
        return { kind: 'empty', cell: '0,0' }
      case 'room':
        return { kind: 'room', cell: '0,0', roomId }
      case 'door':
        return { kind: 'door', cell: '0,0', roomId, id }
      case 'teleport':
        return { kind: 'teleport', cell: '0,0', roomId, id, leadsTo: null }
    }
  }

  // Bare grid is the one row where nothing happens in any column, so it is the
  // one row that must not look like it might.
  it('offers nothing on the empty row', () => {
    expect(doorCursor(target('empty'))).toBeNull()
  })

  it('aims on a room cell, and points at what is already there', () => {
    expect(doorCursor(target('room'))).toBe('crosshair')
    expect(doorCursor(target('door'))).toBe('pointer')
    expect(doorCursor(target('teleport'))).toBe('pointer')
  })

  // The erase toggle makes the primary pointer erase or delete instead of its
  // normal action, so it does not add a row: it takes the create column away.
  // A room cell offering a crosshair while the toggle is on would be promising
  // a box drag the dispatch has already given to delete.
  it('stops aiming while erasing, and still points at what it can delete', () => {
    expect(doorCursor(target('room'), true)).toBeNull()
    expect(doorCursor(target('empty'), true)).toBeNull()
    expect(doorCursor(target('door'), true)).toBe('pointer')
    expect(doorCursor(target('teleport'), true)).toBe('pointer')
  })
})
