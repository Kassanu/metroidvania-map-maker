// The operation table: what the liquid surface does under every edit that
// changes a room's shape.
//
// One describe per row of the table. No row is a rule of its own; every one
// falls out of the surface being a function of the room's current box, and of
// no operation ever rewriting the level. That is what these assert: the number
// stays put and the line moves, or does not, because the box did.
//
// Values are stated rather than computed from the room under test. A test that
// recomputed the formula would pass whatever the formula said.

import { describe, it, expect } from 'vitest'
import type { CellKey } from './cell'
import { liquidSurface } from './derive/liquid'
import { resizableRuns } from './derive/walls'
import { eraseCells, paintCells, resizeRun, setRoomLiquidLevel, transformRooms } from './ops/rooms'
import { WORLD_AREA_ID } from './ids'
import type { MapModel, ProjectModel, Room } from './types'
import { cellsOf, checkInvariants, grid, makeRoom, rect, setup, sorted, tx } from './testUtils'

function flooded(cells: CellKey[], level: number) {
  const { project, map } = setup()
  const room = makeRoom(project, map, cells)
  const raise = tx(map)
  setRoomLiquidLevel(raise, map, room.id, level)
  raise.commit()
  return { project, map, room }
}

function grow(project: ProjectModel, map: MapModel, room: Room, cells: CellKey[]): void {
  const paint = tx(map)
  paintCells(paint, project, map, cells, { areaId: WORLD_AREA_ID, intoRoomId: room.id })
  paint.commit()
}

function erase(project: ProjectModel, map: MapModel, cells: CellKey[]): void {
  const cut = tx(map)
  eraseCells(cut, project, map, cells)
  cut.commit()
}

