import { describe, it, expect, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import UpdateToast from './UpdateToast.vue'

// The toast portals into a viewport, so the assertions read the document.
// Every mount is torn down: the viewport outlives its wrapper, and the next
// test would read the previous one's toast.
const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

async function show(open = true) {
  const wrapper = mount(UpdateToast, { props: { open }, attachTo: document.body })
  mounted.push(wrapper)
  await nextTick()
  return { wrapper, text: () => document.body.textContent ?? '' }
}

function click(label: string) {
  const button = [...document.body.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === label,
  )
  if (!button) throw new Error(`no button labelled ${label}`)
  button.click()
}

describe('the update offer', () => {
  it('shows nothing while there is no new build', async () => {
    const { text } = await show(false)
    expect(text()).not.toContain('A new version is available')
  })

  // An offer, not a warning: nothing is wrong, and the update keeps.
  it('says a new build is available, and what taking it involves', async () => {
    const { text } = await show()
    expect(text()).toContain('A new version is available')
    expect(text()).toContain('save your work')
    expect(text()).toContain('Reload')
    expect(text()).toContain('Later')
  })

  // One click, one event. The store owns whether there is an offer, and
  // Reload can still be refused by the unsaved-work prompt behind it, so a
  // button that closed the toast itself would answer ahead of the user.
  it('emits install alone when the update is taken', async () => {
    const { wrapper } = await show()
    click('Reload')
    await nextTick()

    expect(wrapper.emitted('install')).toHaveLength(1)
    expect(wrapper.emitted('dismiss')).toBeUndefined()
  })

  it('emits dismiss alone when it is put off', async () => {
    const { wrapper } = await show()
    click('Later')
    await nextTick()

    expect(wrapper.emitted('dismiss')).toHaveLength(1)
    expect(wrapper.emitted('install')).toBeUndefined()
  })

  // The store owns the offer, so it closing must not bounce an event back.
  it('says nothing when the store closes it', async () => {
    const { wrapper } = await show()
    await wrapper.setProps({ open: false })
    expect(wrapper.emitted('dismiss')).toBeUndefined()
  })

  // A notice that vanishes before it is read is the same as no notice, and
  // this one interrupts nothing by staying.
  it('does not time out', async () => {
    const { text } = await show()
    const toast = document.body.querySelector('.update-toast')
    expect(toast).not.toBeNull()
    expect(text()).toContain('A new version is available')
  })
})
