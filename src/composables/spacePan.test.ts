import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useSpacePan } from './spacePan'

// A host component, because the composable registers on mount and releases on
// unmount: testing it without a lifecycle would test half of it.
function harness(options: { hasFocus?: () => boolean; isBusy?: () => boolean } = {}) {
  const state = { armed: false }
  const component = defineComponent({
    setup() {
      const { armed } = useSpacePan({
        hasFocus: options.hasFocus ?? (() => true),
        isBusy: options.isBusy,
      })
      return () => {
        state.armed = armed.value
        return h('div')
      }
    },
  })
  const wrapper = mount(component, { attachTo: document.body })
  return {
    wrapper,
    get armed() {
      return state.armed
    },
  }
}

function key(type: string, init: KeyboardEventInit & { target?: EventTarget } = {}) {
  const { target, ...rest } = init
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...rest })
  ;(target ?? window).dispatchEvent(event)
  return event
}

async function settle(wrapper: ReturnType<typeof harness>['wrapper']) {
  await wrapper.vm.$nextTick()
}

describe('Space arms the canvas for panning', () => {
  let host: ReturnType<typeof harness> | null = null

  beforeEach(() => {
    host = null
  })

  afterEach(() => {
    host?.wrapper.unmount()
  })

  it('arms on Space down and disarms on Space up', async () => {
    host = harness()
    expect(host.armed).toBe(false)

    key('keydown', { code: 'Space' })
    await settle(host.wrapper)
    expect(host.armed).toBe(true)

    key('keyup', { code: 'Space' })
    await settle(host.wrapper)
    expect(host.armed).toBe(false)
  })

  it('claims the key, so the page does not scroll under it', () => {
    host = harness()
    expect(key('keydown', { code: 'Space' }).defaultPrevented).toBe(true)
  })

  it('ignores every other key', async () => {
    host = harness()
    for (const code of ['KeyA', 'Enter', 'ShiftLeft', 'Escape']) {
      key('keydown', { code })
      await settle(host.wrapper)
      expect(host.armed, code).toBe(false)
    }
  })

  // The physical key, so a Space press is a Space press whatever the layout
  // puts on it and whatever `key` reports.
  it('reads the physical key rather than the character', async () => {
    host = harness()
    key('keydown', { code: 'Space', key: 'Unidentified' })
    await settle(host.wrapper)
    expect(host.armed).toBe(true)
  })

  // Auto-repeat fires keydown continuously while held. Arming is idempotent,
  // but the key must not be re-claimed on every repeat.
  it('ignores auto-repeat', () => {
    host = harness()
    expect(key('keydown', { code: 'Space', repeat: true }).defaultPrevented).toBe(false)
  })

  it('does not arm while the canvas has not got focus', async () => {
    host = harness({ hasFocus: () => false })
    const event = key('keydown', { code: 'Space' })
    await settle(host.wrapper)

    expect(host.armed).toBe(false)
    // Unclaimed, so a focused button still gets its Space.
    expect(event.defaultPrevented).toBe(false)
  })

  it('does not arm from a text field', async () => {
    host = harness()
    const input = document.createElement('input')
    document.body.append(input)

    const event = key('keydown', { code: 'Space', target: input })
    await settle(host.wrapper)

    expect(host.armed).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    input.remove()
  })

  it('does not arm in the middle of a gesture', async () => {
    host = harness({ isBusy: () => true })
    key('keydown', { code: 'Space' })
    await settle(host.wrapper)
    expect(host.armed).toBe(false)
  })

  // `keyup` is never delivered if the window loses focus mid-hold, so without
  // this the app comes back armed, with a hand cursor and no way to clear it.
  it('disarms when the window loses focus while held', async () => {
    host = harness()
    key('keydown', { code: 'Space' })
    await settle(host.wrapper)
    expect(host.armed).toBe(true)

    window.dispatchEvent(new Event('blur'))
    await settle(host.wrapper)
    expect(host.armed).toBe(false)
  })

  it('releases its listeners on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    harness().wrapper.unmount()

    const removed = remove.mock.calls.map(([type]) => type)
    expect(removed).toEqual(expect.arrayContaining(['keydown', 'keyup', 'blur']))
    remove.mockRestore()
  })
})
