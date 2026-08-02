import { describe, it, expect, vi } from 'vitest'
import { dropIconAt, registerIconDropTarget } from './iconDropTarget'
import { ICONS } from '@/icons/registry'

const POINT = { clientX: 10, clientY: 20 }

describe('the icon drop target', () => {
  it('drops nothing when no canvas is mounted', () => {
    // A drag released with no target registered must not throw: the sidebar
    // exists in layouts the canvas does not.
    expect(dropIconAt(POINT, ICONS[0])).toBe(false)
  })

  it('hands the release point and the entry to whatever is registered', () => {
    const handler = vi.fn(() => true)
    const release = registerIconDropTarget(handler)

    expect(dropIconAt(POINT, ICONS[0])).toBe(true)
    expect(handler).toHaveBeenCalledWith(POINT, ICONS[0])
    release()
  })

  it('reports back whether the drop landed', () => {
    // The picker needs to know: a release off the canvas, or on a cell that
    // refuses the icon, is not a placement.
    const release = registerIconDropTarget(() => false)
    expect(dropIconAt(POINT, ICONS[0])).toBe(false)
    release()
  })

  it('empties on release, so a torn-down canvas is never called', () => {
    const handler = vi.fn(() => true)
    registerIconDropTarget(handler)()

    expect(dropIconAt(POINT, ICONS[0])).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  })

  it('keeps the newer target when one replaces another', () => {
    // There is one map canvas. A remount registers before the old one releases,
    // and the release must not then blank the live target.
    const first = vi.fn(() => true)
    const second = vi.fn(() => true)
    const releaseFirst = registerIconDropTarget(first)
    const releaseSecond = registerIconDropTarget(second)

    releaseFirst()
    dropIconAt(POINT, ICONS[0])

    expect(second).toHaveBeenCalled()
    expect(first).not.toHaveBeenCalled()
    releaseSecond()
  })
})
