import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import IconPicker from './IconPicker.vue'
import IconLibraryPanel from './IconLibraryPanel.vue'
import { PLATE_ROUNDED_SQUARE } from '@/canvas/iconBadge'
import { ICONS, getIcon } from '@/icons/registry'

describe('IconPicker', () => {
  it('shows every icon in the catalogue, derived rather than listed', () => {
    const wrapper = mount(IconPicker)
    expect(wrapper.findAll('.icon-option')).toHaveLength(ICONS.length)
  })

  it('draws each icon in its own canonical colours', () => {
    const wrapper = mount(IconPicker)
    const save = getIcon('save')!
    const button = wrapper.findAll('.icon-option').find((b) => b.text().includes(save.name))!

    // The grid says what will land on the map. A wall of one colour would make
    // the badge model invisible in the one place it is being chosen from.
    const paths = button.findAll('path')
    expect(paths[0].attributes('fill')).toBe(save.defaultColors.plateColor)
    expect(paths[1].attributes('fill')).toBe(save.defaultColors.glyphColor)
    // Plate first, glyph over it: the same order the canvas draws.
    expect(paths[0].attributes('d')).toBe(save.plate ?? PLATE_ROUNDED_SQUARE)
    expect(paths[1].attributes('d')).toBe(save.glyph)
  })

  it('narrows the grid by name, id or keyword', async () => {
    const wrapper = mount(IconPicker)

    // "floppy" is a keyword of `save`, not its name: the set is large enough
    // that the name is often not what a user would type.
    await wrapper.find('input[type="search"]').setValue('floppy')
    expect(wrapper.findAll('.icon-option')).toHaveLength(1)
    expect(wrapper.text()).toContain(getIcon('save')!.name)
  })

  it('says so when nothing matches, rather than showing an empty grid', async () => {
    const wrapper = mount(IconPicker)
    await wrapper.find('input[type="search"]').setValue('no such icon anywhere')

    expect(wrapper.findAll('.icon-option')).toHaveLength(0)
    expect(wrapper.find('.icon-empty').exists()).toBe(true)
  })

  it('emits the whole registry entry, so a caller needs no second lookup', async () => {
    const wrapper = mount(IconPicker)
    await wrapper.findAll('.icon-option')[0].trigger('click')

    expect(wrapper.emitted('pick')).toHaveLength(1)
    expect(wrapper.emitted('pick')![0][0]).toBe(ICONS[0])
  })

  it('gives every option an accessible name, since the badge itself is decorative', () => {
    const wrapper = mount(IconPicker)
    for (const entry of ICONS) {
      expect(wrapper.text()).toContain(entry.name)
    }
    expect(wrapper.find('svg').attributes('aria-hidden')).toBe('true')
  })

  it('takes focus only when asked, so the docked panel does not steal it', () => {
    const docked = mount(IconPicker, { attachTo: document.body })
    expect(document.activeElement).not.toBe(docked.find('input').element)

    const popup = mount(IconPicker, { props: { autofocus: true }, attachTo: document.body })
    expect(document.activeElement).toBe(popup.find('input').element)
  })
})

describe('IconLibraryPanel', () => {
  it('is the picker, in a different home', () => {
    // One component, two homes: the panel adds a place to stand and nothing
    // else, so search and the grid cannot drift between them.
    const panel = mount(IconLibraryPanel)
    expect(panel.findComponent(IconPicker).exists()).toBe(true)
    expect(panel.findAll('.icon-option')).toHaveLength(ICONS.length)
  })

  it('does not take focus when the sidebar shows it', () => {
    const panel = mount(IconLibraryPanel, { attachTo: document.body })
    expect(document.activeElement).not.toBe(panel.find('input').element)
  })
})
