import { describe, it, expect, vi } from 'vitest'
import { beginCanvasPan } from './canvasPan'
import { MIDDLE_BUTTON, PRIMARY_BUTTON, SECONDARY_BUTTON } from './pointerDrag'
import { screenToWorld } from '@/canvas/viewport'
import type { Camera } from '@/canvas/camera'

const TILE = 32

function target() {
  const element = document.createElement('div')
  element.setPointerCapture = () => {}
  element.releasePointerCapture = () => {}
  return element
}

function press(element: HTMLElement, button: number, x: number, y: number) {
  const event = new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button,
    clientX: x,
    clientY: y,
  })
  // `currentTarget` is only set while an event is dispatching, and
  // `beginCanvasPan` reads it to decide what to capture on, so the press has to
  // be handed over from inside a real listener.
  let taken = false
  let spec: Parameters<typeof beginCanvasPan>[1]
  return {
    event,
    run(withSpec: Parameters<typeof beginCanvasPan>[1]) {
      spec = withSpec
      element.addEventListener('pointerdown', handler, { once: true })
      element.dispatchEvent(event)
      return taken
    },
  }
  function handler(e: Event) {
    taken = beginCanvasPan(e as PointerEvent, spec)
  }
}

function move(element: HTMLElement, x: number, y: number) {
  element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }))
}

function release(element: HTMLElement, x: number, y: number) {
  element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y }))
}

function panner(camera: Camera, buttons?: readonly number[]) {
  const element = target()
  const onPan = vi.fn<(camera: Camera) => void>()
  const onEnd = vi.fn<() => void>()
  const taken = press(element, buttons ? PRIMARY_BUTTON : MIDDLE_BUTTON, 100, 100).run({
    camera,
    tileSize: TILE,
    onPan,
    onEnd,
    buttons,
  })
  return { element, onPan, onEnd, taken }
}

const START: Camera = { pan: { x: 0, y: 0 }, zoom: 1 }

describe('canvas pan drag', () => {
  it('takes a middle press and reports it taken', () => {
    expect(panner(START).taken).toBe(true)
  })

  it('declines the primary and secondary buttons by default', () => {
    for (const button of [PRIMARY_BUTTON, SECONDARY_BUTTON]) {
      const element = target()
      const taken = press(element, button, 100, 100).run({
        camera: START,
        tileSize: TILE,
        onPan: () => {},
      })
      expect(taken).toBe(false)
    }
  })

  it('takes the primary button when asked for it', () => {
    expect(panner(START, [PRIMARY_BUTTON]).taken).toBe(true)
  })

  // The rule the sign falls out of, asserted as the thing the user sees rather
  // than as a direction: whatever you grabbed stays under the pointer.
  it.each([
    ['at 1:1', 1],
    ['zoomed in', 2.5],
    ['zoomed out', 0.4],
  ])('keeps the grabbed world point under the pointer, %s', (_name, zoom) => {
    const camera: Camera = { pan: { x: 3, y: -2 }, zoom }
    const grabbed = screenToWorld(100, 100, camera, TILE)

    const { element, onPan } = panner(camera)
    move(element, 160, 40)

    const after = onPan.mock.lastCall![0]
    const under = screenToWorld(160, 40, after, TILE)
    expect(under.x).toBeCloseTo(grabbed.x)
    expect(under.y).toBeCloseTo(grabbed.y)
  })

  // Every move applies the drag's total travel to the camera captured at press.
  // Applying each frame's delta to the live camera would land in the same place
  // here and drift under rounding, so the observable is that an intermediate
  // move does not change where the drag ends up.
  it('measures from the press, so intermediate moves do not accumulate', () => {
    const { element, onPan } = panner(START)

    move(element, 120, 130)
    move(element, 90, 80)
    move(element, 160, 40)

    const wandered = onPan.mock.lastCall![0]

    const direct = panner(START)
    move(direct.element, 160, 40)

    expect(wandered.pan).toEqual(direct.onPan.mock.lastCall![0].pan)
  })

  it('leaves the zoom alone', () => {
    const { element, onPan } = panner({ pan: { x: 0, y: 0 }, zoom: 2.5 })
    move(element, 160, 40)
    expect(onPan.mock.lastCall![0].zoom).toBe(2.5)
  })

  it('reports the end of the drag once, on release', () => {
    const { element, onEnd } = panner(START)
    expect(onEnd).not.toHaveBeenCalled()

    move(element, 160, 40)
    release(element, 160, 40)

    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  // A press that never moved is still a press that has to hand the cursor back.
  it('reports the end of a press that never became a drag', () => {
    const { element, onPan, onEnd } = panner(START)
    release(element, 100, 100)

    expect(onPan).not.toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('stops panning once released', () => {
    const { element, onPan } = panner(START)
    move(element, 160, 40)
    release(element, 160, 40)
    const calls = onPan.mock.calls.length

    move(element, 400, 400)
    expect(onPan.mock.calls.length).toBe(calls)
  })
})
