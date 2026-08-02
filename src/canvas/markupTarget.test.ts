import { describe, it, expect } from 'vitest'
import { armedPlacementAt, markupCursor, resolveMarkupTarget } from './markupTarget'
import { hitTest, lineEndRadius, type HitScene } from './hitTest'
import { createProject } from '@/core/factory'
import { Transaction } from '@/core/journal'
import { createLine, placeIcon } from '@/core/ops/markup'
import { paintCells } from '@/core/ops/rooms'
import { ok, TEST_ICON_COLORS } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { CellKey } from '@/core/cell'

const TILE = 24
const STYLE = { color: '#d9a441', arrowStart: false, arrowEnd: false }

// One map carrying every row of the table at once, so a resolver that answered
// by accident has nowhere to hide.
//
//   a room over (0,0)-(4,2), and bare grid everywhere else
//   an icon at (1,1), with a line running through that same cell
//   a line (0,0)->(1,1)->(2,2) crossing the icon's cell diagonally
//   a second line (6,6)->(7,6) entirely outside every room
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

  const room = paintCells(
    tx,
    project,
    map,
    ['0,0', '1,0', '2,0', '3,0', '4,0', '0,1', '1,1', '2,1', '3,1', '4,1', '0,2', '1,2', '2,2'],
    { areaId: WORLD_AREA_ID },
  )!
  const icon = ok(placeIcon(tx, map, '1,1', 'save', TEST_ICON_COLORS))
  const crossing = ok(createLine(tx, map, ['0,0', '1,1', '2,2'], STYLE))
  const outside = ok(createLine(tx, map, ['6,6', '7,6'], STYLE))
  tx.commit()

  const scene: HitScene = {
    project,
    map,
    camera: { pan: { x: 0, y: 0 }, zoom: 1 },
    tileSize: TILE,
  }
  return { project, map, scene, room, icon, crossing, outside }
}

// The screen point at a cell's centre, which is where a line's vertices and an
// icon both sit.
function centre(cell: CellKey, zoom = 1) {
  const [x, y] = cell.split(',').map(Number)
  return { x: TILE * zoom * (x + 0.5), y: TILE * zoom * (y + 0.5) }
}

