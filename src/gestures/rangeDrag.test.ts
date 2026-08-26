import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia, mustStart } from '@/test-setup'
import { createRangeDrag } from './rangeDrag'
import { mapScope, useModelStore } from '@/stores/model'
import { repaintTick } from '@/canvas/repaint'
import { paintCells, setRoomLiquidLevel } from '@/core/ops/rooms'
import { WORLD_AREA_ID } from '@/core/ids'

// The driver on its own, with nothing mounted: what the journal holds after a
// drag, a keypress, a refusal and an abort.
//
// Every assertion here is about the undo stack rather than about the driver's
// own state, because the stack is what a wrong lifecycle actually damages. The
// fixture's own paint is labelled `Paint`, so "the stack is where it was" reads
// as that label coming back.

describe('createRangeDrag', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function setup() {
    const model = useModelStore()
    const mapId = model.project.maps[0]
    const roomId = model.run('Paint', mapScope(mapId), (tx) => {
      const map = model.project.mapsById.get(mapId)!
      return paintCells(tx, model.project, map, ['0,0', '0,1', '0,2'], {
        areaId: WORLD_AREA_ID,
      })!.id
    })

    const drag = createRangeDrag({
      mapId,
      label: 'Change Liquid Level',
      apply: (tx, value) =>
        setRoomLiquidLevel(tx, model.project.mapsById.get(mapId)!, roomId, value),
    })

    const level = () => model.project.mapsById.get(mapId)!.rooms.get(roomId)!.liquidLevel
    return { model, mapId, roomId, drag, level }
  }

  it('commits one entry for a whole drag, however many samples it took', () => {
    const { model, drag, level } = setup()

    drag.begin()
    drag.input(20)
    drag.input(40)
    drag.input(60)
    drag.end()

    expect(level()).toBe(60)
    expect(model.status.undoLabel).toBe('Change Liquid Level')

    // One entry: a single undo returns the whole drag, not its last sample.
    model.undo()
    expect(level()).toBe(0)
    expect(model.status.undoLabel).toBe('Paint')
  })

  // The transaction is empty, and an empty one is dropped. Nothing in the
  // driver checks for it.
  it('leaves no entry for a drag that came back to where it started', () => {
    const { model, drag, level } = setup()

    drag.begin()
    drag.input(30)
    drag.input(0)
    drag.end()

    expect(level()).toBe(0)
    expect(model.status.undoLabel).toBe('Paint')
  })

  // One finger on the canvas, one on the slider. The seam refuses the second
  // transaction, and the drag has to write nothing at all rather than fall
  // through to the keypress path, which would commit an entry per sample.
  it('writes nothing when the seam refuses the start', () => {
    const { model, mapId, drag, level } = setup()
    const held = mustStart(model.beginGesture('Held', mapScope(mapId)))

    drag.begin()
    drag.input(50)
    drag.input(70)
    drag.end()

    expect(level()).toBe(0)
    expect(model.status.undoLabel).toBe('Paint')
    // The gesture that was already live is untouched by the drag it refused.
    expect(model.gestureActive).toBe(true)
    held.commit()
  })

  // The refused drag outliving what refused it: the other finger comes up
  // first, and the samples still arriving belong to a drag that never started.
  // Nothing is live to refuse them by then, so the phase is the only thing
  // that knows they are not keypresses.
  it('goes on writing nothing after the gesture that refused it has gone', () => {
    const { model, mapId, drag, level } = setup()
    const held = mustStart(model.beginGesture('Held', mapScope(mapId)))

    drag.begin()
    // Committing an empty transaction is dropped, so the stack is still the
    // fixture's own paint and any entry below is the drag's.
    held.commit()
    expect(model.gestureActive).toBe(false)

    drag.input(50)
    drag.input(70)
    drag.end()

    expect(level()).toBe(0)
    expect(model.status.undoLabel).toBe('Paint')
  })

  it('commits nothing after Esc, including on the release that follows', () => {
    const { model, drag, level } = setup()

    drag.begin()
    drag.input(50)
    drag.cancel()

    expect(level()).toBe(0)

    drag.end()
    expect(level()).toBe(0)
    expect(model.status.undoLabel).toBe('Paint')
  })

  // Esc does not lift the finger, so the samples keep coming. Swallowing them
  // is the whole job of the dead phase: read as keypresses, they would commit
  // an entry each, one per pixel the pointer went on to cross.
  it('swallows the samples between Esc and the release', () => {
    const { model, drag, level } = setup()

    drag.begin()
    drag.input(50)
    drag.cancel()
    drag.input(60)
    drag.input(70)
    drag.end()

    expect(level()).toBe(0)
    expect(model.status.undoLabel).toBe('Paint')
  })

  // Esc with no drag under it: the phase has to stay where it was. Parked on
  // dead with no pointerup coming, it would swallow every arrow press after it.
  it('leaves the keyboard working after an Esc with no drag under it', () => {
    const { model, drag, level } = setup()

    drag.cancel()
    drag.input(25)

    expect(level()).toBe(25)
    expect(model.status.undoLabel).toBe('Change Liquid Level')
  })

  it('commits a keypress on its own, one entry per press', () => {
    const { model, drag, level } = setup()

    drag.input(10)
    drag.input(11)

    expect(level()).toBe(11)
    model.undo()
    expect(level()).toBe(10)
  })

  // `model.run` takes no lock, so a keypress alongside a canvas drag would open
  // a second transaction that the drag's next re-apply rewinds over.
  it('stands down for a keypress while another gesture holds the journal', () => {
    const { model, mapId, drag, level } = setup()
    const held = mustStart(model.beginGesture('Held', mapScope(mapId)))

    drag.input(25)

    expect(level()).toBe(0)
    expect(model.status.undoLabel).toBe('Paint')
    held.commit()
  })

  it('rolls back on abort, and the release that follows commits nothing', () => {
    const { model, drag, level } = setup()

    drag.begin()
    drag.input(70)
    drag.abort()

    expect(level()).toBe(0)
    expect(model.status.undoLabel).toBe('Paint')

    drag.end()
    expect(model.status.undoLabel).toBe('Paint')
  })

  // Nothing publishes mid-drag, so the canvas is repainted by asking rather
  // than by invalidating. The rollback needs it too: `cancel` deliberately does
  // not sync, so the canvas is still showing the speculative state.
  it('asks for a repaint on every speculative sample and on the rollback', () => {
    const { drag } = setup()
    const before = repaintTick.value

    drag.begin()
    drag.input(20)
    expect(repaintTick.value).toBe(before + 1)

    drag.input(40)
    expect(repaintTick.value).toBe(before + 2)

    drag.cancel()
    expect(repaintTick.value).toBe(before + 3)
  })

  // A committed change reaches the published counters, and the canvas repaints
  // from those. Asking as well would spend a second frame saying so.
  it('does not ask for a repaint when the change was committed', () => {
    const { drag } = setup()

    const beforeKey = repaintTick.value
    drag.input(30)
    expect(repaintTick.value).toBe(beforeKey)

    const beforeDrag = repaintTick.value
    drag.begin()
    drag.end()
    expect(repaintTick.value).toBe(beforeDrag)
  })
})
