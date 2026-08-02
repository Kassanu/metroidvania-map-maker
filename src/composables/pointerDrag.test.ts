import { describe, it, expect, beforeEach, vi } from 'vitest'
import { startPointerDrag } from './pointerDrag'

function pointerEvent(type: string, init: PointerEventInit = {}) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    ...init,
  })
}

describe('startPointerDrag', () => {
  let el: HTMLElement

  beforeEach(() => {
    el = document.createElement('div')
    document.body.append(el)
  })

  // clientY defaults to 0, which would blow a 'both'-axis dead zone from a
  // press at y=100. Moves that mean "horizontal only" say so explicitly.
  function move(init: PointerEventInit) {
    el.dispatchEvent(pointerEvent('pointermove', { clientY: 100, ...init }))
  }

  function press(init: PointerEventInit = {}, options = {}) {
    const event = pointerEvent('pointerdown', { clientX: 100, clientY: 100, ...init })
    Object.defineProperty(event, 'currentTarget', { value: el })
    return { accepted: startPointerDrag(event, options), event }
  }

  it('reports the travel since the press on every move', () => {
    const onMove = vi.fn()
    press({}, { onMove })

    el.dispatchEvent(pointerEvent('pointermove', { clientX: 150, clientY: 90 }))

    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onMove.mock.calls[0][0]).toMatchObject({ dx: 50, dy: -10, startX: 100, startY: 100 })
  })

  it('captures the pointer up front by default', () => {
    const capture = vi.spyOn(el, 'setPointerCapture')
    press()
    expect(capture).toHaveBeenCalledWith(1)
  })

  it('defers capture until the drag is confirmed when asked', () => {
    const capture = vi.spyOn(el, 'setPointerCapture')
    press({}, { deferCapture: true, deadZone: 5 })
    expect(capture).not.toHaveBeenCalled()

    move({ clientX: 102 }) // inside the dead zone
    expect(capture).not.toHaveBeenCalled()

    move({ clientX: 120 })
    expect(capture).toHaveBeenCalledWith(1)
  })

  it('holds onStart/onMove until the pointer leaves the dead zone', () => {
    const onStart = vi.fn()
    const onMove = vi.fn()
    press({}, { deadZone: 5, onStart, onMove })

    move({ clientX: 103 })
    expect(onStart).not.toHaveBeenCalled()
    expect(onMove).not.toHaveBeenCalled()

    move({ clientX: 130 })
    move({ clientX: 140 })
    expect(onStart).toHaveBeenCalledTimes(1) // once, not per move
    expect(onMove).toHaveBeenCalledTimes(2)
  })

  it('measures the dead zone on the requested axis only', () => {
    const onStart = vi.fn()
    press({}, { deadZone: 5, deadZoneAxis: 'x', onStart })

    el.dispatchEvent(pointerEvent('pointermove', { clientX: 100, clientY: 300 }))
    expect(onStart).not.toHaveBeenCalled()

    el.dispatchEvent(pointerEvent('pointermove', { clientX: 130, clientY: 300 }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('reports on release whether the press became a drag', () => {
    const onEnd = vi.fn()
    press({}, { deadZone: 5, onEnd })

    el.dispatchEvent(pointerEvent('pointerup', { clientX: 101, clientY: 100 }))
    expect(onEnd.mock.calls[0][0]).toMatchObject({ dragged: false })
  })

  it('ends on pointercancel too, and stops listening afterwards', () => {
    const onMove = vi.fn()
    const onEnd = vi.fn()
    press({}, { onMove, onEnd })

    el.dispatchEvent(pointerEvent('pointercancel'))
    expect(onEnd).toHaveBeenCalledTimes(1)

    el.dispatchEvent(pointerEvent('pointermove', { clientX: 200 }))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('ignores non-primary buttons by default', () => {
    const onMove = vi.fn()
    const { accepted } = press({ button: 2 }, { onMove })

    expect(accepted).toBe(false)
    el.dispatchEvent(pointerEvent('pointermove', { clientX: 200 }))
    expect(onMove).not.toHaveBeenCalled()
  })

  // What right-drag erase needs: a gesture that has already classified the
  // press says which button opened it, and gets the same capture-and-track it
  // would for a left drag.
  it('tracks a drag on a button the caller asked for', () => {
    const onMove = vi.fn()
    const onEnd = vi.fn()
    const { accepted } = press({ button: 2 }, { buttons: [2], onMove, onEnd })

    expect(accepted).toBe(true)
    move({ clientX: 200 })
    el.dispatchEvent(pointerEvent('pointerup', { clientX: 200, clientY: 100, button: 2 }))

    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('still rejects buttons outside the list it was given', () => {
    expect(press({ button: 1 }, { buttons: [0, 2] }).accepted).toBe(false)
    expect(press({ button: 0 }, { buttons: [2] }).accepted).toBe(false)
  })

  it('ignores a press with no resolvable target', () => {
    const event = pointerEvent('pointerdown')
    expect(startPointerDrag(event, { resolveTarget: () => null })).toBe(false)
  })
})
