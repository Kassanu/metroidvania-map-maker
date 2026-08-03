import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import CanvasRegion from './CanvasRegion.vue'
import { useModeStore } from '@/stores/mode'
import { useSelectionStore } from '@/stores/selection'
import { useTabsStore } from '@/stores/tabs'
import { mapScope, useModelStore } from '@/stores/model'
import { registerAction } from '@/hotkeys/actions'
import { resolveEscape } from '@/hotkeys/escStack'
import { paintCells } from '@/core/ops/rooms'
import { createFromBox } from '@/core/ops/doors'
import { ok } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { ActionId } from '@/hotkeys/keymap'

// The canvas context menu: four verbs, all of them about the selection, and one
// mode. What it does to the selection on the way to opening is the Select
// precedence suite's; this is the menu itself.
describe('the canvas context menu', () => {
  let mounted: ReturnType<typeof mount> | null = null
  let release: (() => void)[] = []

  beforeEach(() => {
    setActivePinia(createTestPinia())
    useModeStore().setMode('select')
  })

  // Teardown in `afterEach` rather than at the end of each case: the menu is
  // portalled, so a case that fails before its own cleanup would leak an open
  // menu into every case after it.
  afterEach(() => {
    release.forEach((pop) => pop())
    release = []
    mounted?.unmount()
    mounted = null
    document.body.innerHTML = ''
  })

  async function mountCanvas() {
    const wrapper = mount(CanvasRegion, { attachTo: document.body })
    mounted = wrapper
    const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    viewport.setPointerCapture = () => {}
    await nextTick()
    return { wrapper, viewport }
  }

  async function rightClick(viewport: HTMLElement) {
    viewport.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }),
    )
    await nextTick()
    await nextTick()
  }

  // Reka keeps a closed menu mounted until an exit animation jsdom never fires,
  // so "is it open" is the state attribute and never the element's presence.
  function menuState() {
    return document.querySelector('[role="menu"]')?.getAttribute('data-state') ?? null
  }

  function items() {
    return Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]'))
  }

  function itemNamed(label: string) {
    return items().find((el) => el.textContent?.trim() === label)!
  }

  const enabled = (label: string) => itemNamed(label).getAttribute('data-disabled') === null

  function handle(id: ActionId, handler: () => void = () => {}) {
    release.push(registerAction(id, handler))
  }

  function paintRoom() {
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    const room = model.run('Paint', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, model.project.mapsById.get(mapId)!, ['0,0', '1,0'], {
        areaId: WORLD_AREA_ID,
      }),
    )
    return { mapId, roomId: room.id }
  }

  function paintRoomsWithDoor() {
    const model = useModelStore()
    const mapId = useTabsStore().activeTabId
    const transitionId = model.run('Paint', mapScope(mapId), (tx) => {
      const map = model.project.mapsById.get(mapId)!
      paintCells(tx, model.project, map, ['0,0'], { areaId: WORLD_AREA_ID })
      paintCells(tx, model.project, map, ['1,0'], { areaId: WORLD_AREA_ID })
      return ok(createFromBox(tx, model.project, map, '0,0', '1,0'))[0].id
    })
    return { mapId, transitionId }
  }

  describe('when it opens', () => {
    it('opens on a right-click in Select mode', async () => {
      const { viewport } = await mountCanvas()

      await rightClick(viewport)

      expect(menuState()).toBe('open')
    })

    // The other three spend the secondary button on erase, so offering a menu
    // there would either steal the button or stack a menu on top of a delete.
    it('stays shut in the three modes that erase on that button', async () => {
      const { viewport } = await mountCanvas()

      for (const mode of ['draw', 'door', 'markup'] as const) {
        useModeStore().setMode(mode)
        await nextTick()
        await rightClick(viewport)
        expect(menuState()).not.toBe('open')
      }
    })

    // The menu claims the Esc stack's dialog tier while it is open, which is
    // above the selection: one press closes the menu and leaves the selection
    // it was about to act on.
    it('takes Esc ahead of the selection while it is open', async () => {
      const { viewport } = await mountCanvas()
      const selection = useSelectionStore()
      const { roomId, mapId } = paintRoom()
      selection.set([{ kind: 'room', id: roomId }], mapId)

      await rightClick(viewport)
      expect(resolveEscape()).toBe(true)

      expect(selection.isEmpty).toBe(false)
    })
  })

  describe('its items', () => {
    it('offers Cut, Copy, Duplicate and Delete, and nothing else', async () => {
      const { viewport } = await mountCanvas()
      await rightClick(viewport)

      // No Paste: every verb here acts on what was right-clicked, and paste acts
      // on the pointer.
      expect(items().map((el) => el.textContent?.trim())).toEqual([
        'Cut',
        'Copy',
        'Duplicate',
        'Delete',
      ])
    })

    it('disables everything with nothing selected', async () => {
      const { viewport } = await mountCanvas()
      handle('cut')
      handle('copy')
      handle('duplicate')
      handle('deleteSelection')

      await rightClick(viewport)

      for (const item of items()) expect(item.getAttribute('data-disabled')).not.toBeNull()
    })

    it('enables them all for a selected room', async () => {
      const { viewport } = await mountCanvas()
      const selection = useSelectionStore()
      const { roomId, mapId } = paintRoom()
      handle('cut')
      handle('copy')
      handle('duplicate')
      handle('deleteSelection')
      selection.set([{ kind: 'room', id: roomId }], mapId)

      await rightClick(viewport)

      expect(enabled('Cut')).toBe(true)
      expect(enabled('Copy')).toBe(true)
      expect(enabled('Duplicate')).toBe(true)
      expect(enabled('Delete')).toBe(true)
    })

    // A transition is never copied and an icon travels as content on a cell, so
    // a selection of only those has no payload. Delete needs none and stays on.
    it('disables the clipboard verbs for a selection with nothing to copy', async () => {
      const { viewport } = await mountCanvas()
      const selection = useSelectionStore()
      const { mapId, transitionId } = paintRoomsWithDoor()
      handle('cut')
      handle('copy')
      handle('duplicate')
      handle('deleteSelection')
      selection.set([{ kind: 'transition', id: transitionId }], mapId)

      await rightClick(viewport)

      expect(enabled('Cut')).toBe(false)
      expect(enabled('Copy')).toBe(false)
      expect(enabled('Duplicate')).toBe(false)
      expect(enabled('Delete')).toBe(true)
    })

    // An id exists in the keymap long before the feature that answers it. An
    // item with no handler is disabled rather than offering a command that
    // quietly does nothing.
    it('disables an item whose action nothing has registered', async () => {
      const { viewport } = await mountCanvas()
      const selection = useSelectionStore()
      const { roomId, mapId } = paintRoom()
      handle('deleteSelection')
      selection.set([{ kind: 'room', id: roomId }], mapId)

      await rightClick(viewport)

      expect(enabled('Copy')).toBe(false)
      expect(enabled('Delete')).toBe(true)
    })

    it('runs the action id the keyboard runs', async () => {
      const { viewport } = await mountCanvas()
      const selection = useSelectionStore()
      const { roomId, mapId } = paintRoom()
      const deleted = vi.fn<() => void>()
      handle('deleteSelection', deleted)
      selection.set([{ kind: 'room', id: roomId }], mapId)

      await rightClick(viewport)
      ;(itemNamed('Delete') as HTMLElement).click()
      await nextTick()

      expect(deleted).toHaveBeenCalledTimes(1)
    })
  })
})
