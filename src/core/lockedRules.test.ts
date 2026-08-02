// Rules the project has committed to that nothing else verifies. Nothing here
// is known to have been broken, which is the difference from
// `regressions.test.ts`: a failure here means the code drifted away from a
// decision, not that an old bug came back.

import { describe, it, expect } from 'vitest'
import { SIDES, edgeOfCell } from './cell'
import type { CellKey, EdgeKey } from './cell'
import { WORLD_AREA_ID } from './ids'
import { ModelError } from './outcome'
import { addCell } from './primitives'
import { createTeleport } from './ops/doors'
import { addMap } from './ops/maps'
import { placeIcon, repositionIcon } from './ops/markup'
import { drawInnerWall, eraseCells, moveCellFragment, paintCells } from './ops/rooms'
import { fromJSON, toJSON } from './serialize'
import type { LoadEvent, LoadEventKind, LoadReport } from './serialize'
import type { MapModel, Room } from './types'
import {
  checkInvariants,
  makeRoom,
  ok,
  refusal,
  rect,
  setup,
  sorted,
  TEST_ICON_COLORS,
  tx,
} from './testUtils'

function eventsOf<K extends LoadEventKind>(
  report: LoadReport,
  kind: K,
): Extract<LoadEvent, { kind: K }>[] {
  return report.events.filter((event): event is Extract<LoadEvent, { kind: K }> => {
    return event.kind === kind
  })
}

function walls(room: Room): EdgeKey[] {
  return [...room.innerWalls.keys()].sort()
}

