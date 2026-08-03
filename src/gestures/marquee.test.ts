import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { beginMarquee, type Marquee } from './marquee'
import { mapScope, useModelStore } from '@/stores/model'
import { useSelectionStore } from '@/stores/selection'
import { pushEscHandler, resolveEscape } from '@/hotkeys/escStack'
import { paintCells } from '@/core/ops/rooms'
import { createLine, placeIcon } from '@/core/ops/markup'
import { ok, TEST_ICON_COLORS } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { MapId, RoomId } from '@/core/ids'
import type { MapModel } from '@/core/types'

// World points, where (1.5, 0.5) is the middle of cell (1, 0).
function centre(x: number, y: number) {
  return { x: x + 0.5, y: y + 0.5 }
}

describe('beginMarquee', () => {
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

  // Two 1x1 rooms four cells apart on row 0, so a band can take either, both or
  // neither, and bare grid separates them.
  function twoRooms() {
    return { left: room(['0,0']), right: room(['4,0']) }
  }

  const selection = () => useSelectionStore()

  const selectedRooms = () => selection().roomsOn(firstMap().mapId)

  // A whole drag, the way the component runs one: press, move, release.
  function sweep(from: [number, number], to: [number, number], additive = false): Marquee {
    const band = beginMarquee(firstMap().mapId, centre(...from), additive, onChange)
    expect(band).not.toBeNull()
    band!.moveTo(centre(...to))
    band!.commit()
    return band!
  }

  function begin(from: [number, number], additive = false): Marquee {
    const band = beginMarquee(firstMap().mapId, centre(...from), additive, onChange)
    expect(band).not.toBeNull()
    return band!
  }

  describe('the band', () => {
    it('draws nothing until it covers more than the cell it started in', () => {
      twoRooms()
      const band = begin([2, 2])

      expect(band.rect).toBeNull()
      // Still the same cell: a pointer moving inside one cell changes neither
      // what is drawn nor what would be selected.
      band.moveTo({ x: 2.9, y: 2.9 })
      expect(band.rect).toBeNull()
      expect(onChange).not.toHaveBeenCalled()

      band.moveTo(centre(3, 2))
      expect(band.rect).not.toBeNull()
      expect(onChange).toHaveBeenCalledTimes(1)
      band.cancel()
    })

    // Snapped to whole cells, so the drawn edge is exactly where the answer
    // changes. The far corner is the outside of the last cell covered.
    it('covers whole cells, from whichever corner the drag started', () => {
      const upLeft = begin([4, 3])
      upLeft.moveTo(centre(1, 1))

      expect(upLeft.rect).toEqual({ from: { x: 1, y: 1 }, to: { x: 5, y: 4 } })

      const downRight = begin([1, 1])
      downRight.moveTo(centre(4, 3))
      expect(downRight.rect).toEqual(upLeft.rect)
      upLeft.cancel()
      downRight.cancel()
    })

    it('shrinks when the pointer comes back, rather than keeping what it swept', () => {
      const band = begin([1, 1])

      band.moveTo(centre(6, 6))
      band.moveTo(centre(2, 2))

      expect(band.rect).toEqual({ from: { x: 1, y: 1 }, to: { x: 3, y: 3 } })
      band.cancel()
    })

    it('is gone once the gesture is over', () => {
      const band = begin([1, 1])
      band.moveTo(centre(4, 4))

      band.commit()

      expect(band.rect).toBeNull()
    })
  })

  describe('what it selects', () => {
    it('takes a room it touches, and leaves one it does not reach', () => {
      const { left } = twoRooms()

      sweep([0, 0], [2, 0])

      expect(selectedRooms()).toEqual([left])
    })

    // The locked rule: touching, not containment. The band covers one cell of
    // the room and stops.
    it('takes a whole room from one cell of it', () => {
      const wide = room(['0,0', '1,0', '2,0', '3,0'])

      sweep([3, 0], [3, 3])

      expect(selectedRooms()).toEqual([wide])
    })

    it('selects nothing when the drag comes back to where it started', () => {
      twoRooms()

      const band = begin([2, 2])
      band.moveTo(centre(6, 6))
      band.moveTo(centre(2, 2))
      band.commit()

      expect(selection().isEmpty).toBe(true)
    })

    // Rooms only, even for a band that covers the lot. Icons, lines and
    // transitions are reached by click and shift-click.
    it('ignores the icons and lines under it', () => {
      const model = useModelStore()
      const { mapId, map } = firstMap()
      const host = room(['0,0'])
      model.run('Setup', mapScope(mapId), (tx) => {
        ok(placeIcon(tx, map, '0,0', 'save', TEST_ICON_COLORS))
        ok(
          createLine(tx, map, ['3,3', '4,3'], {
            color: '#d9a441',
            arrowStart: false,
            arrowEnd: false,
          }),
        )
      })

      sweep([0, 0], [5, 5])

      expect(selection().selected).toEqual([{ kind: 'room', id: host }])
    })

    it('replaces the selection, so a second sweep does not accumulate', () => {
      const { left, right } = twoRooms()

      sweep([0, 0], [1, 0])
      sweep([4, 0], [5, 0])

      expect(selectedRooms()).toEqual([right])
      expect(selectedRooms()).not.toContain(left)
    })

    // Union, not toggle: a shift-sweep over a room that is already selected
    // leaves it selected, where a shift-click on it would remove it.
    it('unions with the selection when shift is held, keeping what is already there', () => {
      const { left, right } = twoRooms()

      sweep([0, 0], [1, 0])
      sweep([0, 0], [5, 0], true)

      expect(selectedRooms()).toEqual([left, right])
    })

    it('leaves a selection of another kind alone when it unions', () => {
      const model = useModelStore()
      const { mapId, map } = firstMap()
      const host = room(['0,0'])
      const icon = model.run('Setup', mapScope(mapId), (tx) =>
        ok(placeIcon(tx, map, '0,0', 'save', TEST_ICON_COLORS)),
      )
      selection().set([{ kind: 'icon', id: icon.id }], mapId)

      sweep([0, 0], [1, 0], true)

      expect(selection().selected).toEqual([
        { kind: 'icon', id: icon.id },
        { kind: 'room', id: host },
      ])
    })

    it('leaves no undo step behind, having changed no model', () => {
      const model = useModelStore()
      twoRooms()
      const before = model.status.undoLabel

      sweep([0, 0], [5, 5])

      expect(model.status.undoLabel).toBe(before)
    })
  })

  // The band registers in the `gesture` tier for the life of the drag. Without
  // it `Esc` would fall through to the selection tier, clear the selection the
  // user already had, and leave the band tracking the pointer.
  describe('Esc', () => {
    it('abandons the band and leaves the selection it started with', () => {
      const { mapId } = firstMap()
      const { left, right } = twoRooms()
      selection().set([{ kind: 'room', id: right }], mapId)

      const band = begin([0, 0])
      band.moveTo(centre(1, 1))
      expect(resolveEscape()).toBe(true)

      expect(band.rect).toBeNull()
      expect(selectedRooms()).toEqual([right])
      expect(selectedRooms()).not.toContain(left)
    })

    // The pointer keeps moving and the release is still coming, so both are
    // normal input after an abort rather than a caller bug.
    it('ignores the moves and the release that follow it', () => {
      const { right } = twoRooms()
      selection().set([{ kind: 'room', id: right }], firstMap().mapId)

      const band = begin([0, 0])
      band.moveTo(centre(1, 1))
      resolveEscape()

      band.moveTo(centre(5, 5))
      band.commit()

      expect(band.rect).toBeNull()
      expect(selectedRooms()).toEqual([right])
    })

    // The sentinel goes into the tier below and is only consulted after the
    // drag is over. A band that never let go of the gesture tier would swallow
    // this `Esc`, and the selection would be unclearable for the rest of the
    // session. Every test in this file settles its band for the same reason:
    // the tiers are module-global.
    it('hands the tier back when the drag ends, so the next Esc reaches the selection', () => {
      const deselect = vi.fn<() => void>()
      const { left } = twoRooms()
      const pop = pushEscHandler('selection', deselect)

      sweep([0, 0], [1, 1])
      expect(selectedRooms()).toEqual([left])
      resolveEscape()

      expect(deselect).toHaveBeenCalledTimes(1)
      pop()
    })

    // The other half of the same ordering: while the band is live it is above
    // the selection, so the first `Esc` is the band's alone.
    it('outranks the selection tier while the drag is live', () => {
      const deselect = vi.fn<() => void>()
      twoRooms()
      const band = begin([0, 0])
      band.moveTo(centre(1, 1))
      // Pushed after the band started, on its own tier: registering it first
      // would prove nothing, since a band wrongly registered in the selection
      // tier would then still be the later push and win on ordering alone.
      const pop = pushEscHandler('selection', deselect)

      resolveEscape()

      expect(deselect).not.toHaveBeenCalled()
      expect(band.rect).toBeNull()
      pop()
    })
  })

  it('starts nothing when the map is gone', () => {
    expect(beginMarquee('map_missing' as MapId, centre(0, 0), false, onChange)).toBeNull()
  })
})
