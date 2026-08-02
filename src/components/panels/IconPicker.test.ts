import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount } from '@vue/test-utils'
import IconPicker from './IconPicker.vue'
import IconLibraryPanel from './IconLibraryPanel.vue'
import { PLATE_ROUNDED_SQUARE } from '@/canvas/iconBadge'
import { ICONS, getIcon } from '@/icons/registry'
import { useArmedIconStore } from '@/stores/armedIcon'
import { useMarkupDefaultsStore } from '@/stores/markupDefaults'
import { registerIconDropTarget } from '@/gestures/iconDropTarget'

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
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

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

  it('arms on pick, and loads that icon’s colours into the toolbar', async () => {
    const panel = mount(IconLibraryPanel)
    const entry = ICONS[1]
    const option = panel
      .findAll('.icon-option')
      .find((button) => button.text().includes(entry.name))!

    await option.trigger('click')

    // Picking here arms rather than places: the panel has no cell to place in.
    expect(useArmedIconStore().iconType).toBe(entry.id)
    // And the swatches load the icon's own pair, so what the grid shows is what
    // lands on the map until a swatch is overridden.
    expect(useMarkupDefaultsStore().colors).toEqual(entry.defaultColors)
  })

  it('drags to the canvas without also arming what it dragged', async () => {
    const panel = mount(IconLibraryPanel, { attachTo: document.body })
    const option = panel.findAll('.icon-option')[0]
    const element = option.element as HTMLElement
    element.setPointerCapture = () => {}
    const dropped = vi.fn(() => true)
    const release = registerIconDropTarget(dropped)

    element.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
    )
    element.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 120, clientY: 90 }),
    )
    element.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, clientX: 120, clientY: 90 }),
    )
    // The browser raises a click after the release; the drag has to swallow it.
    await option.trigger('click')

    expect(dropped).toHaveBeenCalled()
    expect(useArmedIconStore().isArmed).toBe(false)
    release()
  })

  it('marks the armed icon, since nothing else shows it once the popup closes', async () => {
    const panel = mount(IconLibraryPanel)
    const option = panel.findAll('.icon-option')[0]

    await option.trigger('click')
    expect(panel.findAll('.icon-option.armed')).toHaveLength(1)
    expect(option.attributes('aria-pressed')).toBe('true')

    // Clicking the armed icon again disarms it, one of the three routes out.
    await option.trigger('click')
    expect(useArmedIconStore().isArmed).toBe(false)
    expect(panel.findAll('.icon-option.armed')).toHaveLength(0)
  })
})
