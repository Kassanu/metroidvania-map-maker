import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { beginInnerWallStroke, beginInnerWallErase } from './innerWallStroke'
import { mapScope, useModelStore } from '@/stores/model'
import { pushEscHandler, resolveEscape } from '@/hotkeys/escStack'
import { paintCells, eraseCells, resizeRun } from '@/core/ops/rooms'
import { isInnerWallEdge, resizableRuns } from '@/core/derive/walls'
import { edgeOfCell } from '@/core/cell'
import { toJSON } from '@/core/serialize'
import { checkInvariants } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { EdgeStroke } from './edgeStroke'
import type { EdgeKey } from '@/core/cell'
import type { MapId, RoomId } from '@/core/ids'
import type { MapModel, WallStyle } from '@/core/types'

// Vertices are world points on the integers: vertex (1,1) is the corner where
// cells (0,0), (1,0), (0,1) and (1,1) meet.
function vertex(x: number, y: number) {
  return { x, y }
}

describe('inner-wall strokes', () => {
  let onChange: Mock<() => void>

  beforeEach(() => {
    setActivePinia(createTestPinia())
    onChange = vi.fn<() => void>()
  })

  function firstMap(): { mapId: MapId; map: MapModel } {
    const model = useModelStore()
    const mapId = model.project.maps[0]
    return { mapId, map: model.project.mapsById.get(mapId)! }
  }

  function room(cells: string[]): RoomId {
    const model = useModelStore()
    const { mapId, map } = firstMap()
    return model.run('Setup', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, map, cells, { areaId: WORLD_AREA_ID }),
    ).id
  }

  // A 3x3, which is the smallest room with more than one interior vertex: they
  // are (1,1), (2,1), (1,2) and (2,2), a 2x2 lattice with four edges between
  // them. Every fixture below is this unless it says otherwise.
  function square3(): RoomId {
    return room(['0,0', '1,0', '2,0', '0,1', '1,1', '2,1', '0,2', '1,2', '2,2'])
  }

  function walls(roomId: RoomId): Map<EdgeKey, string> {
    return firstMap().map.rooms.get(roomId)!.innerWalls
  }

  function draw(
    roomId: RoomId,
    at: { x: number; y: number },
    style: WallStyle = 'solid',
    seed?: EdgeKey[],
  ) {
    const stroke = beginInnerWallStroke(firstMap().mapId, roomId, at, style, onChange, seed)
    expect(stroke).not.toBeNull()
    return stroke as EdgeStroke
  }

  function erase(roomId: RoomId, at: { x: number; y: number }, seed?: EdgeKey[]) {
    const stroke = beginInnerWallErase(firstMap().mapId, roomId, at, onChange, seed)
    expect(stroke).not.toBeNull()
    return stroke as EdgeStroke
  }

  describe('drawing', () => {
    // The edge between vertices (1,1) and (2,1) is the one dividing cells (1,0)
    // and (1,1), named through `edgeOfCell` rather than by key so the test says
    // which wall it means.
    const TOP_MIDDLE = edgeOfCell('1,0', 'S')

    it('draws a segment between two interior vertices', () => {
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      stroke.extendTo(vertex(2, 1))
      stroke.commit()

      expect([...walls(id)]).toEqual([[TOP_MIDDLE, 'solid']])
    })

    // A click on an interior vertex that never moved just sets the room
    // active, no wall. A wall needs two vertices, so an empty union is the
    // whole of it.
    it('draws nothing for a click that never moved', () => {
      const model = useModelStore()
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      stroke.commit()

      expect(walls(id).size).toBe(0)
      expect(model.status.undoLabel).toBe('Setup')
    })

    it('applies the style it was given', () => {
      const id = square3()
      const stroke = draw(id, vertex(1, 1), 'dotted')
      stroke.extendTo(vertex(2, 1))
      stroke.commit()

      expect(walls(id).get(TOP_MIDDLE)).toBe('dotted')
    })

    it('draws every segment a longer drag ran along', () => {
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      stroke.extendTo(vertex(2, 1))
      stroke.extendTo(vertex(2, 2))
      stroke.commit()

      expect(walls(id).size).toBe(2)
      expect(walls(id).has(TOP_MIDDLE)).toBe(true)
      expect(walls(id).has(edgeOfCell('1,1', 'E'))).toBe(true)
    })

    // Same free-form rule as a cell stroke, inherited from the shared driver.
    it('does not un-draw on the way back', () => {
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      stroke.extendTo(vertex(2, 1))
      stroke.extendTo(vertex(1, 1))
      stroke.commit()

      expect(walls(id).size).toBe(1)
    })

    it('repaints only when the union actually grew', () => {
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      onChange.mockClear()

      // Still nearest to (1,1): the same vertex, so no step.
      stroke.extendTo({ x: 1.2, y: 1.1 })
      expect(onChange).not.toHaveBeenCalled()

      stroke.extendTo(vertex(2, 1))
      expect(onChange).toHaveBeenCalledTimes(1)

      // Back over a wall already drawn.
      stroke.extendTo(vertex(1, 1))
      expect(onChange).toHaveBeenCalledTimes(1)
      stroke.cancel()
    })

    // A fast diagonal drag is one `extendTo` spanning two vertices. It has to
    // draw the staircase between them, because there is no edge on the
    // diagonal, and it has to draw the same one a slow drag would.
    it('draws a connected staircase for a diagonal drag', () => {
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      stroke.extendTo(vertex(2, 2))
      stroke.commit()

      expect(walls(id).size).toBe(2)
      expect(walls(id).has(edgeOfCell('1,0', 'S'))).toBe(true)
      expect(walls(id).has(edgeOfCell('1,1', 'E'))).toBe(true)
    })
  })

  describe('staying inside the room', () => {
    // The filter is the step's own edge: both cells it divides in the room.
    // A step is refused only where that fails, which is the room's outer
    // boundary, and outer walls are never drawable by hand.
    it('stops where the drag leaves the room', () => {
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      stroke.extendTo(vertex(1, 9)) // straight out through the floor and away

      // The union is asserted, not just the walls that resulted. Core refuses
      // an edge with a cell outside the room anyway, so a stroke that
      // accumulated illegal edges would still leave the same walls behind and
      // look correct from the outside. This assertion is what shows the
      // gesture never offered one, which is what makes core's refusal
      // unreachable rather than load-bearing.
      expect([...stroke.edges]).toEqual([edgeOfCell('0,1', 'E'), edgeOfCell('0,2', 'E')])

      stroke.commit()
      // Both steps inside the room, (1,1) -> (1,2) -> (1,3); the third leaves
      // it. The second is on the boundary ring, which the endpoint test lost.
      expect([...walls(id).keys()]).toEqual([edgeOfCell('0,1', 'E'), edgeOfCell('0,2', 'E')])
    })

    it('resumes from where the pointer is after wandering outside', () => {
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      stroke.extendTo(vertex(9, 9)) // right out of the room
      stroke.extendTo(vertex(2, 2)) // and back onto the lattice
      const outside = walls(id).size

      stroke.extendTo(vertex(1, 2))
      stroke.commit()

      // The step taken after coming back is drawn; the return journey itself
      // only draws where it crossed the room.
      expect(walls(id).has(edgeOfCell('1,1', 'S'))).toBe(true)
      expect(walls(id).size).toBeGreaterThan(outside)
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    // Every edge it offered is one core accepts. Asserted over a wild drag
    // rather than a chosen one, because the filter and core's rule being the
    // same sentence is the thing under test.
    it('never offers an edge core would refuse', () => {
      const id = square3()
      const room3 = firstMap().map.rooms.get(id)!
      const stroke = draw(id, vertex(1, 1))
      for (let i = -4; i <= 7; i++) {
        stroke.extendTo(vertex(i, 7 - i))
        stroke.extendTo(vertex(7 - i, i))
      }
      stroke.commit()

      expect(stroke.edges.size).toBeGreaterThan(0)
      for (const edge of stroke.edges) expect(isInnerWallEdge(room3, edge)).toBe(true)
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    // A room one cell thick has no interior vertex anywhere, so the endpoint
    // test made it permanently undrawable. The edge test does not care: the
    // step across the corridor divides two cells that are both in the room.
    //
    // Reaching this from the canvas needs a boundary vertex to press on, which
    // the zone resolver does not yet offer. The gesture is not what stands in
    // the way.
    it('draws across a corridor too thin to have an interior vertex', () => {
      const id = room(['0,0', '0,1'])
      const stroke = draw(id, vertex(0, 1))
      stroke.extendTo(vertex(1, 1))
      stroke.commit()

      expect([...walls(id).keys()]).toEqual([edgeOfCell('0,0', 'S')])
    })
  })

  // What a drag can reach, measured rather than reasoned about.
  //
  // With the edge test the answer is "every interior edge, from any starting
  // vertex", because a step that is refused still advances the drag: a drag
  // may wander anywhere and resume. So the reachable set is the drawable set,
  // and the numbers below are what the room's geometry allows.
  describe('reach', () => {
    // Serpentine over the whole lattice of the bounding box, rows then
    // columns, so every grid edge in it is stepped over at least once. Rows
    // cover the H steps and columns the V steps.
    function sweep(id: RoomId, start: { x: number; y: number }, size: number): Set<EdgeKey> {
      const stroke = draw(id, start)
      for (let y = 0; y <= size; y++) {
        for (let i = 0; i <= size; i++) {
          stroke.extendTo(vertex(y % 2 === 0 ? i : size - i, y))
        }
      }
      for (let x = 0; x <= size; x++) {
        for (let i = 0; i <= size; i++) {
          stroke.extendTo(vertex(x, x % 2 === 0 ? i : size - i))
        }
      }
      stroke.commit()
      return new Set(walls(id).keys())
    }

    function square(size: number): RoomId {
      const cells: string[] = []
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) cells.push(`${x},${y}`)
      return room(cells)
    }

    // 2n(n-1) interior edges in an n x n room. The endpoint test reached
    // 2(n-1)(n-2) of them, losing the whole ring of 4(n-1) next to the wall.
    it.each([
      [2, 4],
      [3, 12],
      [4, 24],
      [6, 60],
    ])('draws every interior edge of a square room of side %i (%i of them)', (size, expected) => {
      const id = square(size)
      const drawn = sweep(id, vertex(1, 1), size)

      expect(drawn.size).toBe(expected)
      const roomModel = firstMap().map.rooms.get(id)!
      for (const edge of drawn) expect(isInnerWallEdge(roomModel, edge)).toBe(true)
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })

    // An L, one cell thick in both arms: three down the left, four across the
    // bottom. Nothing in it is an interior vertex, so the endpoint test drew
    // nothing at all here; the edge test draws all five of its interior edges.
    it('draws every interior edge of a one-thick L', () => {
      const id = room(['0,0', '0,1', '0,2', '1,2', '2,2', '3,2'])
      const drawn = sweep(id, vertex(0, 1), 4)

      expect([...drawn].sort()).toEqual(
        [
          edgeOfCell('0,0', 'S'),
          edgeOfCell('0,1', 'S'),
          edgeOfCell('0,2', 'E'),
          edgeOfCell('1,2', 'E'),
          edgeOfCell('2,2', 'E'),
        ].sort(),
      )
      expect(checkInvariants(useModelStore().project)).toEqual([])
    })
  })

  describe('re-styling', () => {
    const TOP_MIDDLE = edgeOfCell('1,0', 'S')

    // Re-styling by drawing over an existing segment needs no branch:
    // `drawInnerWall` sets the style whatever was there, so drawing over is
    // the same call as drawing new.
    it('replaces the style of a segment drawn over', () => {
      const id = square3()
      const first = draw(id, vertex(1, 1))
      first.extendTo(vertex(2, 1))
      first.commit()
      expect(walls(id).get(TOP_MIDDLE)).toBe('solid')

      const second = draw(id, vertex(1, 1), 'doorway')
      second.extendTo(vertex(2, 1))
      second.commit()

      expect(walls(id).size).toBe(1)
      expect(walls(id).get(TOP_MIDDLE)).toBe('doorway')
    })

    // A press on a segment seeds the union with it, so re-styling one wall
    // does not require dragging to the next vertex first.
    it('re-styles the pressed segment without moving', () => {
      const id = square3()
      const first = draw(id, vertex(1, 1))
      first.extendTo(vertex(2, 1))
      first.commit()

      const restyle = draw(id, vertex(1, 1), 'dotted', [TOP_MIDDLE])
      restyle.commit()

      expect(walls(id).get(TOP_MIDDLE)).toBe('dotted')
    })

    it('leaves no undo step when the style drawn over is the same one', () => {
      const model = useModelStore()
      const id = square3()
      const first = draw(id, vertex(1, 1))
      first.extendTo(vertex(2, 1))
      first.commit()
      const before = model.status.undoLabel

      const again = draw(id, vertex(1, 1), 'solid', [TOP_MIDDLE])
      again.extendTo(vertex(2, 1))
      again.commit()

      expect(model.status.undoLabel).toBe(before)
    })
  })

  describe('erasing', () => {
    const TOP_MIDDLE = edgeOfCell('1,0', 'S')

    function withWall(): RoomId {
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      stroke.extendTo(vertex(2, 1))
      stroke.commit()
      return id
    }

    // Erase on a segment deletes the segment, not the cell.
    it('deletes the pressed segment', () => {
      const id = withWall()
      const stroke = erase(id, vertex(1, 1), [TOP_MIDDLE])
      stroke.commit()

      expect(walls(id).size).toBe(0)
      // The cells are untouched: erasing a segment is not erasing a cell.
      expect(firstMap().map.rooms.get(id)!.cells.size).toBe(9)
    })

    it('deletes every segment a drag ran along', () => {
      const id = square3()
      const drawn = draw(id, vertex(1, 1))
      drawn.extendTo(vertex(2, 1))
      drawn.extendTo(vertex(2, 2))
      drawn.commit()
      expect(walls(id).size).toBe(2)

      const stroke = erase(id, vertex(1, 1), [TOP_MIDDLE])
      stroke.extendTo(vertex(2, 1))
      stroke.extendTo(vertex(2, 2))
      stroke.commit()

      expect(walls(id).size).toBe(0)
    })

    it('leaves no undo step for a drag across bare lattice', () => {
      const model = useModelStore()
      const id = square3()
      const before = model.status.undoLabel

      const stroke = erase(id, vertex(1, 1))
      stroke.extendTo(vertex(2, 2))
      stroke.commit()

      expect(model.status.undoLabel).toBe(before)
    })
  })

  describe('the room edits underneath', () => {
    // A wall is valid only while strictly interior; any edit that breaks this
    // deletes the segment automatically. That is core's job: this proves the
    // gesture leaves it to core rather than caching anything that would
    // survive.
    it('loses a wall whose cell was erased away', () => {
      const model = useModelStore()
      const { mapId, map } = firstMap()
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      stroke.extendTo(vertex(2, 1))
      stroke.commit()
      expect(walls(id).size).toBe(1)

      model.run('Erase', mapScope(mapId), (tx) => eraseCells(tx, model.project, map, ['1,0']))

      expect(walls(id).size).toBe(0)
      expect(checkInvariants(model.project)).toEqual([])
    })

    it('loses a wall a resize shrank past', () => {
      const model = useModelStore()
      const { mapId, map } = firstMap()
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      stroke.extendTo(vertex(2, 1))
      stroke.commit()

      const run = resizableRuns(map.rooms.get(id)!).find((r) => r.side === 'N')!
      model.run('Shrink', mapScope(mapId), (tx) => resizeRun(tx, model.project, map, id, run, -1))

      expect(walls(id).size).toBe(0)
      expect(checkInvariants(model.project)).toEqual([])
    })
  })

  describe('settling', () => {
    it('publishes nothing until release', () => {
      const model = useModelStore()
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      stroke.extendTo(vertex(2, 1))

      expect(walls(id).size).toBe(1) // the canvas already shows it
      expect(model.status.undoLabel).toBe('Setup')

      stroke.commit()
      expect(model.status.undoLabel).toBe('Draw Inner Wall')
    })

    it('labels an erase separately', () => {
      const model = useModelStore()
      const id = square3()
      const drawn = draw(id, vertex(1, 1))
      drawn.extendTo(vertex(2, 1))
      drawn.commit()

      const stroke = erase(id, vertex(1, 1), [edgeOfCell('1,0', 'S')])
      stroke.commit()
      expect(model.status.undoLabel).toBe('Erase Inner Wall')
    })

    it('commits the whole drag as one undo step', () => {
      const model = useModelStore()
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      stroke.extendTo(vertex(2, 1))
      stroke.extendTo(vertex(2, 2))
      stroke.extendTo(vertex(1, 2))
      stroke.commit()
      expect(walls(id).size).toBe(3)

      model.undo()
      expect(walls(id).size).toBe(0)
    })

    it('rolls back to the byte-identical project it started from', () => {
      const model = useModelStore()
      const id = square3()
      const before = JSON.stringify(toJSON(model.project))

      const stroke = draw(id, vertex(1, 1), 'dotted')
      for (let i = 0; i < 200; i++) {
        stroke.extendTo(vertex(1 + (i % 2), 1 + (Math.floor(i / 2) % 2)))
      }
      expect(walls(id).size).toBeGreaterThan(0)

      stroke.cancel()
      expect(JSON.stringify(toJSON(model.project))).toBe(before)
      expect(checkInvariants(model.project)).toEqual([])
    })

    it('is a no-op to commit after cancelling', () => {
      const model = useModelStore()
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      stroke.extendTo(vertex(2, 1))
      stroke.cancel()
      stroke.commit()

      expect(walls(id).size).toBe(0)
      expect(model.status.undoLabel).toBe('Setup')
    })
  })

  describe('Esc', () => {
    it('aborts the stroke and commits nothing', () => {
      const model = useModelStore()
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      stroke.extendTo(vertex(2, 1))
      expect(walls(id).size).toBe(1)

      expect(resolveEscape()).toBe(true)
      expect(walls(id).size).toBe(0)
      expect(model.status.undoLabel).toBe('Setup')
      expect(onChange).toHaveBeenCalled()
    })

    // Against a sentinel underneath rather than an empty stack: the tiers are
    // module-global, so "nothing is registered" would be an assertion about
    // every other test in the file. Which is also why every test here settles.
    it('unregisters itself once the stroke has settled', () => {
      const sentinel = vi.fn<() => void>()
      const pop = pushEscHandler('gesture', sentinel)

      const id = square3()
      draw(id, vertex(1, 1)).commit()

      expect(resolveEscape()).toBe(true)
      expect(sentinel).toHaveBeenCalledTimes(1)
      pop()
    })

    // The sentinel goes in after the stroke has started, on its own tier:
    // registering it first would prove nothing, because a stroke wrongly in the
    // selection tier would still be the later push and still win on ordering.
    it('aborts ahead of anything in a lower tier', () => {
      const deselect = vi.fn<() => void>()
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      const pop = pushEscHandler('selection', deselect)

      resolveEscape()

      expect(deselect).not.toHaveBeenCalled()
      pop()
      stroke.commit()
    })

    it('leaves the eventual release harmless', () => {
      const model = useModelStore()
      const id = square3()
      const stroke = draw(id, vertex(1, 1))
      stroke.extendTo(vertex(2, 1))
      resolveEscape()

      // The user is still holding the button down; the pointerup still comes.
      stroke.extendTo(vertex(2, 2))
      stroke.commit()

      expect(walls(id).size).toBe(0)
      expect(model.status.undoLabel).toBe('Setup')
    })
  })

  it('declines to start when the map or the room is gone', () => {
    const id = square3()
    expect(
      beginInnerWallStroke('map_gone' as MapId, id, vertex(1, 1), 'solid', onChange),
    ).toBeNull()
    expect(
      beginInnerWallStroke(
        firstMap().mapId,
        'room_gone' as RoomId,
        vertex(1, 1),
        'solid',
        onChange,
      ),
    ).toBeNull()
    expect(
      beginInnerWallErase(firstMap().mapId, 'room_gone' as RoomId, vertex(1, 1), onChange),
    ).toBeNull()
  })
})
