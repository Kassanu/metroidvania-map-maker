import { describe, it, expect, vi } from 'vitest'
import { registerAction, runAction } from './actions'

describe('actions registry', () => {
  it('runs the registered handler for an action', () => {
    const handler = vi.fn()
    const unregister = registerAction('undo', handler)
    expect(runAction('undo')).toBe(true)
    expect(handler).toHaveBeenCalledOnce()
    unregister()
  })

  it('returns false when nothing is registered', () => {
    expect(runAction('save')).toBe(false)
  })

  it('unregister removes the handler', () => {
    const handler = vi.fn()
    const unregister = registerAction('redo', handler)
    unregister()
    expect(runAction('redo')).toBe(false)
  })

  it('unregistering a stale (overwritten) registration does not remove the newer one', () => {
    const first = vi.fn()
    const second = vi.fn()
    const unregisterFirst = registerAction('copy', first)
    const unregisterSecond = registerAction('copy', second)

    unregisterFirst()
    expect(runAction('copy')).toBe(true)
    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()

    unregisterSecond()
  })
})
