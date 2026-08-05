import { describe, it, expect, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import ConfirmUnsavedChanges from './ConfirmUnsavedChanges.vue'

// The dialog portals, so the assertions read the document. Every mount is torn
// down, because a portal outlives its wrapper and the next test would read the
// previous one's dialog.
const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

async function show(open = true) {
  const wrapper = mount(ConfirmUnsavedChanges, {
    props: { open, name: 'My Project' },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  await nextTick()
  return wrapper
}

function click(label: string) {
  const button = [...document.body.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === label,
  )
  if (!button) throw new Error(`no button labelled ${label}`)
  button.click()
}

describe('the unsaved-changes prompt', () => {
  it('names the project it is about to lose', async () => {
    await show()
    expect(document.body.textContent).toContain('Save changes to My Project?')
  })

  it('offers all three ways out', async () => {
    await show()
    const labels = [...document.body.querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(labels).toEqual(expect.arrayContaining(['Save', "Don't Save", 'Cancel']))
  })

  // The rule the whole guard rests on. Reka's own Action and Cancel close the
  // dialog on click, and the close fires before the button's handler, so a
  // dialog built from them emitted the dismissal first and the caller settled
  // on it: Save behaved as Cancel. One click, one choice, and that choice.
  for (const [label, choice] of [
    ['Save', 'save'],
    ["Don't Save", 'discard'],
    ['Cancel', 'cancel'],
  ] as const) {
    it(`emits ${choice} exactly once when ${label} is picked`, async () => {
      const wrapper = await show()
      click(label)
      await nextTick()

      expect(wrapper.emitted('choose')).toEqual([[choice]])
    })
  }

  // Escape and the overlay are the only things that still close it, and both
  // are the answer that loses nothing.
  it('treats Escape as cancel, so the caller is always answered', async () => {
    const wrapper = await show()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(wrapper.emitted('choose')).toEqual([['cancel']])
  })

  // The store owns the prompt, so it closing must not emit a second answer
  // over the one the user already gave.
  it('says nothing when the store closes it', async () => {
    const wrapper = await show()
    await wrapper.setProps({ open: false })
    expect(wrapper.emitted('choose')).toBeUndefined()
  })

  it('shows nothing while closed', async () => {
    await show(false)
    expect(document.body.textContent).not.toContain('Save changes to')
  })
})
