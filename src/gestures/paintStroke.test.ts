import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { beginPaintStroke } from './paintStroke'
import type { CellStroke } from './cellStroke'
import { mapScope, useModelStore } from '@/stores/model'
import { pushEscHandler, resolveEscape } from '@/hotkeys/escStack'
import { paintCells } from '@/core/ops/rooms'
import { toJSON } from '@/core/serialize'
import { checkInvariants } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import { PROJECT_SCOPE } from '@/stores/model'
import { createNewArea } from '@/core/ops/project'
import { useDrawAreaStore } from '@/stores/drawArea'
import type { AreaId, MapId, RoomId } from '@/core/ids'
import type { MapModel } from '@/core/types'

// The gesture takes world points, where (1.5, 0.5) is the middle of cell (1,0).
// Aiming at cell centres keeps every test's arithmetic on the grid rather than
// on floating-point boundaries.
function centre(x: number, y: number) {
  return { x: x + 0.5, y: y + 0.5 }
}

describe('beginPaintStroke', () => {
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

  function press(x: number, y: number): CellStroke {
    const stroke = beginPaintStroke(firstMap().mapId, centre(x, y), onChange)
    expect(stroke).not.toBeNull()
    return stroke!
  }

  // A room painted outside any gesture, to paint into or over.
  function existingRoom(cells: string[]): RoomId {
    const model = useModelStore()
    const { mapId, map } = firstMap()
    return model.run('Setup', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, map, cells, { areaId: WORLD_AREA_ID }),
    ).id
  }

  function cellsOf(roomId: RoomId): string[] {
    return [...firstMap().map.rooms.get(roomId)!.cells].sort()
  }

  describe('the stroke', () => {
    // The first cell locks in on press, before any movement, so a click and a
    // drag are the same code path.
    it('paints the origin cell on press, before anything moves', () => {
      press(2, 3)
      expect(firstMap().map.cellOwner.get('2,3')).toBeDefined()
    })

    it('publishes nothing until release', () => {
      const model = useModelStore()
      const stroke = press(2, 3)

      expect(model.status.canUndo).toBe(false)
      expect(model.status.isDirty).toBe(false)

      stroke.commit()
      expect(model.status.canUndo).toBe(true)
      expect(model.status.undoLabel).toBe('Paint')
    })

    it('paints the union of every cell the drag crossed', () => {
      const stroke = press(0, 0)
      stroke.extendTo(centre(3, 0))
      stroke.commit()

      const roomId = firstMap().map.cellOwner.get('0,0')!
      expect(cellsOf(roomId)).toEqual(['0,0', '1,0', '2,0', '3,0'])
    })

    // A free-form path cannot cleanly invert, so the union only grows.
    it('does not un-paint on the way back', () => {
      const stroke = press(0, 0)
      stroke.extendTo(centre(3, 0))
      stroke.extendTo(centre(0, 0))
      stroke.commit()

      const roomId = firstMap().map.cellOwner.get('0,0')!
      expect(cellsOf(roomId)).toEqual(['0,0', '1,0', '2,0', '3,0'])
    })

    it('repaints only when the union actually grew', () => {
      const stroke = press(0, 0)
      onChange.mockClear()

      // Both land inside the origin cell.
      stroke.extendTo({ x: 0.6, y: 0.6 })
      stroke.extendTo({ x: 0.7, y: 0.7 })
      expect(onChange).not.toHaveBeenCalled()

      stroke.extendTo(centre(1, 0))
      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('grows the room it started in rather than making a new one', () => {
      const roomId = existingRoom(['0,0'])

      const stroke = press(0, 0)
      stroke.extendTo(centre(2, 0))
      stroke.commit()

      expect(firstMap().map.rooms.size).toBe(1)
      expect(cellsOf(roomId)).toEqual(['0,0', '1,0', '2,0'])
    })
  })

  describe('merge', () => {
    // Merge is whole-room and destructive: clipping one cell of B takes all of
    // B, which is why the ghost has to show it.
    it('absorbs a crossed room whole, not just the cells crossed', () => {
      const roomA = existingRoom(['0,0'])
      const roomB = existingRoom(['2,0', '2,1', '2,2'])

      const stroke = press(0, 0)
      stroke.extendTo(centre(2, 0))
      stroke.commit()

      expect(firstMap().map.rooms.has(roomB)).toBe(false)
      expect(cellsOf(roomA)).toEqual(['0,0', '1,0', '2,0', '2,1', '2,2'])
    })

    it('lets a stroke that started on empty grid absorb a room', () => {
      const roomB = existingRoom(['2,0'])

      const stroke = press(0, 0)
      stroke.extendTo(centre(2, 0))
      stroke.commit()

      expect(firstMap().map.rooms.has(roomB)).toBe(false)
      expect(firstMap().map.rooms.size).toBe(1)
    })

    // By the time anything draws, the absorbed room is already dissolved into
    // the origin room, and its cells are indistinguishable from cells picked
    // up off empty grid. The highlight has to be collected before the apply
    // that destroys it.
    it('reports the cells it is about to swallow, whole rooms at a time', () => {
      existingRoom(['0,0'])
      existingRoom(['2,0', '2,1', '2,2'])

      const stroke = press(0, 0)
      expect([...stroke.absorbing]).toEqual([])

      stroke.extendTo(centre(2, 0))
      expect([...stroke.absorbing].sort()).toEqual(['2,0', '2,1', '2,2'])
    })

    it('stops reporting them once the stroke settles', () => {
      existingRoom(['0,0'])
      existingRoom(['2,0'])

      const stroke = press(0, 0)
      stroke.extendTo(centre(2, 0))
      expect(stroke.absorbing.size).toBe(1)

      stroke.commit()
      expect(stroke.absorbing.size).toBe(0)
    })

    it('re-decides them on every re-apply rather than accumulating', () => {
      existingRoom(['0,0'])
      existingRoom(['5,0'])

      const stroke = press(0, 0)
      stroke.extendTo(centre(2, 0))
      expect(stroke.absorbing.size).toBe(0)

      stroke.extendTo(centre(5, 0))
      expect([...stroke.absorbing]).toEqual(['5,0'])
    })
  })

  describe('settling', () => {
    // A bare click on a room cell only sets the active room. There is no
    // active room yet, so it must cost nothing, and it does, for free, because
    // the transaction is empty and History drops those.
    it('leaves no undo step when the stroke changed no cell', () => {
      const model = useModelStore()
      existingRoom(['0,0', '1,0'])
      const steps = model.status.undoLabel

      const stroke = press(0, 0)
      stroke.extendTo(centre(1, 0))
      stroke.commit()

      expect(model.status.undoLabel).toBe(steps)
      expect(model.status.undoLabel).not.toBe('Paint')
    })

    it('commits the whole stroke as one undo step', () => {
      const model = useModelStore()
      const stroke = press(0, 0)
      for (let x = 1; x <= 10; x++) stroke.extendTo(centre(x, 0))
      stroke.commit()

      expect(firstMap().map.rooms.size).toBe(1)
      model.undo()
      expect(firstMap().map.rooms.size).toBe(0)
      expect(model.status.canUndo).toBe(false)
    })

    it('rolls back to the byte-identical project it started from', () => {
      const model = useModelStore()
      existingRoom(['4,4', '5,4'])
      const before = JSON.stringify(toJSON(model.project))

      const stroke = press(0, 0)
      // Five hundred moves, wandering over and through the existing room.
      for (let i = 0; i < 500; i++) {
        stroke.extendTo(centre(i % 9, Math.floor(i / 9) % 7))
      }
      expect(firstMap().map.rooms.size).toBe(1)

      stroke.cancel()
      expect(JSON.stringify(toJSON(model.project))).toBe(before)
      expect(checkInvariants(model.project)).toEqual([])
    })

    it('undoes a five-hundred-move stroke back to byte-identical too', () => {
      const model = useModelStore()
      existingRoom(['4,4', '5,4'])
      const before = JSON.stringify(toJSON(model.project))

      const stroke = press(0, 0)
      for (let i = 0; i < 500; i++) {
        stroke.extendTo(centre(i % 9, Math.floor(i / 9) % 7))
      }
      stroke.commit()
      expect(checkInvariants(model.project)).toEqual([])

      model.undo()
      expect(JSON.stringify(toJSON(model.project))).toBe(before)
    })

    // The reason `Transaction.reset()` rewinds its id source. Without it every
    // pointer move would create a differently identified room, and anything
    // holding on to one (a selection, the active room, a panel) would be
    // pointing at a room that no longer exists a frame later.
    it('keeps the created room at the same id across every re-apply', () => {
      const stroke = press(0, 0)
      const first = firstMap().map.cellOwner.get('0,0')

      for (let x = 1; x <= 20; x++) stroke.extendTo(centre(x, 0))
      expect(firstMap().map.cellOwner.get('0,0')).toBe(first)

      stroke.commit()
      expect(firstMap().map.cellOwner.get('0,0')).toBe(first)
    })

    it('is a no-op to commit after cancelling', () => {
      const model = useModelStore()
      const stroke = press(0, 0)
      stroke.cancel()
      stroke.commit()

      expect(model.status.canUndo).toBe(false)
      expect(firstMap().map.rooms.size).toBe(0)
    })
  })

  describe('Esc', () => {
    // Through the shared precedence stack's `gesture` tier, not a listener of
    // its own, so a dialog over the canvas swallows the same keypress instead
    // of both firing.
    it('aborts the stroke and commits nothing', () => {
      const model = useModelStore()
      const stroke = press(0, 0)
      stroke.extendTo(centre(3, 0))

      expect(resolveEscape()).toBe(true)
      expect(firstMap().map.rooms.size).toBe(0)
      expect(model.status.canUndo).toBe(false)
      expect(onChange).toHaveBeenCalled()
    })

    // Proved against a sentinel underneath rather than against an empty stack:
    // the tiers are module-global, so "nothing is registered" would be an
    // assertion about every other test in the file.
    it('unregisters itself once the stroke has settled', () => {
      const sentinel = vi.fn<() => void>()
      const pop = pushEscHandler('gesture', sentinel)

      const stroke = press(0, 0)
      stroke.commit()

      expect(resolveEscape()).toBe(true)
      expect(sentinel).toHaveBeenCalledTimes(1)
      pop()
    })

    it('leaves the eventual release harmless', () => {
      const model = useModelStore()
      const stroke = press(0, 0)
      stroke.extendTo(centre(3, 0))
      resolveEscape()

      // The user is still holding the button down; the pointerup still comes.
      stroke.extendTo(centre(4, 0))
      stroke.commit()

      expect(firstMap().map.rooms.size).toBe(0)
      expect(model.status.canUndo).toBe(false)
    })
  })

  // The area selected when a room is created is the one it gets. `paintCells`
  // reads the area only when it creates a room, so these pin that the gesture
  // passes the selection through rather than re-deriving that rule.
  describe('the area new rooms land in', () => {
    function selectNewArea(name = 'Caves'): AreaId {
      const model = useModelStore()
      const area = model.run('Add area', PROJECT_SCOPE, (tx) =>
        createNewArea(tx, model.project, name, '#336699', '#112233'),
      )
      useDrawAreaStore().select(area.id)
      return area.id
    }

    function areaOf(roomId: RoomId): AreaId {
      return firstMap().map.rooms.get(roomId)!.areaId
    }

    it('puts a new room in the selected area', () => {
      const caves = selectNewArea()

      const stroke = press(0, 0)
      stroke.extendTo(centre(2, 0))
      stroke.commit()

      const roomId = firstMap().map.cellOwner.get('0,0')!
      expect(areaOf(roomId)).toBe(caves)
    })

    it('defaults to World with nothing selected', () => {
      const stroke = press(0, 0)
      stroke.commit()

      expect(areaOf(firstMap().map.cellOwner.get('0,0')!)).toBe(WORLD_AREA_ID)
    })

    // Growing is not drawing a new room, so the room keeps its own area however
    // the picker is set. Otherwise every stroke would re-paper whatever it
    // touched.
    it('leaves an existing room in its own area when growing it', () => {
      const roomId = existingRoom(['0,0'])
      selectNewArea()

      const stroke = press(0, 0)
      stroke.extendTo(centre(3, 0))
      stroke.commit()

      expect(cellsOf(roomId)).toHaveLength(4)
      expect(areaOf(roomId)).toBe(WORLD_AREA_ID)
    })

    // Same for a merge: the origin room wins, and it wins with its own area.
    it('keeps the origin room’s area through a merge', () => {
      const origin = existingRoom(['0,0'])
      existingRoom(['3,0'])
      selectNewArea()

      const stroke = press(0, 0)
      stroke.extendTo(centre(3, 0))
      stroke.commit()

      expect(firstMap().map.rooms.size).toBe(1)
      expect(areaOf(origin)).toBe(WORLD_AREA_ID)
    })

    // The area is read per re-apply rather than captured at press. Nothing
    // accumulates from it, so there is no history to rewrite: the room simply
    // lands wherever the picker was on release.
    it('follows a selection changed mid-stroke', () => {
      const stroke = press(0, 0)
      stroke.extendTo(centre(1, 0))
      const caves = selectNewArea()
      stroke.extendTo(centre(2, 0))
      stroke.commit()

      expect(areaOf(firstMap().map.cellOwner.get('0,0')!)).toBe(caves)
    })
  })

  it('declines to start on a map that is not there', () => {
    expect(beginPaintStroke('map_gone' as MapId, centre(0, 0), onChange)).toBeNull()
  })
})
