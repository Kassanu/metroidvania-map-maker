import { describe, it, expect, vi } from 'vitest'
import { repaintTick, requestRepaint } from './repaint'

describe('the repaint tick', () => {
  it('moves when a repaint is requested', () => {
    const before = repaintTick.value
    requestRepaint()
    expect(repaintTick.value).not.toBe(before)
  })

  // Monotonic rather than a toggle, and never reset: a watch records the
  // current value when it starts, so anything that starts watching between two
  // requests must still see the next one.
  it('moves again on a second request', () => {
    const before = repaintTick.value
    requestRepaint()
    const once = repaintTick.value
    requestRepaint()

    expect(once).not.toBe(before)
    expect(repaintTick.value).not.toBe(once)
  })

  // The compile-time half is the load-bearing one: exporting the bare ref
  // instead of the computed makes the directive below unused, which fails
  // type-check. A setter-less computed only warns at runtime, so the assertion
  // that follows cannot tell the rule from its absence on its own.
  it('is published read-only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = repaintTick.value

    // @ts-expect-error the tick is published read-only
    repaintTick.value = before + 100

    expect(repaintTick.value).toBe(before)
    warn.mockRestore()
  })
})
