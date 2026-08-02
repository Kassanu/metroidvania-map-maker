import { describe, it, expect } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { beginIconDrag } from './iconDrag'
import { mapScope, useModelStore } from '@/stores/model'
import { placeIcon, repositionIcon } from '@/core/ops/markup'
import { paintCells } from '@/core/ops/rooms'
import { WORLD_AREA_ID } from '@/core/ids'
import { checkInvariants, ok, TEST_ICON_COLORS } from '@/core/testUtils'
import type { IconId, MapId } from '@/core/ids'
import type { CellKey } from '@/core/cell'

// Two rooms with a gap between them, so a drag can cross from one to the other
// and also pass over cells belonging to neither.
function setup() {
  setActivePinia(createTestPinia())
  const model = useModelStore()
  const mapId = model.project.maps[0]
  let icon!: IconId

  model.run('Setup', mapScope(mapId), (tx) => {
    const map = model.project.mapsById.get(mapId)!
    paintCells(tx, model.project, map, ['0,0', '1,0', '0,1', '1,1'], { areaId: WORLD_AREA_ID })
    paintCells(tx, model.project, map, ['4,0', '5,0'], { areaId: WORLD_AREA_ID })
    icon = ok(placeIcon(tx, map, '0,0', 'save', TEST_ICON_COLORS)).id
  })
  return { model, mapId, icon }
}

function mapOf(mapId: MapId) {
  return useModelStore().project.mapsById.get(mapId)!
}

function dragOf(mapId: MapId, iconId: IconId, from: CellKey, replace = false) {
  const map = mapOf(mapId)
  return beginIconDrag({
    mapId,
    from,
    label: 'Move Icon',
    onChange: () => {},
    apply: (tx, to) => {
      repositionIcon(tx, map, iconId, to, { replace })
    },
  })
}

describe('the icon drag', () => {
  it('moves the icon while the drag is live', () => {
    const { mapId, icon } = setup()
    const drag = dragOf(mapId, icon, '0,0')

    drag.moveTo('1,1')
    // Speculatively applied, so the map already shows the pending result.
    expect(mapOf(mapId).icons.get(icon)!.cell).toBe('1,1')
    expect(mapOf(mapId).iconAtCell.get('0,0')).toBeUndefined()

    drag.commit()
    expect(mapOf(mapId).icons.get(icon)!.cell).toBe('1,1')
  })

  it('carries the icon into another room, with ownership following the cell', () => {
    const { mapId, icon } = setup()
    const drag = dragOf(mapId, icon, '0,0')

    drag.moveTo('4,0')
    drag.commit()

    const map = mapOf(mapId)
    // The icon's room is derived from the cell, so nothing was re-parented and
    // no cascade ran: this is the opposite of Door mode's attachment rules.
    expect(map.icons.get(icon)!.cell).toBe('4,0')
    expect(map.cellOwner.get('4,0')).not.toBe(map.cellOwner.get('0,0'))
  })

  it('replaces the destination cell rather than accumulating a path', () => {
    const { mapId, icon } = setup()
    const drag = dragOf(mapId, icon, '0,0')

    // Every re-apply runs one reposition against the pristine model, so the
    // cells passed through leave no trace.
    drag.moveTo('1,0')
    drag.moveTo('1,1')
    drag.moveTo('0,1')
    drag.commit()

    expect(mapOf(mapId).icons.get(icon)!.cell).toBe('0,1')
    expect(mapOf(mapId).icons.size).toBe(1)
  })

  it('leaves no undo step when the drag returns to where it started', () => {
    const { model, mapId, icon } = setup()
    const before = model.status.undoLabel
    const drag = dragOf(mapId, icon, '0,0')

    drag.moveTo('1,1')
    drag.moveTo('0,0')
    drag.commit()

    // Out and back restores rather than reconstructs, so the transaction is
    // empty and the seam drops it.
    expect(mapOf(mapId).icons.get(icon)!.cell).toBe('0,0')
    expect(model.status.undoLabel).toBe(before)
  })

  it('refuses a cell outside every room, leaving the icon where it was', () => {
    const { mapId, icon } = setup()
    const drag = dragOf(mapId, icon, '0,0')

    // The gap between the two rooms. Icons must be inside one.
    drag.moveTo('3,0')
    expect(mapOf(mapId).icons.get(icon)!.cell).toBe('0,0')

    drag.commit()
    expect(mapOf(mapId).icons.get(icon)!.cell).toBe('0,0')
  })

  it('is blocked by an occupied cell until replace is on', () => {
    const { model, mapId, icon } = setup()
    let sitting!: IconId
    model.run('Second', mapScope(mapId), (tx) => {
      sitting = ok(placeIcon(tx, mapOf(mapId), '1,1', 'missile', TEST_ICON_COLORS)).id
    })

    const blocked = dragOf(mapId, icon, '0,0')
    blocked.moveTo('1,1')
    blocked.commit()
    expect(mapOf(mapId).icons.get(icon)!.cell).toBe('0,0')
    expect(mapOf(mapId).icons.has(sitting)).toBe(true)

    const replacing = dragOf(mapId, icon, '0,0', true)
    replacing.moveTo('1,1')
    replacing.commit()
    expect(mapOf(mapId).icons.get(icon)!.cell).toBe('1,1')
    expect(mapOf(mapId).icons.has(sitting)).toBe(false)
  })

  it('is one undo step for the whole drag', () => {
    const { model, mapId, icon } = setup()
    const drag = dragOf(mapId, icon, '0,0')

    drag.moveTo('1,0')
    drag.moveTo('4,0')
    drag.commit()

    model.undo()
    expect(mapOf(mapId).icons.get(icon)!.cell).toBe('0,0')
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('puts the icon back when cancelled mid-drag', () => {
    const { model, mapId, icon } = setup()
    const drag = dragOf(mapId, icon, '0,0')

    drag.moveTo('4,0')
    expect(mapOf(mapId).icons.get(icon)!.cell).toBe('4,0')

    drag.cancel()
    expect(mapOf(mapId).icons.get(icon)!.cell).toBe('0,0')
    expect(checkInvariants(model.project)).toEqual([])
  })
})
