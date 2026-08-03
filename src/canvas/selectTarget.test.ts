import { describe, it, expect } from 'vitest'
import { resolveSelectTarget, selectCursor, selectRefOf, type SelectTarget } from './selectTarget'
import { ALL_LAYERS, type HitScene, type VisibleLayers } from './hitTest'
import { createProject } from '@/core/factory'
import { Transaction } from '@/core/journal'
import { createFromBox } from '@/core/ops/doors'
import { createLine, placeIcon } from '@/core/ops/markup'
import { paintCells } from '@/core/ops/rooms'
import { ok, TEST_ICON_COLORS } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { Camera } from './camera'

const TILE = 24
const FLAT: Camera = { pan: { x: 0, y: 0 }, zoom: 1 }

// One map carrying one of everything selectable, so a resolver that answered by
// accident has nowhere to hide.
//
//   room A over (0,0)-(1,1), room B over (2,0)-(3,1), sharing the seam at x=2
//   an edge door on that seam
//   an icon at (0,0), inside room A
//   a line (4,4)->(5,4), outside every room
//
// One transition kind, not three. Select's Object row is whatever `hitTest`
// answers, and which of a door, a shaft end and a teleport marker that is under
// any given pixel is `hitTest`'s own suite to pin.
function fixture() {
  const project = createProject({
    projectName: 'Fixture',
    firstMapName: 'Surface',
    worldAreaName: 'World',
    openLockName: 'Open',
    lockedLockName: 'Locked',
  })
  const map = project.mapsById.get(project.maps[0])!
  const tx = new Transaction('build', { kind: 'map', mapId: map.id })

  const roomA = paintCells(tx, project, map, ['0,0', '1,0', '0,1', '1,1'], {
    areaId: WORLD_AREA_ID,
  })
  const roomB = paintCells(tx, project, map, ['2,0', '3,0', '2,1', '3,1'], {
    areaId: WORLD_AREA_ID,
  })
  const [door] = ok(createFromBox(tx, project, map, '1,0', '2,0'))
  const icon = ok(placeIcon(tx, map, '0,0', 'save', TEST_ICON_COLORS))
  const line = ok(
    createLine(tx, map, ['4,4', '5,4'], { color: '#d9a441', arrowStart: false, arrowEnd: false }),
  )
  tx.commit()

  const scene = (camera: Camera = FLAT): HitScene => ({
    project,
    map,
    camera,
    tileSize: TILE,
  })
  return { project, map, scene, roomA, roomB, door, icon, line }
}

// Nothing hidden, which is what every case says unless it is about hiding.
function resolve(
  point: { x: number; y: number },
  scene: HitScene,
  subMode: 'rooms' | 'cells',
  layers: VisibleLayers = ALL_LAYERS,
) {
  return resolveSelectTarget(point, scene, subMode, layers)
}

// A world point in screen pixels, so every case below is aimed the way a
// pointer is: integers land on cell boundaries, halves on cell centres.
function screenAt(x: number, y: number, camera: Camera = FLAT) {
  const scale = TILE * camera.zoom
  return { x: (x - camera.pan.x) * scale, y: (y - camera.pan.y) * scale }
}

// The four points that carry an object, plus one that carries none. Shared by
// both arms, which is what makes the Cells cases a statement about the same
// pixels rather than about different ones.
const ICON_AT = screenAt(0.5, 0.5)
const ROOM_AT = screenAt(1.5, 1.5)
const DOOR_AT = screenAt(2, 0.5)
const LINE_AT = screenAt(5, 4.5)
const BARE_AT = screenAt(8.5, 8.5)

describe('resolveSelectTarget in Rooms', () => {
  it('answers the room under a plain room cell', () => {
    const { scene, roomA } = fixture()

    expect(resolve(ROOM_AT, scene(), 'rooms')).toEqual({
      kind: 'object',
      cell: '1,1',
      ref: { kind: 'room', id: roomA.id },
    })
  })

  // Every object kind reaches the same row, which is what the locked table says:
  // click, shift-click and Del treat them identically, and the drag column tells
  // them apart by the ref rather than by the row.
  it('answers an icon, a transition and a line through that one row', () => {
    const { scene, door, icon, line } = fixture()

    expect(resolve(ICON_AT, scene(), 'rooms')).toMatchObject({
      kind: 'object',
      ref: { kind: 'icon', id: icon.id },
    })
    expect(resolve(DOOR_AT, scene(), 'rooms')).toMatchObject({
      kind: 'object',
      ref: { kind: 'transition', id: door.id },
    })
    expect(resolve(LINE_AT, scene(), 'rooms')).toMatchObject({
      kind: 'object',
      ref: { kind: 'line', id: line.id },
    })
  })

  it('answers bare grid with the empty row', () => {
    const { scene } = fixture()

    expect(resolve(BARE_AT, scene(), 'rooms')).toEqual({ kind: 'empty', cell: '8,8' })
  })

  // The cell rides along on every row, including the ones that answer an object.
  // A marquee and a move both need to know where the press landed, and the ref
  // alone does not say.
  it('reports the cell the press landed in, whatever it found there', () => {
    const { scene } = fixture()

    expect(resolve(ICON_AT, scene(), 'rooms').cell).toBe('0,0')
    expect(resolve(DOOR_AT, scene(), 'rooms').cell).toBe('2,0')
    expect(resolve(BARE_AT, scene(), 'rooms').cell).toBe('8,8')
  })
})

