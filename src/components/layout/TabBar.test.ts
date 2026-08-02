import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import TabBar from './TabBar.vue'
import { useTabsStore } from '@/stores/tabs'

describe('TabBar', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    setActivePinia(createTestPinia())
    wrapper = mount(TabBar, { attachTo: document.body })
  })

  afterEach(() => {
    wrapper.unmount()
  })

  it('the "+" button adds a new tab', async () => {
    const tabsStore = useTabsStore()
    await wrapper.get('.new-tab-button').trigger('click')
    expect(tabsStore.tabs.map((t) => t.name)).toEqual(['Map 1', 'Map 2'])
  })

  it('the tab overview menu lists all tabs and switches on selection', async () => {
    const tabsStore = useTabsStore()
    tabsStore.addTab()
    tabsStore.activate(tabsStore.tabs[0].id)

    await wrapper.get('.tab-menu-button').trigger('click')
    await nextTick()

    const items = Array.from(document.querySelectorAll('[role="menuitem"]'))
    expect(items.map((el) => el.textContent?.trim())).toEqual(['Map 1', 'Map 2'])

    const secondItem = items.find((el) => el.textContent?.trim() === 'Map 2') as HTMLElement
    secondItem.click()
    await nextTick()

    expect(tabsStore.activeTabId).toBe(tabsStore.tabs[1].id)
  })

  it('scrolls the newly-activated tab into view', async () => {
    const tabsStore = useTabsStore()
    // jsdom has no real layout or scrolling; test-setup.ts stubs
    // scrollIntoView as a no-op, so this only asserts it was called, not the
    // resulting position.
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')

    tabsStore.addTab()
    await nextTick()

    expect(scrollIntoView).toHaveBeenCalled()
  })

  describe('drag to reorder', () => {
    // jsdom has no real layout: getBoundingClientRect always returns zeros,
    // so the midpoint-crossing geometry the drag logic depends on has to be
    // stubbed per-element to exercise it at all.
    function stubTabRects(lefts: number[], width = 100) {
      const tabs = document.querySelectorAll<HTMLElement>('.tab')
      tabs.forEach((el, i) => {
        el.getBoundingClientRect = () =>
          ({
            left: lefts[i],
            width,
            right: lefts[i] + width,
            top: 0,
            bottom: 0,
            height: 0,
          }) as DOMRect
      })
    }

    function pointerEvent(type: string, init: Partial<PointerEventInit> & { clientX: number }) {
      return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
    }

    it("moving past a neighbor's midpoint reorders the tabs", async () => {
      const tabsStore = useTabsStore()
      tabsStore.addTab()
      tabsStore.addTab()
      await nextTick()
      stubTabRects([0, 100, 200])

      const firstTab = document.querySelectorAll<HTMLElement>('.tab')[0]
      firstTab.dispatchEvent(pointerEvent('pointerdown', { clientX: 50, pointerId: 1 }))
      firstTab.dispatchEvent(pointerEvent('pointermove', { clientX: 160, pointerId: 1 })) // past tab 2's midpoint (150)
      firstTab.dispatchEvent(pointerEvent('pointerup', { clientX: 160, pointerId: 1 }))

      expect(tabsStore.tabs.map((t) => t.name)).toEqual(['Map 2', 'Map 1', 'Map 3'])
    })

    it('a small movement within the dead zone does not reorder, and the click still activates', async () => {
      const tabsStore = useTabsStore()
      tabsStore.addTab()
      tabsStore.activate(tabsStore.tabs[1].id) // start on "Map 2", not the tab we're about to click
      await nextTick()
      stubTabRects([0, 100])

      const firstTab = document.querySelectorAll<HTMLElement>('.tab')[0] // "Map 1"
      firstTab.dispatchEvent(pointerEvent('pointerdown', { clientX: 50, pointerId: 1 }))
      firstTab.dispatchEvent(pointerEvent('pointermove', { clientX: 52, pointerId: 1 })) // under the dead zone
      firstTab.dispatchEvent(pointerEvent('pointerup', { clientX: 52, pointerId: 1 }))
      firstTab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

      expect(tabsStore.tabs.map((t) => t.name)).toEqual(['Map 1', 'Map 2']) // unchanged order
      expect(tabsStore.activeTabId).toBe(tabsStore.tabs[0].id) // click activated "Map 1"
    })

    it('a real drag suppresses the trailing click so it does not also activate the dragged tab', async () => {
      const tabsStore = useTabsStore()
      tabsStore.addTab()
      tabsStore.addTab()
      const map2Id = tabsStore.tabs[1].id
      tabsStore.activate(map2Id) // start on "Map 2", not the tab we're about to drag
      await nextTick()
      stubTabRects([0, 100, 200])

      const firstTab = document.querySelectorAll<HTMLElement>('.tab')[0] // "Map 1"
      firstTab.dispatchEvent(pointerEvent('pointerdown', { clientX: 50, pointerId: 1 }))
      firstTab.dispatchEvent(pointerEvent('pointermove', { clientX: 160, pointerId: 1 })) // past "Map 2"'s midpoint
      firstTab.dispatchEvent(pointerEvent('pointerup', { clientX: 160, pointerId: 1 }))
      firstTab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

      // The drag reordered things, but activeTabId is still "Map 2": the
      // drop's click did not also activate "Map 1" (the dragged tab).
      expect(tabsStore.tabs.map((t) => t.name)).toEqual(['Map 2', 'Map 1', 'Map 3'])
      expect(tabsStore.activeTabId).toBe(map2Id)
    })
  })
})