describe('resolveMarkupTarget', () => {
  it('answers the icon where hitTest answers the line', () => {
    const { scene, icon, crossing } = fixture()
    const point = centre('1,1')

    // The locked priority is icon before line. `hitTest` tests 1-D before 2-D
    // on purpose and so answers the line: this disagreement is the whole reason
    // Markup has a resolver of its own.
    expect(hitTest(point, scene)).toEqual({ kind: 'line', id: crossing.id })
    expect(resolveMarkupTarget(point, scene)).toEqual({
      kind: 'icon',
      cell: '1,1',
      roomId: scene.map.cellOwner.get('1,1'),
      id: icon.id,
    })
  })

  it('says which end of a line was hit', () => {
    const { scene, crossing } = fixture()

    expect(resolveMarkupTarget(centre('0,0'), scene)).toMatchObject({
      kind: 'line-end',
      id: crossing.id,
      atStart: true,
    })
    expect(resolveMarkupTarget(centre('2,2'), scene)).toMatchObject({
      kind: 'line-end',
      id: crossing.id,
      atStart: false,
    })
  })

  it('separates the body from the ends, leaving a short line a grabbable middle', () => {
    const { scene, outside } = fixture()
    const from = centre('6,6')
    const to = centre('7,6')
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }

    // The shortest possible line: one segment, both cells an endpoint. Its
    // midpoint still has to resolve as body, because body and end are
    // different rows in all three columns.
    expect(resolveMarkupTarget(middle, scene)).toMatchObject({
      kind: 'line-body',
      id: outside.id,
    })
    expect(resolveMarkupTarget(from, scene)).toMatchObject({ kind: 'line-end', atStart: true })
    expect(resolveMarkupTarget(to, scene)).toMatchObject({ kind: 'line-end', atStart: false })
  })

  it('resolves a line that lies outside every room, with no room to report', () => {
    const { scene, outside } = fixture()

    // Lines have no room owner, so no row gates on one.
    expect(resolveMarkupTarget(centre('6,6'), scene)).toEqual({
      kind: 'line-end',
      cell: '6,6',
      roomId: null,
      id: outside.id,
      atStart: true,
    })
  })

  it('answers the room cell when nothing is on it, and bare grid otherwise', () => {
    const { scene, room } = fixture()

    expect(resolveMarkupTarget(centre('4,0'), scene)).toEqual({
      kind: 'room',
      cell: '4,0',
      roomId: room.id,
    })
    expect(resolveMarkupTarget(centre('9,9'), scene)).toEqual({ kind: 'empty', cell: '9,9' })
  })

  it('picks the topmost line where two overlap', () => {
    const { project, map, scene } = fixture()
    const tx = new Transaction('later', { kind: 'map', mapId: map.id })
    const later = ok(createLine(tx, map, ['6,6', '7,6'], { ...STYLE, color: '#other' }))
    tx.commit()
    expect(project).toBeDefined()

    // Same two cells as `outside`, drawn afterwards, so it is painted on top.
    expect(resolveMarkupTarget(centre('6,6'), scene)).toMatchObject({ id: later.id })
  })

  it('keeps its regions in screen pixels as the zoom changes', () => {
    const { scene, outside } = fixture()
    const zoomed = { ...scene, camera: { pan: { x: 0, y: 0 }, zoom: 3 } }

    // The same world point resolves the same way at a different zoom: what
    // changes is how many screen pixels away you may be, not which row.
    expect(resolveMarkupTarget(centre('6,6', 3), zoomed)).toMatchObject({
      kind: 'line-end',
      id: outside.id,
    })

    // Just outside the endpoint radius is the body, at either zoom.
    const past = lineEndRadius(zoomed) + 1
    const along = { x: centre('6,6', 3).x + past, y: centre('6,6', 3).y }
    expect(resolveMarkupTarget(along, zoomed)).toMatchObject({ kind: 'line-body' })
  })

  it('caps the endpoint radius at a quarter cell, so it cannot eat the body', () => {
    const { scene } = fixture()
    const tiny = { ...scene, camera: { pan: { x: 0, y: 0 }, zoom: 0.1 } }

    // Zoomed far out the unclamped radius would exceed the whole cell, and
    // every point of every line would be an endpoint.
    expect(lineEndRadius(tiny)).toBeLessThanOrEqual(TILE * 0.1 * 0.25)
  })
})

