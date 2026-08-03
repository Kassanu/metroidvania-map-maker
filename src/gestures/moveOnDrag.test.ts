import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { movesOnDrag } from './moveOnDrag'
import { useSelectionStore } from '@/stores/selection'
import { mapScope, useModelStore } from '@/stores/model'
import { paintCells } from '@/core/ops/rooms'
import { WORLD_AREA_ID } from '@/core/ids'
import type { LineId } from '@/core/ids'

// The predicate itself. Which modes call it is each mode's own precedence
// suite: `drawPrecedence` and `doorPrecedence` both pin that theirs do not.
describe('movesOnDrag', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function paintRoom() {
    const model = useModelStore()
    const mapId = model.project.maps[0]
    const room = model.run('Paint', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, model.project.mapsById.get(mapId)!, ['0,0'], {
        areaId: WORLD_AREA_ID,
      }),
    )
    return { mapId, room }
  }

  it('is true only for a ref that is in the selection', () => {
    const selection = useSelectionStore()
    const { mapId, room } = paintRoom()

    expect(movesOnDrag({ kind: 'room', id: room.id })).toBe(false)

    selection.set([{ kind: 'room', id: room.id }], mapId)
    expect(movesOnDrag({ kind: 'room', id: room.id })).toBe(true)

    // Same string, different kind: not the same object.
    expect(movesOnDrag({ kind: 'line', id: room.id as unknown as LineId })).toBe(false)
  })

  // A press that found nothing has nothing to move, so it falls through to
  // whatever the mode's empty row does.
  it('is false for a press that resolved to no object', () => {
    expect(movesOnDrag(null)).toBe(false)
  })
})