describe('resolveSelectTarget in Cells', () => {
  // The whole of the sub-mode branch, in one assertion per pixel: the same
  // points that answer an icon, a transition and a room in Rooms answer the cell
  // they sit in here. A filter over an `ObjectRef` could not say this, which is
  // why the resolver branches rather than filtering.
  it('answers the owning cell where Rooms answers an object', () => {
    const { scene, roomA, roomB } = fixture()

    expect(resolve(ICON_AT, scene(), 'cells')).toEqual({
      kind: 'cell',
      cell: '0,0',
      roomId: roomA.id,
    })
    expect(resolve(ROOM_AT, scene(), 'cells')).toEqual({
      kind: 'cell',
      cell: '1,1',
      roomId: roomA.id,
    })
    // The door's pixel is on the seam, and the cell it falls in belongs to the
    // room on the far side of it.
    expect(resolve(DOOR_AT, scene(), 'cells')).toEqual({
      kind: 'cell',
      cell: '2,0',
      roomId: roomB.id,
    })
  })

  // A line is the one object with no room under it, so in Cells it is not merely
  // unreachable: there is nothing there to select at all.
  it('answers empty over a line that no room owns', () => {
    const { scene } = fixture()

    expect(resolve(LINE_AT, scene(), 'cells')).toEqual({ kind: 'empty', cell: '5,4' })
    expect(resolve(BARE_AT, scene(), 'cells')).toEqual({ kind: 'empty', cell: '8,8' })
  })
})

// You cannot select what you cannot see. Select is the mode that needs the rule
// stated: Door and Markup force their own layers on instead, which they can do
// because each acts on exactly one kind, and Select acts on all of them.
describe('resolveSelectTarget with a layer hidden', () => {
  it('falls through a hidden icon to the room it stands on', () => {
    const { scene, roomA } = fixture()

    expect(resolve(ICON_AT, scene(), 'rooms', { ...ALL_LAYERS, icons: false })).toMatchObject({
      ref: { kind: 'room', id: roomA.id },
    })
  })

  // The transitions master covers both kinds of hit: an edge door here, and a
  // teleport marker through the same flag.
  it('falls through a hidden door to the room it sits on', () => {
    const { scene, roomB } = fixture()

    expect(resolve(DOOR_AT, scene(), 'rooms', { ...ALL_LAYERS, transitions: false })).toMatchObject(
      {
        ref: { kind: 'room', id: roomB.id },
      },
    )
  })

  // Nothing underneath it, so hiding lines leaves bare grid rather than a
  // different object.
  it('answers empty where a hidden line lies outside every room', () => {
    const { scene } = fixture()

    expect(resolve(LINE_AT, scene(), 'rooms', { ...ALL_LAYERS, lines: false })).toEqual({
      kind: 'empty',
      cell: '5,4',
    })
  })

  // Rooms have no toggle, so hiding everything hides nothing here.
  it('still answers the room with every layer off', () => {
    const { scene, roomA } = fixture()

    expect(
      resolve(ROOM_AT, scene(), 'rooms', { transitions: false, icons: false, lines: false }),
    ).toMatchObject({ ref: { kind: 'room', id: roomA.id } })
  })
})

// Screen pixels in, rows out, so the camera has to be honoured on every row of
// both arms. Zoomed and panned together rather than one at a time: a resolver
// that dropped either would still pass with the other one held at its identity.
describe('resolveSelectTarget under a moved camera', () => {
  const camera: Camera = { pan: { x: 3, y: 2 }, zoom: 0.5 }

  it('resolves the same rows from the pixels the camera puts them at', () => {
    const { scene, roomA, icon, door } = fixture()
    const moved = scene(camera)

    expect(resolve(screenAt(1.5, 1.5, camera), moved, 'rooms')).toMatchObject({
      ref: { kind: 'room', id: roomA.id },
    })
    expect(resolve(screenAt(0.5, 0.5, camera), moved, 'rooms')).toMatchObject({
      ref: { kind: 'icon', id: icon.id },
    })
    expect(resolve(screenAt(2, 0.5, camera), moved, 'rooms')).toMatchObject({
      ref: { kind: 'transition', id: door.id },
    })
    expect(resolve(screenAt(8.5, 8.5, camera), moved, 'rooms')).toEqual({
      kind: 'empty',
      cell: '8,8',
    })
    expect(resolve(screenAt(1.5, 1.5, camera), moved, 'cells')).toEqual({
      kind: 'cell',
      cell: '1,1',
      roomId: roomA.id,
    })
  })
})

describe('selectRefOf', () => {
  it('answers the object for an object row and the cell for a cell row', () => {
    const object: SelectTarget = {
      kind: 'object',
      cell: '0,0',
      ref: { kind: 'line', id: 'ln_1' as never },
    }
    expect(selectRefOf(object)).toEqual({ kind: 'line', id: 'ln_1' })
    // The coordinate is the cell's name, so the ref is the row's own cell.
    expect(selectRefOf({ kind: 'cell', cell: '4,7', roomId: 'room_1' as never })).toEqual({
      kind: 'cell',
      id: '4,7',
    })
    expect(selectRefOf({ kind: 'empty', cell: '4,7' })).toBeNull()
  })
})

describe('selectCursor', () => {
  it('points at what a click would select, and says nothing over bare grid', () => {
    const { scene } = fixture()

    expect(selectCursor(resolve(ROOM_AT, scene(), 'rooms'))).toBe('pointer')
    expect(selectCursor(resolve(LINE_AT, scene(), 'rooms'))).toBe('pointer')
    expect(selectCursor(resolve(ROOM_AT, scene(), 'cells'))).toBe('pointer')
    expect(selectCursor(resolve(BARE_AT, scene(), 'rooms'))).toBeNull()
    expect(selectCursor(resolve(LINE_AT, scene(), 'cells'))).toBeNull()
  })
})
