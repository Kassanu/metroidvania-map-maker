import { describe, it, expect, vi } from 'vitest'
import { pushEscHandler, resolveEscape } from './escStack'

describe('escStack', () => {
  it('resolves to the highest-priority non-empty tier', () => {
    const selectionHandler = vi.fn()
    const dialogHandler = vi.fn()
    const popSelection = pushEscHandler('selection', selectionHandler)
    const popDialog = pushEscHandler('dialog', dialogHandler)

    expect(resolveEscape()).toBe(true)
    expect(dialogHandler).toHaveBeenCalledOnce()
    expect(selectionHandler).not.toHaveBeenCalled()

    popDialog()
    popSelection()
  })

  it('within a tier, resolves the most recently pushed handler', () => {
    const first = vi.fn()
    const second = vi.fn()
    const popFirst = pushEscHandler('gesture', first)
    const popSecond = pushEscHandler('gesture', second)

    resolveEscape()
    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()

    popSecond()
    popFirst()
  })

  it('returns false when nothing is registered', () => {
    expect(resolveEscape()).toBe(false)
  })

  it('pop removes exactly that handler', () => {
    const handler = vi.fn()
    const pop = pushEscHandler('armedIcon', handler)
    pop()
    expect(resolveEscape()).toBe(false)
  })
})
