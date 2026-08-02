import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { beginPaintStroke } from './paintStroke'
import { beginEraseStroke } from './eraseStroke'
import { mapScope, useModelStore } from '@/stores/model'
import { useToolsStore } from '@/stores/tools'
import { paintCells } from '@/core/ops/rooms'
import { checkInvariants } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { MapId } from '@/core/ids'
import type { MapModel } from '@/core/types'

// The brush is a wider footprint on the same free-form ghosted stroke, so what
// matters here is that the footprint reaches paint, grow and erase
// identically. The footprint's own geometry is tested in
// `canvas/brush.test.ts`; this is the seam between them.

function centre(x: number, y: number) {
  return { x: x + 0.5, y: y + 0.5 }
}

describe('brush footprint through a stroke', () => {
  const onChange = () => {}

  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function firstMap(): { mapId: MapId; map: MapModel } {
    const model = useModelStore()
    const mapId = model.project.maps[0]
    return { mapId, map: model.project.mapsById.get(mapId)! }
  }

  function paintedCells(): string[] {
    return [...firstMap().map.cellOwner.keys()].sort()
  }

  function existingRoom(cells: string[]) {
    const model = useModelStore()
    const { mapId, map } = firstMap()
    model.run('Setup', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, map, cells, { areaId: WORLD_AREA_ID }),
    )
  }

  describe('paint', () => {
    it('paints one footprint on a click', () => {
      useToolsStore().setBrushSize(3)

      const stroke = beginPaintStroke(firstMap().mapId, centre(5, 5), onChange)!
      stroke.commit()

      expect(paintedCells()).toHaveLength(9)
      expect(firstMap().map.rooms.size).toBe(1)
    })

    it('paints a swath the width of the brush on a drag', () => {
      useToolsStore().setBrushSize(3)

      const stroke = beginPaintStroke(firstMap().mapId, centre(1, 5), onChange)!
      stroke.extendTo(centre(4, 5))
      stroke.commit()

      // A 3-wide band, four cells long: rows 4-6, cols 0-5.
      expect(paintedCells()).toHaveLength(18)
      expect(firstMap().map.rooms.size).toBe(1)
    })

    it('grows the origin room by a footprint at a time', () => {
      existingRoom(['5,5'])
      useToolsStore().setBrushSize(3)

      const stroke = beginPaintStroke(firstMap().mapId, centre(5, 5), onChange)!
      stroke.commit()

      expect(firstMap().map.rooms.size).toBe(1)
      expect(paintedCells()).toHaveLength(9)
    })

    it('still commits as one undo step', () => {
      const model = useModelStore()
      useToolsStore().setBrushSize(4)

      const stroke = beginPaintStroke(firstMap().mapId, centre(5, 5), onChange)!
      for (let x = 6; x <= 12; x++) stroke.extendTo(centre(x, 5))
      stroke.commit()

      expect(model.status.undoLabel).toBe('Paint')
      model.undo()
      expect(firstMap().map.rooms.size).toBe(0)
      expect(checkInvariants(model.project)).toEqual([])
    })
  })

  describe('erase', () => {
    // Symmetric, Photoshop-style: the footprint applies to paint, grow and
    // erase alike.
    it('erases one footprint on a click', () => {
      existingRoom(['4,4', '5,4', '6,4', '4,5', '5,5', '6,5', '4,6', '5,6', '6,6', '8,8'])
      useToolsStore().setBrushSize(3)

      const stroke = beginEraseStroke(firstMap().mapId, centre(5, 5), onChange)!
      stroke.commit()

      expect(paintedCells()).toEqual(['8,8'])
    })

    it('uses the identical footprint paint does', () => {
      const size = 4
      const at = { x: 5.2, y: 5.8 }

      useToolsStore().setBrushSize(size)
      const paint = beginPaintStroke(firstMap().mapId, at, onChange)!
      paint.commit()
      const painted = paintedCells()
      expect(painted).toHaveLength(size * size)

      const erase = beginEraseStroke(firstMap().mapId, at, onChange)!
      erase.commit()

      expect(paintedCells()).toEqual([])
    })
  })

  describe('the size is locked at press', () => {
    // The union is re-applied from scratch on every move, so a live size would
    // silently re-stamp the whole stroke at the new width: the first half of a
    // drag would change retroactively. One stroke, one width.
    it('ignores a resize made mid-drag', () => {
      const tools = useToolsStore()
      tools.setBrushSize(1)

      const stroke = beginPaintStroke(firstMap().mapId, centre(5, 5), onChange)!
      tools.setBrushSize(5)
      stroke.extendTo(centre(7, 5))
      stroke.commit()

      expect(paintedCells()).toEqual(['5,5', '6,5', '7,5'])
    })

    it('picks up the new size on the next stroke', () => {
      const tools = useToolsStore()
      tools.setBrushSize(1)
      beginPaintStroke(firstMap().mapId, centre(0, 0), onChange)!.commit()

      tools.setBrushSize(3)
      beginPaintStroke(firstMap().mapId, centre(5, 5), onChange)!.commit()

      expect(paintedCells()).toHaveLength(10)
    })
  })

  describe('default', () => {
    it('is 1×1, so nothing changes until the brush is resized', () => {
      expect(useToolsStore().brushSize).toBe(1)

      const stroke = beginPaintStroke(firstMap().mapId, centre(5, 5), onChange)!
      stroke.extendTo(centre(7, 5))
      stroke.commit()

      expect(paintedCells()).toEqual(['5,5', '6,5', '7,5'])
    })
  })

  it('keeps a big brush over a long stroke consistent under invariants', () => {
    const model = useModelStore()
    useToolsStore().setBrushSize(6)

    const stroke = beginPaintStroke(firstMap().mapId, centre(0, 0), onChange)!
    for (let i = 0; i < 60; i++) stroke.extendTo(centre(i % 12, Math.floor(i / 12)))
    stroke.commit()

    expect(checkInvariants(model.project)).toEqual([])
  })
})
