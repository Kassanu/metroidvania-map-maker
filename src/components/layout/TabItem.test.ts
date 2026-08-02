import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { pushEscHandler, resolveEscape } from '@/hotkeys/escStack'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import TabItem from './TabItem.vue'
import { useTabsStore } from '@/stores/tabs'
import { mapScope, useModelStore } from '@/stores/model'
import { paintCells } from '@/core/ops/rooms'
import { placeIcon } from '@/core/ops/markup'
import { createTeleport } from '@/core/ops/doors'
import { WORLD_AREA_ID } from '@/core/ids'
import { TEST_ICON_COLORS } from '@/core/testUtils'

describe('TabItem', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  function mountTab() {
    const tabsStore = useTabsStore()
    const tab = tabsStore.tabs[0]
    wrapper = mount(TabItem, { props: { tab }, attachTo: document.body })
    return { tabsStore, tab }
  }

  it('activates the tab on click', async () => {
    const { tabsStore } = mountTab()
    tabsStore.addTab()
    tabsStore.activate(tabsStore.tabs[0].id) // switch away first
    await wrapper.get('.tab').trigger('click')
    expect(tabsStore.activeTabId).toBe(tabsStore.tabs[0].id)
  })

  it('double-click enters rename mode with the current name pre-filled', async () => {
    const { tab } = mountTab()
    await wrapper.get('.tab').trigger('dblclick')
    const input = wrapper.get('.tab-rename-input')
    expect((input.element as HTMLInputElement).value).toBe(tab.name)
  })

  it('Enter commits the rename', async () => {
    const { tabsStore, tab } = mountTab()
    await wrapper.get('.tab').trigger('dblclick')
    const input = wrapper.get('.tab-rename-input')
    await input.setValue('Brinstar')
    await input.trigger('keydown.enter')
    expect(tabsStore.tabs.find((t) => t.id === tab.id)?.name).toBe('Brinstar')
    expect(wrapper.find('.tab-rename-input').exists()).toBe(false)
  })

  it('Escape reverts without committing', async () => {
    const { tabsStore, tab } = mountTab()
    await wrapper.get('.tab').trigger('dblclick')
    const input = wrapper.get('.tab-rename-input')
    await input.setValue('Discarded')
    await input.trigger('keydown.esc')
    expect(tabsStore.tabs.find((t) => t.id === tab.id)?.name).toBe(tab.name)
    expect(wrapper.find('.tab-rename-input').exists()).toBe(false)
  })

  it('blur commits the rename', async () => {
    const { tabsStore, tab } = mountTab()
    await wrapper.get('.tab').trigger('dblclick')
    const input = wrapper.get('.tab-rename-input')
    await input.setValue('Norfair')
    await input.trigger('blur')
    expect(tabsStore.tabs.find((t) => t.id === tab.id)?.name).toBe('Norfair')
  })

  it('right-click opens a menu with Duplicate calling duplicateTab', async () => {
    const { tabsStore, tab } = mountTab()
    await wrapper.get('.tab').trigger('contextmenu')
    await nextTick()

    const duplicateItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === 'Duplicate',
    ) as HTMLElement | undefined
    expect(duplicateItem).toBeDefined()

    duplicateItem?.click()
    await nextTick()

    expect(tabsStore.tabs.map((t) => t.name)).toContain(`${tab.name} copy`)
  })

  it('right-click, Delete, then confirming removes the tab', async () => {
    const { tabsStore, tab } = mountTab()
    tabsStore.addTab() // so deleting isn't the "last tab" special case
    await wrapper.get('.tab').trigger('contextmenu')
    await nextTick()

    const deleteItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === 'Delete',
    ) as HTMLElement | undefined
    deleteItem?.click()
    await nextTick()

    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (el) => el.textContent?.trim() === 'Delete' && el.closest('.modal-content'),
    ) as HTMLElement | undefined
    expect(confirmButton).toBeDefined()

    confirmButton?.click()
    await nextTick()

    expect(tabsStore.tabs.find((t) => t.id === tab.id)).toBeUndefined()
  })

  // The confirmation is a pre-action query (`mapDeletionImpact`), not
  // anything the op returns: `deleteMap` deliberately does not ask. These
  // check the dialog shows what that query found, not boilerplate.
  describe('the delete confirmation reports the real impact', () => {
    async function openDeleteDialog() {
      await wrapper.get('.tab').trigger('contextmenu')
      await nextTick()
      const deleteItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
        (el) => el.textContent?.trim() === 'Delete',
      ) as HTMLElement
      deleteItem.click()
      await nextTick()
      return document.querySelector('.tab-delete-description')!.textContent ?? ''
    }

    it('says so when the map is empty', async () => {
      mountTab()
      expect(await openDeleteDialog()).toContain('This map is empty')
    })

    it('counts what will be destroyed, listing only what is there', async () => {
      const { tabsStore, tab } = mountTab()
      const model = useModelStore()
      model.run('Paint', mapScope(tab.id), (tx) =>
        paintCells(tx, model.project, model.project.mapsById.get(tab.id)!, ['0,0', '1,0'], {
          areaId: WORLD_AREA_ID,
        }),
      )
      model.run('Icon', mapScope(tab.id), (tx) =>
        placeIcon(tx, model.project.mapsById.get(tab.id)!, '0,0', 'save', TEST_ICON_COLORS),
      )
      tabsStore.addTab()

      const text = await openDeleteDialog()
      expect(text).toContain('Rooms: 1')
      expect(text).toContain('Icons: 1')
      // Nothing drew a line, so the line count is left out entirely.
      expect(text).not.toContain('Lines')
    })

    // The whole reason this dialog exists: this damage is in tabs the user
    // cannot currently see.
    it('names the other maps whose teleports will be removed', async () => {
      const { tabsStore, tab } = mountTab()
      const model = useModelStore()
      tabsStore.addTab()
      const other = tabsStore.activeTabId

      for (const [mapId, cell] of [
        [tab.id, '0,0'],
        [other, '5,5'],
      ] as const) {
        model.run('Paint', mapScope(mapId), (tx) =>
          paintCells(tx, model.project, model.project.mapsById.get(mapId)!, [cell], {
            areaId: WORLD_AREA_ID,
          }),
        )
      }
      // Stored under `other`, pointing into the tab we are about to delete.
      model.run('Teleport', mapScope(other), (tx) =>
        createTeleport(
          tx,
          model.project,
          { mapId: other, cell: '5,5' },
          { mapId: tab.id, cell: '0,0' },
        ),
      )

      const text = await openDeleteDialog()
      expect(text).toContain('link here')
      expect(text).toContain('Map 2 (1)')
    })

    it('warns that a replacement is coming when it is the only map', async () => {
      mountTab()
      const text = await openDeleteDialog()
      expect(text).toContain('a new blank one will take its place')
    })

    it('no longer claims the delete cannot be undone', async () => {
      mountTab()
      expect(await openDeleteDialog()).toContain('You can undo this')
    })
  })

  // The confirm dialog is an AlertDialog, so it doesn't go through BaseModal,
  // but it still has to occupy the Esc stack's dialog tier while open.
  // Without that, one Escape would close the dialog and be handled again by
  // a lower tier once selection/gestures exist.
  it('claims the dialog Esc tier while the delete confirmation is open', async () => {
    mountTab()
    const lowerTier = vi.fn()
    const popLower = pushEscHandler('selection', lowerTier)

    expect(resolveEscape()).toBe(true)
    expect(lowerTier).toHaveBeenCalledTimes(1) // nothing above it yet

    await wrapper.get('.tab').trigger('contextmenu')
    await nextTick()
    const deleteItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === 'Delete',
    ) as HTMLElement | undefined
    deleteItem?.click()
    await nextTick()

    expect(resolveEscape()).toBe(true)
    expect(lowerTier).toHaveBeenCalledTimes(1) // the dialog tier absorbed it
    await nextTick()
    // Reka tears the dialog down over a further tick or two, so check the
    // state it reports rather than waiting for the node to disappear.
    expect(document.querySelector('.modal-content')?.getAttribute('data-state')).not.toBe('open')

    popLower()
  })
})