describe('a cell belongs to at most one room', () => {
  // The most load-bearing invariant in the model, at its only enforcement
  // point. Every ownership query, transition check and wall derivation reads
  // `cellOwner`; if it can disagree with `room.cells` then all three answer
  // from a room that does not own the cell they were asked about.

  it('refuses to give an owned cell to a second room', () => {
    const { project, map } = setup()
    const owner = makeRoom(project, map, ['0,0'])
    const other = makeRoom(project, map, ['5,5'])

    const steal = tx(map)
    expect(() => addCell(steal, map, other, '0,0')).toThrow(ModelError)
    // Named, not generic: the whole point of throwing here is that a caller
    // reaching this state has a bug, and the message has to be enough to find
    // it without a debugger.
    expect(() => addCell(tx(map), map, other, '0,0')).toThrow(owner.id)
  })

  it('leaves nothing behind when it refuses', () => {
    const { project, map } = setup()
    const owner = makeRoom(project, map, ['0,0'])
    const other = makeRoom(project, map, ['5,5'])

    const steal = tx(map)
    addCell(steal, map, other, '1,1')
    expect(() => addCell(steal, map, other, '0,0')).toThrow(ModelError)

    // The guard runs before `tx.record`, so the throw cannot leave a half-
    // applied entry on a transaction the caller is about to roll back.
    steal.rollback()
    expect(map.cellOwner.get('0,0')).toBe(owner.id)
    expect(sorted(other.cells)).toEqual(['5,5'])
    expect(map.cellOwner.has('1,1')).toBe(false)
    expect(checkInvariants(project)).toEqual([])
  })

  it('lets a room re-add a cell it lost, since ownership is released first', () => {
    // The guard is about contention, not whether the cell key was ever
    // used. An erase-then-repaint must still work.
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 1))

    const erase = tx(map)
    eraseCells(erase, project, map, ['1,0'])
    erase.commit()

    const repaint = tx(map)
    paintCells(repaint, project, map, ['1,0'], { areaId: WORLD_AREA_ID, intoRoomId: room.id })
    repaint.commit()

    expect(map.cellOwner.get('1,0')).toBe(room.id)
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('one teleport per cell, at load', () => {
  // The runtime enforces this at both ends of `createTeleport`. The load path
  // is where it matters most: a file is permanent, and the far-end index holds
  // exactly one entry per cell, so a second teleport landing on an occupied
  // cell silently displaces the first. The loser then round-trips for ever,
  // indexed and renderable nowhere.

  function linked(destination: CellKey) {
    const { project, map } = setup()
    const seed = tx()
    const second = addMap(seed, project, 'Map 2')
    seed.commit()
    makeRoom(project, map, ['0,0', '1,0'])
    makeRoom(project, second, ['5,5', '6,5'])

    const link = tx(map)
    ok(
      createTeleport(
        link,
        project,
        { mapId: map.id, cell: '0,0' },
        { mapId: second.id, cell: destination },
      ),
    )
    link.commit()
    return { project, map, second }
  }

  // Clones the file's only teleport, re-anchored, so the second entry is
  // well-formed in every way except the one under test.
  function withSecondTeleport(
    file: ReturnType<typeof toJSON>,
    from: [number, number],
    to: [number, number],
  ) {
    const transitions = file.project.maps[0].transitions
    const original = transitions[0]
    const geometry = original.geometry as { a: { mapId: string }; b: { mapId: string } }
    transitions.push({
      ...original,
      id: 'tr_second',
      geometry: {
        a: { mapId: geometry.a.mapId, cell: from },
        b: { mapId: geometry.b.mapId, cell: to },
      },
    })
    return file
  }

  it('drops a second teleport sharing an origin cell', () => {
    const { project } = linked('5,5')
    const file = withSecondTeleport(toJSON(project), [0, 0], [6, 5])

    const loaded = fromJSON(file)
    expect(eventsOf(loaded.report, 'transition-dropped')).toEqual([
      expect.objectContaining({ reason: 'teleport-exists' }),
    ])
    const first = loaded.project.mapsById.get(loaded.project.maps[0])!
    expect(first.transitions.size).toBe(1)
    expect(checkInvariants(loaded.project)).toEqual([])
  })

  it('drops a second teleport sharing a destination cell on another map', () => {
    // The harder half, and the reason the runtime check is at *both* ends:
    // the two entries look unrelated on the map that stores them, and the
    // collision only exists in `teleportFarEnds`, which holds one ref per cell.
    const { project } = linked('5,5')
    const file = withSecondTeleport(toJSON(project), [1, 0], [5, 5])

    const loaded = fromJSON(file)
    expect(eventsOf(loaded.report, 'transition-dropped')).toEqual([
      expect.objectContaining({ reason: 'teleport-exists' }),
    ])
    const first = loaded.project.mapsById.get(loaded.project.maps[0])!
    const second = loaded.project.maps[1]
    expect(first.transitions.size).toBe(1)
    // One survivor, one far-end entry, and they agree: the displacement this
    // rule prevents shows up here as a ref pointing at the dropped id.
    expect(loaded.project.teleportFarEnds.get(second)!.size).toBe(1)
    expect(checkInvariants(loaded.project)).toEqual([])
  })

  it('keeps both when they land on different cells', () => {
    // The negative control: a rule that rejects too much would pass both tests
    // above and quietly halve everyone's teleports on load.
    const { project } = linked('5,5')
    const file = withSecondTeleport(toJSON(project), [1, 0], [6, 5])

    const loaded = fromJSON(file)
    expect(eventsOf(loaded.report, 'transition-dropped')).toEqual([])
    expect(loaded.project.mapsById.get(loaded.project.maps[0])!.transitions.size).toBe(2)
    expect(checkInvariants(loaded.project)).toEqual([])
  })
})

describe('pruning inner walls off the changed cells only', () => {
  // An inner wall is valid only while strictly interior. `pruneInnerWalls`
  // takes a narrowed sweep when the edit is small. The optimisation that runs
  // on every pointer move of a drag was untested. A regression leaves a segment
  // on a non-interior edge: a hand-drawn outer wall, which can never exist,
  // and it serialises.

  // All twelve interior edges of a 3x3 at the origin.
  const NINE_SQUARE: EdgeKey[] = [
    '0,1,H',
    '0,2,H',
    '1,0,V',
    '1,1,H',
    '1,1,V',
    '1,2,H',
    '1,2,V',
    '2,0,V',
    '2,1,H',
    '2,1,V',
    '2,2,H',
    '2,2,V',
  ]

  function drawAll(map: MapModel, room: Room, edges: EdgeKey[]): void {
    const draw = tx(map)
    for (const edge of edges) ok(drawInnerWall(draw, map, room.id, edge, 'solid'))
    draw.commit()
    // Precondition for the branch under test: the fast path is taken when
    // `changed.size * 4 < innerWalls.size`. Asserted rather than assumed, so a
    // later edit to a fixture cannot quietly move a test onto the slow path.
    expect(room.innerWalls.size).toBe(edges.length)
  }

  it('drops exactly the walls around an erased interior cell', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 3))
    drawAll(map, room, NINE_SQUARE)
    expect(1 * 4).toBeLessThan(room.innerWalls.size)

    const erase = tx(map)
    eraseCells(erase, project, map, ['1,1'])
    erase.commit()

    // Erasing the middle of a 3x3 leaves a ring: still connected, so this is
    // a pure prune with no split to confuse it.
    const around = new Set(SIDES.map((side) => edgeOfCell('1,1', side)))
    expect(walls(room)).toEqual(NINE_SQUARE.filter((edge) => !around.has(edge)).sort())
    expect(checkInvariants(project)).toEqual([])
  })

  it('drops the wall behind a cell erased off the end of a strip', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 7, 1))
    drawAll(map, room, ['1,0,V', '2,0,V', '3,0,V', '4,0,V', '5,0,V', '6,0,V'])
    expect(1 * 4).toBeLessThan(room.innerWalls.size)

    const erase = tx(map)
    eraseCells(erase, project, map, ['6,0'])
    erase.commit()

    expect(walls(room)).toEqual(['1,0,V', '2,0,V', '3,0,V', '4,0,V', '5,0,V'])
    expect(checkInvariants(project)).toEqual([])
  })

  it('agrees with the full sweep when the edit is large', () => {
    // The two paths must be interchangeable. Same room, same walls, an erase
    // big enough to take the `changed.size * 4 >= innerWalls.size` branch.
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 3))
    drawAll(map, room, NINE_SQUARE)

    const erased = ['2,0', '2,1', '2,2']
    expect(erased.length * 4).toBeGreaterThanOrEqual(room.innerWalls.size)

    const erase = tx(map)
    eraseCells(erase, project, map, erased)
    erase.commit()

    // Everything anchored on the erased right-hand column goes; the 2x3
    // survivor keeps its own four.
    expect(walls(room)).toEqual(['0,1,H', '0,2,H', '1,0,V', '1,1,H', '1,1,V', '1,2,H', '1,2,V'])
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('a moved fragment carries only its strictly-interior walls', () => {
  // Only the `copyCells` twin was tested. A regression carries a wall whose
  // far cell was left behind, which lands an inner wall on an outer boundary
  // and persists it.
  //
  // The carry is a single implementation with no backstop: delete the
  // `carriedWalls` loop and every wall inside a dragged fragment is silently
  // lost. The drop is enforced four times over: the `grabbed.has(lo) &&
  // grabbed.has(hi)` filter, `mapEdge` refusing an edge with an unmapped end,
  // the `created.find` owner lookup, and `settleRooms`' unconditional prune.

  it('carries the interior wall, drops the straddler, leaves the donor its own', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 4, 1))
    const draw = tx(map)
    ok(drawInnerWall(draw, map, room.id, '1,0,V', 'solid'))
    ok(drawInnerWall(draw, map, room.id, '2,0,V', 'dotted'))
    ok(drawInnerWall(draw, map, room.id, '3,0,V', 'solid'))
    draw.commit()

    // Grab the right-hand pair and drop it five rows down. "2,0,V" straddles
    // the cut: (1,0) stays, (2,0) leaves.
    const move = tx(map)
    const [moved] = moveCellFragment(move, project, map, ['2,0', '3,0'], 0, 5)
    move.commit()

    expect(walls(room)).toEqual(['1,0,V'])
    expect(walls(moved)).toEqual(['3,5,V'])
    expect(moved.innerWalls.get('3,5,V')).toBe('solid')
    expect(checkInvariants(project)).toEqual([])
  })

  it('keeps the carried wall out of the donor as well', () => {
    // The straddler belongs to neither piece: it is an outer boundary on
    // both sides of the cut now.
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 2, 2))
    const draw = tx(map)
    ok(drawInnerWall(draw, map, room.id, '0,1,H', 'solid'))
    ok(drawInnerWall(draw, map, room.id, '1,0,V', 'solid'))
    draw.commit()

    const move = tx(map)
    const [moved] = moveCellFragment(move, project, map, ['0,0', '1,0'], 0, 6)
    move.commit()

    // "1,0,V" was interior to the grabbed row and travels; "0,1,H" straddled
    // the cut and is gone from both.
    expect(walls(moved)).toEqual(['1,6,V'])
    expect(walls(room)).toEqual([])
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('dragging an icon refuses before it destroys anything', () => {
  // The place path is tested; the drag path (the more frequent gesture)
  // was not. With `replace` off, a regression here destroys the icon you
  // dragged onto.

  function twoIcons() {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 3, 1))
    const place = tx(map)
    const dragged = ok(placeIcon(place, map, '0,0', 'save', TEST_ICON_COLORS))
    const sitting = ok(placeIcon(place, map, '2,0', 'boss', TEST_ICON_COLORS))
    place.commit()
    return { project, map, dragged, sitting }
  }

  it('refuses a drop outside any room', () => {
    const { project, map, dragged } = twoIcons()
    const drag = tx(map)
    expect(refusal(repositionIcon(drag, map, dragged.id, '9,9'))).toBe('not-in-a-room')
    expect(drag.isEmpty).toBe(true)
    drag.rollback()

    expect(dragged.cell).toBe('0,0')
    expect(checkInvariants(project)).toEqual([])
  })

  it('refuses a drop onto another icon, and that icon survives', () => {
    const { project, map, dragged, sitting } = twoIcons()
    const drag = tx(map)
    expect(refusal(repositionIcon(drag, map, dragged.id, '2,0'))).toBe('cell-occupied')
    // The refusal must precede the `removeIcon` that `replace` would trigger:
    // a refusal that has already destroyed something is the worst outcome
    // available here, because the gesture reports failure and the data is gone.
    expect(drag.isEmpty).toBe(true)
    drag.rollback()

    expect(map.icons.get(sitting.id)).toBeDefined()
    expect(map.iconAtCell.get('2,0')).toBe(sitting.id)
    expect(dragged.cell).toBe('0,0')
    expect(checkInvariants(project)).toEqual([])
  })

  it('replaces only when asked, and then destroys exactly one icon', () => {
    const { project, map, dragged, sitting } = twoIcons()
    const drag = tx(map)
    ok(repositionIcon(drag, map, dragged.id, '2,0', { replace: true }))
    drag.commit()

    expect(map.icons.has(sitting.id)).toBe(false)
    expect(map.iconAtCell.get('2,0')).toBe(dragged.id)
    expect(map.icons.size).toBe(1)
    expect(checkInvariants(project)).toEqual([])
  })

  it('does not refuse a drop onto the icon`s own cell', () => {
    // `iconAtCell` names the dragged icon itself here. Reading that as an
    // occupied cell would make a no-op drag fail; reading it as replaceable
    // would delete the icon being moved.
    const { project, map, dragged } = twoIcons()
    const drag = tx(map)
    ok(repositionIcon(drag, map, dragged.id, '0,0'))
    drag.commit()

    expect(map.icons.get(dragged.id)!.cell).toBe('0,0')
    expect(map.icons.size).toBe(2)
    expect(checkInvariants(project)).toEqual([])
  })
})
