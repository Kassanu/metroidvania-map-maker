import { describe, it, expect, afterEach } from 'vitest'
import {
  ERROR_DURATION,
  TOAST_DURATION,
  clearToasts,
  dismissToast,
  durationOf,
  notify,
  toasts,
} from './index'
import type { Toast } from './index'

// Module-level state, so every test clears it. This is what a store would have
// given for free, and the whole cost of not using one.
afterEach(() => clearToasts())

function raise(over: Partial<Toast> = {}): Toast {
  notify({ severity: 'info', bodyKey: 'update.body', ...over })
  return toasts.value[toasts.value.length - 1]
}

describe('the queue', () => {
  it('holds what was raised, oldest first', () => {
    notify({ severity: 'info', bodyKey: 'update.body' })
    notify({ severity: 'error', bodyKey: 'modal.export.failed', params: { message: 'disk full' } })

    expect(toasts.value.map((toast) => toast.severity)).toEqual(['info', 'error'])
    expect(toasts.value[1].params).toEqual({ message: 'disk full' })
  })

  it('gives every toast an id of its own', () => {
    const first = raise()
    const second = raise()
    expect(first.id).not.toBe(second.id)
  })

  it('takes a body with no title', () => {
    expect(raise().titleKey).toBeUndefined()
  })

  // The handle is the only way out for a sticky toast, which is what makes
  // sticky safe to offer at all.
  it('closes through the handle notify returned', () => {
    const kept = notify({ severity: 'info', bodyKey: 'update.body' })
    const closed = notify({ severity: 'info', bodyKey: 'update.title' })

    closed.dismiss()

    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].bodyKey).toBe('update.body')
    expect(kept).toBeDefined()
  })

  // Expiring on its own and being closed through the handle are the same
  // outcome to whoever raised it, so neither has to check the other first.
  it('treats a second dismissal of the same toast as already done', () => {
    const handle = notify({ severity: 'info', bodyKey: 'update.body' })
    handle.dismiss()
    expect(() => handle.dismiss()).not.toThrow()
    expect(toasts.value).toHaveLength(0)
  })

  it('leaves the others alone when one is dismissed by id', () => {
    const first = raise()
    const second = raise()
    dismissToast(first.id)
    expect(toasts.value.map((toast) => toast.id)).toEqual([second.id])
  })
})

describe('how long a toast stays', () => {
  it('expires on its own by default', () => {
    expect(durationOf(raise())).toBe(TOAST_DURATION)
  })

  // An error carries a message the user has to read and often cannot make
  // happen again.
  it('gives an error longer than an acknowledgement', () => {
    expect(durationOf(raise({ severity: 'error' }))).toBeGreaterThan(TOAST_DURATION)
    expect(durationOf(raise({ severity: 'error' }))).toBe(ERROR_DURATION)
  })

  it('never expires when it is sticky', () => {
    expect(durationOf(raise({ sticky: true }))).toBe(Number.POSITIVE_INFINITY)
  })

  it('keeps a sticky error sticky rather than giving it the error timeout', () => {
    expect(durationOf(raise({ severity: 'error', sticky: true }))).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('clearing', () => {
  it('empties the queue and restarts the ids, so a test can assert on one', () => {
    raise()
    raise()
    clearToasts()

    expect(toasts.value).toHaveLength(0)
    expect(raise().id).toBe(1)
  })
})