describe('markupCursor', () => {
  it('aims where a drag would start a line, including on bare grid', () => {
    const { scene } = fixture()
    const empty = resolveMarkupTarget(centre('9,9'), scene)
    const room = resolveMarkupTarget(centre('4,0'), scene)

    // Door mode's empty row is inert in every column and offers no cursor.
    // Markup's is not: a line may be drawn outside every room.
    expect(markupCursor(empty)).toBe('crosshair')
    expect(markupCursor(room)).toBe('crosshair')
  })

  it('points at things that already exist', () => {
    const { scene } = fixture()

    expect(markupCursor(resolveMarkupTarget(centre('1,1'), scene))).toBe('pointer')
    expect(markupCursor(resolveMarkupTarget(centre('6,6'), scene))).toBe('pointer')
  })

  it('offers no cursor while erasing on a row with nothing to delete', () => {
    const { scene, outside } = fixture()
    const from = centre('6,6')
    const to = centre('7,6')
    const body = resolveMarkupTarget({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, scene)
    expect(body).toMatchObject({ kind: 'line-body', id: outside.id })

    // Peel works only from an end, and erase on a room cell or bare grid does
    // nothing, so none of the three may promise a cursor.
    expect(markupCursor(body, true)).toBeNull()
    expect(markupCursor(resolveMarkupTarget(centre('4,0'), scene), true)).toBeNull()
    expect(markupCursor(resolveMarkupTarget(centre('9,9'), scene), true)).toBeNull()

    // The two rows that do delete keep theirs.
    expect(markupCursor(resolveMarkupTarget(centre('1,1'), scene), true)).toBe('pointer')
    expect(markupCursor(resolveMarkupTarget(from, scene), true)).toBe('pointer')
  })
})

describe('armedPlacementAt', () => {
  it('places on a free room cell, whatever else is in it', () => {
    const { scene } = fixture()

    expect(armedPlacementAt(resolveMarkupTarget(centre('4,0'), scene), false)).toBe('place')
    // A line row still means the cell is free: an icon outranks both line rows
    // in the same cell, so anything but `icon` is somewhere an icon can go.
    const crossing = resolveMarkupTarget(centre('0,0'), scene)
    expect(crossing.kind).toBe('line-end')
    expect(armedPlacementAt(crossing, false)).toBe('place')
  })

  it('is blocked on an occupied cell until replace is on', () => {
    const { scene } = fixture()
    const occupied = resolveMarkupTarget(centre('1,1'), scene)
    expect(occupied.kind).toBe('icon')

    expect(armedPlacementAt(occupied, false)).toBe('blocked')
    expect(armedPlacementAt(occupied, true)).toBe('replace')
  })

  it('does not treat the icon being dragged as occupying its own cell', () => {
    const { scene, icon } = fixture()
    const occupied = resolveMarkupTarget(centre('1,1'), scene)
    expect(occupied).toMatchObject({ kind: 'icon', id: icon.id })

    // A drag that goes out and comes back is a no-op, not a collision with
    // itself, and `repositionIcon` makes the same exception. Without this the
    // cursor would refuse the cell the icon is already standing on.
    expect(armedPlacementAt(occupied, false)).toBe('blocked')
    expect(armedPlacementAt(occupied, false, icon.id)).toBe('place')
  })

  it('refuses outside every room, on a line row as much as bare grid', () => {
    const { scene } = fixture()

    expect(armedPlacementAt(resolveMarkupTarget(centre('9,9'), scene), true)).toBe('not-in-a-room')
    // Lines may live outside rooms; icons may not, so a line hit out there is
    // still nowhere to put one.
    const outside = resolveMarkupTarget(centre('6,6'), scene)
    expect(outside.kind).toBe('line-end')
    expect(armedPlacementAt(outside, true)).toBe('not-in-a-room')
  })
})

describe('markupCursor while armed', () => {
  it('replaces the click column for every row', () => {
    const { scene } = fixture()
    const armed = { replace: false }

    // A room cell would open the picker unarmed; a line end would select.
    // Armed, both place, so both say so.
    expect(markupCursor(resolveMarkupTarget(centre('4,0'), scene), false, armed)).toBe('copy')
    expect(markupCursor(resolveMarkupTarget(centre('0,0'), scene), false, armed)).toBe('copy')
  })

  it('shows a refusal before the press, not after it', () => {
    const { scene } = fixture()
    const occupied = resolveMarkupTarget(centre('1,1'), scene)

    // "Nothing happened" must never be how the user first learns the rule.
    expect(markupCursor(occupied, false, { replace: false })).toBe('not-allowed')
    expect(markupCursor(occupied, false, { replace: true })).toBe('copy')
  })

  it('offers nothing where an icon cannot go', () => {
    const { scene } = fixture()
    expect(markupCursor(resolveMarkupTarget(centre('9,9'), scene), false, { replace: true })).toBe(
      null,
    )
  })

  it('lets erase outrank it, since the toggle governs the whole button', () => {
    const { scene } = fixture()
    const icon = resolveMarkupTarget(centre('1,1'), scene)

    // While erasing, a click deletes rather than places, so a placement cursor
    // would promise something that will not happen.
    expect(markupCursor(icon, true, { replace: false })).toBe('pointer')
    expect(markupCursor(resolveMarkupTarget(centre('4,0'), scene), true, { replace: false })).toBe(
      null,
    )
  })
})
