// The component at both depths, driven from hand-built trees.
//
// Tab depth has no other coverage: the dialog that mounts this today is the
// room-depth one, so a tree whose `areas` is null renders nowhere else, and it
// is the depth the component was pulled out to serve.

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import ScopeTree from './ScopeTree.vue'
import type { LeafId, ScopeTab } from '@/export/scopeTree'
import type { AreaId, MapId, RoomId } from '@/core/ids'

function tabLeaf(id: string, label: string, empty = false): ScopeTab {
  return { kind: 'tab', id: id as MapId, label, areas: null, empty }
}

function roomTab(id: string, label: string, rooms: string[]): ScopeTab {
  return {
    kind: 'tab',
    id: id as MapId,
    label,
    empty: rooms.length === 0,
    areas: [
      {
        kind: 'area',
        id: 'area_1' as AreaId,
        label: 'World',
        rooms: rooms.map((room) => ({ kind: 'room', id: room as RoomId, label: room })),
      },
    ],
  }
}

function render(tree: ScopeTab[], selected: string[] = []) {
  return mount(ScopeTree, {
    props: {
      tree,
      selected: new Set(selected as Iterable<LeafId>),
      label: 'What to export',
      emptyNote: 'Nothing here',
    },
  })
}

function rows(wrapper: VueWrapper) {
  return wrapper.findAll('[role="treeitem"]').map((row) => ({
    id: row.attributes('data-row-id'),
    kind: row.attributes('data-row-kind'),
    level: row.attributes('aria-level'),
    state: row.find('[role="checkbox"]').attributes('aria-checked'),
    disabled: row.find('[role="checkbox"]').attributes('data-disabled') !== undefined,
    note: row.find('.scope-note').exists() ? row.find('.scope-note').text() : null,
  }))
}

describe('at tab depth', () => {
  it('draws one row per tab, all at level one', () => {
    const wrapper = render([tabLeaf('map_1', 'Surface'), tabLeaf('map_2', 'Caves')])

    expect(rows(wrapper)).toEqual([
      { id: 'map_1', kind: 'tab', level: '1', state: 'false', disabled: false, note: null },
      { id: 'map_2', kind: 'tab', level: '1', state: 'false', disabled: false, note: null },
    ])
  })

  it('reads a ticked tab as checked', () => {
    const wrapper = render([tabLeaf('map_1', 'Surface')], ['map_1'])
    expect(rows(wrapper)[0].state).toBe('true')
  })

  it('emits the tab id when its box is ticked', async () => {
    const wrapper = render([tabLeaf('map_1', 'Surface')])

    await wrapper.find('[role="checkbox"]').trigger('click')

    const emitted = wrapper.emitted('update:selected')!
    expect([...(emitted[0][0] as Set<LeafId>)]).toEqual(['map_1'])
  })

  // A disabled node is unticked and cannot be ticked.
  it('draws an empty tab disabled, with the note it was given', () => {
    const wrapper = render([tabLeaf('map_1', 'Empty', true)])

    expect(rows(wrapper)[0].disabled).toBe(true)
    expect(rows(wrapper)[0].note).toBe('Nothing here')
  })

  it('emits nothing from a disabled tab', async () => {
    const wrapper = render([tabLeaf('map_1', 'Empty', true)])

    await wrapper.find('[role="checkbox"]').trigger('click')

    expect(wrapper.emitted('update:selected')).toBeUndefined()
  })
})

describe('at room depth', () => {
  it('draws the three levels in order, each at its own level', () => {
    const wrapper = render([roomTab('map_1', 'Surface', ['room_a', 'room_b'])])

    expect(rows(wrapper).map((row) => [row.kind, row.level])).toEqual([
      ['tab', '1'],
      ['area', '2'],
      ['room', '3'],
      ['room', '3'],
    ])
  })

  it('reads a partly ticked tab as indeterminate', () => {
    const wrapper = render([roomTab('map_1', 'Surface', ['room_a', 'room_b'])], ['room_a'])
    expect(rows(wrapper)[0].state).toBe('mixed')
  })

  it('takes every room under a tab when the tab is ticked', async () => {
    const wrapper = render([roomTab('map_1', 'Surface', ['room_a', 'room_b'])])

    await wrapper.find('[role="checkbox"]').trigger('click')

    const emitted = wrapper.emitted('update:selected')!
    expect([...(emitted[0][0] as Set<LeafId>)]).toEqual(['room_a', 'room_b'])
  })

  // The row key at level two is the tab and area together, since an area id
  // repeats across tabs while a room id does not.
  it('draws the same area under two tabs without collapsing the rows', () => {
    const wrapper = render([
      roomTab('map_1', 'Surface', ['room_a']),
      roomTab('map_2', 'Caves', ['room_b']),
    ])

    expect(rows(wrapper).filter((row) => row.kind === 'area')).toHaveLength(2)
  })
})
