import { describe, it, expect, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import ToastRegion from './ToastRegion.vue'
import { ERROR_DURATION, TOAST_DURATION, clearToasts, notify, toasts } from '@/notify'

// The toasts teleport into the viewport, which outlives the wrapper, so the
// assertions read the document and every mount is torn down.
const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  clearToasts()
  vi.useRealTimers()
})

async function region() {
  const wrapper = mount(ToastRegion, { attachTo: document.body })
  mounted.push(wrapper)
  await nextTick()
  return wrapper
}

function text(): string {
  return document.body.textContent ?? ''
}

function click(selector: string) {
  const button = document.body.querySelector<HTMLButtonElement>(selector)
  if (!button) throw new Error(`no button matching ${selector}`)
  button.click()
}

describe('what a toast shows', () => {
  it('shows the body on its own when there is no title', async () => {
    await region()
    notify({ severity: 'info', bodyKey: 'update.body' })
    await nextTick()

    expect(text()).toContain('Please save your work')
    expect(document.body.querySelector('.toast-title')).toBeNull()
  })

  it('shows the title above the body when there is one', async () => {
    await region()
    notify({ severity: 'info', titleKey: 'update.title', bodyKey: 'update.body' })
    await nextTick()

    expect(document.body.querySelector('.toast-title')?.textContent).toContain(
      'A new version is available',
    )
  })

  it('fills the message placeholders from params', async () => {
    await region()
    notify({ severity: 'error', bodyKey: 'modal.export.failed', params: { message: 'disk full' } })
    await nextTick()

    expect(text()).toContain('disk full')
  })

  it('carries the severity as a class, so the accent comes off the token', async () => {
    await region()
    notify({ severity: 'warning', bodyKey: 'update.body' })
    await nextTick()

    expect(document.body.querySelector('.toast')?.classList).toContain('toast-warning')
  })

  it('stacks one element per message', async () => {
    await region()
    notify({ severity: 'info', bodyKey: 'update.body' })
    notify({ severity: 'success', bodyKey: 'update.title' })
    await nextTick()

    expect(document.body.querySelectorAll('.toast')).toHaveLength(2)
  })
})

describe('closing', () => {
  // The rule. Reka's own ToastAction closes before the handler runs, so an
  // action with a question behind it would lose the answer to a toast that had
  // already gone. #277 depends on this: refusing the unsaved-work prompt has
  // to leave the update offer standing.
  it('leaves the toast standing when an action is clicked', async () => {
    const onClick = vi.fn()
    await region()
    notify({
      severity: 'info',
      bodyKey: 'update.body',
      sticky: true,
      actions: [{ labelKey: 'update.reload', primary: true, onClick }],
    })
    await nextTick()

    click('.toast-action')
    await nextTick()

    expect(onClick).toHaveBeenCalledOnce()
    expect(toasts.value).toHaveLength(1)
    expect(document.body.querySelectorAll('.toast')).toHaveLength(1)
  })

  it('removes the toast when its close button is clicked', async () => {
    await region()
    notify({ severity: 'info', bodyKey: 'update.body', sticky: true })
    await nextTick()

    click('.toast-close')
    await nextTick()

    expect(toasts.value).toHaveLength(0)
    expect(document.body.querySelectorAll('.toast')).toHaveLength(0)
  })
})

describe('expiry', () => {
  it('drops a toast from the queue once its time is up', async () => {
    vi.useFakeTimers()
    await region()
    notify({ severity: 'info', bodyKey: 'update.body' })
    await nextTick()
    expect(toasts.value).toHaveLength(1)

    vi.advanceTimersByTime(TOAST_DURATION + 100)
    await nextTick()

    expect(toasts.value).toHaveLength(0)
  })

  it('keeps an error up longer than an acknowledgement', async () => {
    vi.useFakeTimers()
    await region()
    notify({ severity: 'error', bodyKey: 'update.body' })
    await nextTick()

    vi.advanceTimersByTime(TOAST_DURATION + 100)
    await nextTick()
    expect(toasts.value).toHaveLength(1)

    vi.advanceTimersByTime(ERROR_DURATION)
    await nextTick()
    expect(toasts.value).toHaveLength(0)
  })

  // A notice that vanishes before it is read is the same as no notice.
  it('never expires a sticky toast', async () => {
    vi.useFakeTimers()
    await region()
    notify({ severity: 'info', bodyKey: 'update.body', sticky: true })
    await nextTick()

    vi.advanceTimersByTime(ERROR_DURATION * 100)
    await nextTick()

    expect(toasts.value).toHaveLength(1)
  })
})

// Reka mounts the live region on a one-second timeout rather than with the
// toast, so these drive the clock past it before reading the document.
describe('what a screen reader hears', () => {
  async function announcement(severity: 'error' | 'success') {
    vi.useFakeTimers()
    await region()
    notify({ severity, bodyKey: 'update.body' })
    await nextTick()
    vi.advanceTimersByTime(1100)
    await nextTick()
    return document.body.querySelector('[role="alert"]')
  }

  it('announces an error assertively', async () => {
    expect((await announcement('error'))?.getAttribute('aria-live')).toBe('assertive')
  })

  it('announces an acknowledgement politely, so it does not cut across', async () => {
    expect((await announcement('success'))?.getAttribute('aria-live')).toBe('polite')
  })

  // The live region is built from the toast's own text content, so anything
  // rendered as a glyph gets spoken as one unless it opts out.
  it('leaves the close button out of what is read', async () => {
    expect((await announcement('success'))?.textContent).not.toContain('✕')
  })
})