describe('grow or erase vertically', () => {
  // The box changes height, so the same percentage lands somewhere else.

  it('moves the surface when a row is added below', () => {
    // Rows 0-3, so a bottom edge at 4 and half of a 4-row box is 2.
    const { project, map, room } = flooded(rect(0, 0, 2, 4), 50)
    expect(liquidSurface(room)).toBe(2)

    grow(project, map, room, rect(0, 4, 2, 1))
    // Rows 0-4: bottom edge 5, half of five rows is 2.5.
    expect(liquidSurface(room)).toBe(2.5)
    expect(room.liquidLevel).toBe(50)
  })

  it('takes the surface with the floor when the bottom row is erased', () => {
    const { project, map, room } = flooded(rect(0, 0, 2, 4), 50)
    expect(liquidSurface(room)).toBe(2)

    erase(project, map, rect(0, 3, 2, 1))
    // Rows 0-2: bottom edge 3, half of three rows is 1.5.
    expect(liquidSurface(room)).toBe(1.5)
    expect(room.liquidLevel).toBe(50)
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('grow or erase horizontally', () => {
  // The box's height is unchanged, so the surface holds. New cells below it
  // are filled and new cells above it are not, which is the clip doing the
  // work rather than anything here.

  it('holds the surface when a column is added beside', () => {
    const { project, map, room } = flooded(rect(0, 0, 2, 4), 25)
    expect(liquidSurface(room)).toBe(3)

    grow(project, map, room, rect(2, 0, 3, 4))
    expect(liquidSurface(room)).toBe(3)
  })

  it('holds the surface when a column is erased', () => {
    const { project, map, room } = flooded(rect(0, 0, 3, 4), 25)
    expect(liquidSurface(room)).toBe(3)

    erase(project, map, rect(2, 0, 1, 4))
    expect(liquidSurface(room)).toBe(3)
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('rotate', () => {
  // Transposes the box, so it is a height change. Discrete and not ghosted, so
  // there is no preview to check against and the assertion is on the model.

  it('lands the same percentage somewhere else', () => {
    // Cols 0-3, rows 0-1: bottom edge 2, a quarter of two rows is 0.5.
    const { project, map, room } = flooded(rect(0, 0, 4, 2), 25)
    expect(liquidSurface(room)).toBe(1.5)

    const spin = tx(map)
    transformRooms(spin, project, map, [room.id], 'rotateRight')
    spin.commit()

    // The box is re-centred as it transposes: cols 1-2, rows -1 to 2. Bottom
    // edge 3, and a quarter of four rows is 1.
    expect(sorted(room.cells)).toEqual(sorted(rect(1, -1, 2, 4)))
    expect(liquidSurface(room)).toBe(2)
    expect(room.liquidLevel).toBe(25)
  })
})

describe('flip horizontal', () => {
  it('changes nothing about the surface', () => {
    const { project, map, room } = flooded(rect(0, 0, 4, 2), 25)
    expect(liquidSurface(room)).toBe(1.5)

    const mirror = tx(map)
    transformRooms(mirror, project, map, [room.id], 'flipH')
    mirror.commit()

    expect(liquidSurface(room)).toBe(1.5)
  })
})

describe('flip vertical', () => {
  // The box is unchanged, so the surface holds, but the room's cells mirror
  // under it. Both halves matter: holding the line while the shape moves is
  // the whole content of this row.

  it('holds the line while the cells mirror beneath it', () => {
    // An inverted U, prongs down. Rows 0-2, so a bottom edge at 3, and a third
    // of three rows puts the line just inside the bottom row: what is under
    // water is the foot of each prong.
    const { project, map, room } = flooded(
      grid(`
        ###
        #.#
        #.#
      `),
      33,
    )
    const before = liquidSurface(room)!
    expect(before).toBeCloseTo(2.01, 10)
    expect(sorted(room.cells)).toEqual(sorted(['0,0', '1,0', '2,0', '0,1', '2,1', '0,2', '2,2']))

    const mirror = tx(map)
    transformRooms(mirror, project, map, [room.id], 'flipV')
    mirror.commit()

    // A cup now. The line has not moved, so the same band of the box is under
    // water; what changed is which cells are in it.
    expect(liquidSurface(room)).toBe(before)
    expect(sorted(room.cells)).toEqual(sorted(['0,0', '2,0', '0,1', '2,1', '0,2', '1,2', '2,2']))
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('resize', () => {
  // Treated as its cell changes are: a vertical resize moves the surface, a
  // horizontal one does not.

  it('moves the surface when the grabbed run is horizontal', () => {
    const { project, map, room } = flooded(rect(0, 0, 2, 4), 50)
    expect(liquidSurface(room)).toBe(2)

    const bottom = resizableRuns(room).find((run) => run.side === 'S')!
    const drag = tx(map)
    resizeRun(drag, project, map, room.id, bottom, 2)
    drag.commit()

    // Rows 0-5: bottom edge 6, half of six rows is 3.
    expect(cellsOf(room)).toEqual(sorted(rect(0, 0, 2, 6)))
    expect(liquidSurface(room)).toBe(3)
  })

  it('holds the surface when the grabbed run is vertical', () => {
    const { project, map, room } = flooded(rect(0, 0, 2, 4), 50)

    const side = resizableRuns(room).find((run) => run.side === 'E')!
    const drag = tx(map)
    resizeRun(drag, project, map, room.id, side, 2)
    drag.commit()

    expect(cellsOf(room)).toEqual(sorted(rect(0, 0, 4, 4)))
    expect(liquidSurface(room)).toBe(2)
    expect(checkInvariants(project)).toEqual([])
  })
})

describe('0 and 100 are fixed points under any shape change', () => {
  // The endpoints survive by construction, which is what removes the need for
  // separate dry and full states: the field is one integer with no null.

  it('keeps a flooded room flooded when it gains a ceiling', () => {
    const { project, map, room } = flooded(rect(0, 2, 2, 2), 100)
    expect(liquidSurface(room)).toBe(2)

    grow(project, map, room, rect(0, 0, 2, 2))
    // The top edge moved up with the new rows, and the surface went with it.
    expect(liquidSurface(room)).toBe(0)
  })

  it('keeps a dry room dry when it gains a floor', () => {
    const { project, map, room } = flooded(rect(0, 0, 2, 2), 0)
    expect(liquidSurface(room)).toBe(2)

    grow(project, map, room, rect(0, 2, 2, 2))
    expect(liquidSurface(room)).toBe(4)
    expect(checkInvariants(project)).toEqual([])
  })
})
