import { describe, it, expect, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import RecoveryOffer from './RecoveryOffer.vue'
import type { SnapshotInfo } from '@/storage'

// The dialog portals, so the assertions read the document. Every mount is torn
// down, because a portal outlives its wrapper and the next test would read the
// previous one's dialog.
const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

function snapshot(over: Partial<SnapshotInfo> = {}): SnapshotInfo {
  return {
    key: 'proj_a',
    savedAt: Date.parse('2026-08-04T15:04:00Z'),
    projectName: 'Sunken City',
    fileName: 'sunken-city.mvm',
    ...over,
  }
}

// Awaited because the portal lands a tick after the mount, so reading the
// document synchronously sees an empty body whatever the props said.
async function show(snapshots: SnapshotInfo[]) {
  const wrapper = mount(RecoveryOffer, { props: { snapshots }, attachTo: document.body })
  mounted.push(wrapper)
  await nextTick()
  return { wrapper, text: () => document.body.textContent ?? '' }
}

function rowButtons(label: string): HTMLButtonElement[] {
  return [...document.body.querySelectorAll('button')].filter(
    (element) => element.textContent?.trim() === label,
  )
}

describe('the recovery offer', () => {
  it('shows nothing when a session left nothing behind', async () => {
    const { text } = await show([])
    expect(text()).not.toContain('Recover unsaved work?')
  })

  // Enough to tell one snapshot from another without opening it, which is the
  // whole reason the metadata is stored beside the payload.
  it('names the project, the file it came from, and when it was taken', async () => {
    const { text } = await show([snapshot()])
    expect(text()).toContain('Sunken City')
    expect(text()).toContain('sunken-city.mvm')
    expect(text()).toContain(new Date(snapshot().savedAt).toLocaleString())
  })

  it('says so when the work was never in a file at all', async () => {
    const { text } = await show([snapshot({ fileName: null })])
    expect(text()).toContain('Never saved to a file')
  })

  // A crash can leave more than one, and offering only the newest would strand
  // the others until they aged out.
  it('lists every snapshot, each answerable on its own', async () => {
    const { text } = await show([
      snapshot({ key: 'proj_a', projectName: 'First' }),
      snapshot({ key: 'proj_b', projectName: 'Second' }),
    ])
    expect(text()).toContain('First')
    expect(text()).toContain('Second')
    expect(rowButtons('Recover')).toHaveLength(2)
    expect(rowButtons('Discard')).toHaveLength(2)
  })

  // One click, one event, carrying which row it was about. No button closes
  // the dialog, so the close cannot answer ahead of the button.
  it('emits recover alone, with the key of the row', async () => {
    const { wrapper } = await show([snapshot({ key: 'proj_a' }), snapshot({ key: 'proj_b' })])
    rowButtons('Recover')[1].click()
    await nextTick()

    expect(wrapper.emitted('recover')).toEqual([['proj_b']])
    expect(wrapper.emitted('discard')).toBeUndefined()
    expect(wrapper.emitted('dismiss')).toBeUndefined()
  })

  it('emits discard alone, with the key of the row', async () => {
    const { wrapper } = await show([snapshot({ key: 'proj_a' }), snapshot({ key: 'proj_b' })])
    rowButtons('Discard')[0].click()
    await nextTick()

    expect(wrapper.emitted('discard')).toEqual([['proj_a']])
    expect(wrapper.emitted('recover')).toBeUndefined()
    expect(wrapper.emitted('dismiss')).toBeUndefined()
  })

  it('emits dismiss alone when the offer is put off', async () => {
    const { wrapper } = await show([snapshot()])
    rowButtons('Not Now')[0].click()
    await nextTick()

    expect(wrapper.emitted('dismiss')).toHaveLength(1)
    expect(wrapper.emitted('recover')).toBeUndefined()
    expect(wrapper.emitted('discard')).toBeUndefined()
  })

  // Escape leaves every snapshot where it is, which is the safe answer: the
  // work is still there to be offered again.
  it('treats Escape as putting the offer off, not as discarding', async () => {
    const { wrapper } = await show([snapshot()])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()

    expect(wrapper.emitted('dismiss')).toHaveLength(1)
    expect(wrapper.emitted('discard')).toBeUndefined()
  })

  // The store owns what is offered, so the list emptying must not bounce an
  // event back and start a second round.
  it('says nothing when the store closes it', async () => {
    const { wrapper } = await show([snapshot()])
    await wrapper.setProps({ snapshots: [] })
    expect(wrapper.emitted('dismiss')).toBeUndefined()
  })

  // Nothing here may read as "your file was changed": the file on disk has
  // not been touched, and the rows are what the user is being asked about.
  it('says the changes were never saved, and points at the list', async () => {
    const { text } = await show([snapshot()])
    expect(text()).toContain('closed before these changes were saved')
    expect(text()).toContain('Recover the ones you want to keep')
  })
})
