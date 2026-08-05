import { describe, it, expect, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import LoadOutcomeDialog from './LoadOutcomeDialog.vue'
import type { LoadOutcome } from '@/stores/file'
import type { LoadEventKind } from '@/core/serialize'
import { LIMITS } from '@/core/serialize/limits'
import type { LimitName } from '@/core/serialize/limits'

// The dialog portals its content, so what is asserted is the document rather
// than the wrapper. Which is also why every mount has to be torn down: a
// portal outlives its wrapper in `document.body`, and a leftover one makes the
// next test read the previous test's dialog.
const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

// Awaited because the portal lands a tick after the mount, so reading the
// document synchronously sees an empty body whatever the props said.
async function show(outcome: LoadOutcome | null) {
  const wrapper = mount(LoadOutcomeDialog, { props: { outcome }, attachTo: document.body })
  mounted.push(wrapper)
  await nextTick()
  return { wrapper, text: () => document.body.textContent ?? '' }
}

function repaired(counts: [LoadEventKind, number][]): LoadOutcome {
  return { kind: 'repaired', counts: new Map(counts), accept: () => {} }
}

describe('a repaired load', () => {
  it('lists one line per kind, with its count', async () => {
    const { text } = await show(
      repaired([
        ['cell-dropped', 12],
        ['room-split', 3],
      ]),
    )
    expect(text()).toContain('This file needed repairs')
    expect(text()).toContain('Cells dropped: 12')
    expect(text()).toContain('Rooms split apart: 3')
  })

  // Label-and-count rather than "{count} cells dropped", which reads wrong at
  // one and would need plural machinery the catalogue does not have.
  it('reads correctly at a count of one', async () => {
    const { text } = await show(repaired([['room-dropped', 1]]))
    expect(text()).toContain('Rooms dropped: 1')
    expect(text()).not.toContain('1 rooms')
  })

  it('offers accepting as well as cancelling', async () => {
    const { text } = await show(repaired([['cell-dropped', 1]]))
    expect(text()).toContain('Open Anyway')
    expect(text()).toContain('Cancel')
  })

  // One click, one event. Reka's own Action closes the dialog before running
  // the handler of the button that was picked, so a dialog built from it
  // emitted `dismiss` first; the store cleared the outcome, and the `accept`
  // that followed found nothing to accept. Opening a repaired file did
  // nothing at all.
  it('emits accept alone when the repair is accepted', async () => {
    const { wrapper } = await show(repaired([['cell-dropped', 1]]))
    const button = [...document.body.querySelectorAll('button')].find((element) =>
      element.textContent?.includes('Open Anyway'),
    )!
    button.click()
    await nextTick()

    expect(wrapper.emitted('accept')).toHaveLength(1)
    expect(wrapper.emitted('dismiss')).toBeUndefined()
  })

  it('emits dismiss alone when it is declined', async () => {
    const { wrapper } = await show(repaired([['cell-dropped', 1]]))
    const button = [...document.body.querySelectorAll('button')].find(
      (element) => element.textContent?.trim() === 'Cancel',
    )!
    button.click()
    await nextTick()

    expect(wrapper.emitted('dismiss')).toHaveLength(1)
    expect(wrapper.emitted('accept')).toBeUndefined()
  })

  it('treats Escape as a dismissal', async () => {
    const { wrapper } = await show(repaired([['cell-dropped', 1]]))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
    expect(wrapper.emitted('accept')).toBeUndefined()
  })

  // The store owns the outcome, so it clearing it must not bounce an event
  // back and start a second round of dismissal.
  it('says nothing when the store closes it', async () => {
    const { wrapper } = await show(repaired([['cell-dropped', 1]]))
    await wrapper.setProps({ outcome: null })
    expect(wrapper.emitted('dismiss')).toBeUndefined()
  })

  // Every kind the loader can report needs a line, or a repaired file would
  // list fewer things than were changed.
  it('has a message for every repair kind the loader emits', async () => {
    const kinds: LoadEventKind[] = [
      'cell-dropped',
      'inner-wall-dropped',
      'room-dropped',
      'room-split',
      'icon-dropped',
      'line-dropped',
      'transition-dropped',
      'door-trimmed',
      'area-remapped',
      'lock-remapped',
      'setting-reset',
      'color-reset',
      'icon-type-reset',
      'assumed-default',
      'id-remapped',
      'text-truncated',
    ]
    const { text } = await show(repaired(kinds.map((kind) => [kind, 7])))
    // A missing entry renders the raw key, which contains a dot and no colon.
    expect(text()).not.toContain('load.')
    expect(text().match(/: 7/g)).toHaveLength(kinds.length)
  })
})

describe('a refused load', () => {
  it('says what was wrong without offering to continue', async () => {
    const { text } = await show({ kind: 'invalid' })
    expect(text()).toContain('Could not open that file')
    expect(text()).toContain('not a Metroidvania Map Maker project')
    expect(text()).not.toContain('Open Anyway')
  })

  // "Too large" alone leaves the user with nothing to do. The numbers and the
  // thing being counted are what makes it actionable.
  it('names what was too big, by how much, in words rather than code', async () => {
    const { text } = await show({
      kind: 'too-large',
      limit: 'roomsPerMap',
      found: LIMITS.roomsPerMap + 1,
      allowed: LIMITS.roomsPerMap,
    })
    expect(text()).toContain('rooms on one map')
    expect(text()).toContain('10,001')
    expect(text()).toContain('10,000')
    expect(text()).not.toContain('roomsPerMap')
  })

  it('has a phrase for every limit that can be exceeded', async () => {
    for (const limit of Object.keys(LIMITS) as LimitName[]) {
      const { wrapper, text } = await show({ kind: 'too-large', limit, found: 2, allowed: 1 })
      expect(text(), limit).not.toContain('load.limit.')
      // A few phrases are legitimately the same word as their key (`bytes`).
      // What must never appear is the camelCase identifier.
      if (/[A-Z]/.test(limit)) expect(text(), limit).not.toContain(limit)
      wrapper.unmount()
      document.body.innerHTML = ''
    }
  })

  it('names both versions when the file is from a newer build', async () => {
    const { text } = await show({ kind: 'too-new', version: 9, supported: 2 })
    expect(text()).toContain('file version 9')
    expect(text()).toContain('this build reads 2')
  })

  // A file picked off the recent list that no longer opens. Naming it matters
  // because the user chose it from several, and the way out is dropping the
  // entry rather than closing and finding it still there.
  it('names a file that has moved, and offers to drop the entry', async () => {
    const { text } = await show({ kind: 'missing', name: 'sunken-city.mvm', forget: () => {} })
    expect(text()).toContain('sunken-city.mvm')
    expect(text()).toContain('moved, renamed, or deleted')
    expect(text()).toContain('Remove from Recent')
  })

  it('says a refused permission is a refused permission, not a missing file', async () => {
    const { text } = await show({
      kind: 'permission-refused',
      name: 'sunken-city.mvm',
      forget: () => {},
    })
    expect(text()).toContain('not given permission')
    expect(text()).not.toContain('deleted')
    expect(text()).toContain('Remove from Recent')
  })

  it('emits forget alone when the entry is dropped', async () => {
    const { wrapper } = await show({ kind: 'missing', name: 'gone.mvm', forget: () => {} })
    const button = [...document.body.querySelectorAll('button')].find(
      (element) => element.textContent?.trim() === 'Remove from Recent',
    )!
    button.click()
    await nextTick()

    expect(wrapper.emitted('forget')).toHaveLength(1)
    expect(wrapper.emitted('dismiss')).toBeUndefined()
  })

  // Nothing else has an entry behind it, so nothing else may offer to drop one.
  it('offers nothing to forget for a failure that named no file', async () => {
    for (const outcome of [
      { kind: 'invalid' },
      { kind: 'failed', message: 'x' },
      { kind: 'too-new', version: 9, supported: 2 },
    ] as LoadOutcome[]) {
      const { wrapper, text } = await show(outcome)
      expect(text(), outcome.kind).not.toContain('Remove from Recent')
      wrapper.unmount()
      document.body.innerHTML = ''
    }
  })

  it('passes an unexpected failure through rather than swallowing it', async () => {
    const { text } = await show({ kind: 'failed', message: 'the disk caught fire' })
    expect(text()).toContain('the disk caught fire')
  })

  it('renders nothing at all when there is no outcome', async () => {
    const { text } = await show(null)
    expect(text()).not.toContain('Could not open that file')
    expect(text()).not.toContain('This file needed repairs')
  })
})
