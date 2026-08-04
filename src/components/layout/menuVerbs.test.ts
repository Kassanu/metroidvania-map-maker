import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import CanvasRegion from './CanvasRegion.vue'
import MenuBar from './MenuBar.vue'
import { createTestPinia } from '@/test-setup'
import { registerAction, runAction } from '@/hotkeys/actions'
import { pushEscHandler, resolveEscape } from '@/hotkeys/escStack'
import { useModeStore } from '@/stores/mode'
import { useToolsStore } from '@/stores/tools'
import { useSelectionStore } from '@/stores/selection'
import { useTabsStore } from '@/stores/tabs'
import { mapScope, useModelStore } from '@/stores/model'
import { paintCells } from '@/core/ops/rooms'
import { createLine, placeIcon } from '@/core/ops/markup'
import { createTeleport } from '@/core/ops/doors'
import { WORLD_AREA_ID } from '@/core/ids'
import { TEST_ICON_COLORS, ok } from '@/core/testUtils'
import type { ActionId } from '@/hotkeys/keymap'
import type { CellKey } from '@/core/cell'
import type { MapId } from '@/core/ids'
import type { Mode } from '@/stores/mode'

// The seven verbs that act on a selection, and the four the canvas menu shows.
// Paste is absent from the canvas list on purpose: every verb there acts on
// what was right-clicked, and paste acts on the pointer.
const EDIT_VERBS = ['Cut', 'Copy', 'Paste', 'Duplicate', 'Delete', 'Select All', 'Deselect']
const CANVAS_VERBS = ['Cut', 'Copy', 'Duplicate', 'Delete']

const VERB_ACTIONS: ActionId[] = [
  'cut',
  'copy',
  'paste',
  'duplicate',
  'deleteSelection',
  'selectAll',
  'deselect',
]
const CANVAS_ACTIONS: ActionId[] = ['cut', 'copy', 'duplicate', 'deleteSelection']

const LINE_DEFAULTS = { color: '#8a8a8a', arrowStart: false, arrowEnd: false }

let wrapper: VueWrapper | undefined
let handlers: Map<ActionId, Mock>
let cleanups: Array<() => void>

beforeEach(() => {
  setActivePinia(createTestPinia())
  handlers = new Map()
  cleanups = []
})

// Portalled menu content survives a failing test body, so teardown cannot live
// at the end of the test: leaked content would answer every later query.
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

// Both menus disable an item whose action has no handler, so a test about the
// selection rules has to put a handler behind every id first.
//
// After mounting, never before: the canvas registers real handlers for these
// ids as it mounts, and registration is last-wins, so spies put on first would
// be the ones replaced.
function registerVerbHandlers(): void {
  for (const id of VERB_ACTIONS) {
    const handler = vi.fn()
    handlers.set(id, handler)
    cleanups.push(registerAction(id, handler))
  }
}

// `registerAction`'s unregister only drops its own handler, so registering a
// throwaway is what makes the removal unconditional whoever registered before.
function clearAction(id: ActionId): void {
  registerAction(id, () => {})()
}

function handlerFor(id: ActionId): Mock {
  const handler = handlers.get(id)
  if (!handler) throw new Error(`no handler registered for ${id}`)
  return handler
}

// ---------------------------------------------------------------------------
// Model and selection fixtures
// ---------------------------------------------------------------------------

function activeMapId(): MapId {
  return useTabsStore().activeTabId
}

function paint(cells: CellKey[], mapId: MapId = activeMapId()) {
  const model = useModelStore()
  return model.run('Paint', mapScope(mapId), (tx) =>
    paintCells(tx, model.project, model.project.mapsById.get(mapId)!, cells, {
      areaId: WORLD_AREA_ID,
    }),
  )
}

function addIcon(cell: CellKey, mapId: MapId = activeMapId()) {
  const model = useModelStore()
  return ok(
    model.run('Icon', mapScope(mapId), (tx) =>
      placeIcon(tx, model.project.mapsById.get(mapId)!, cell, 'save', TEST_ICON_COLORS),
    ),
  )
}

function addLine(points: CellKey[], mapId: MapId = activeMapId()) {
  const model = useModelStore()
  return ok(
    model.run('Line', mapScope(mapId), (tx) =>
      createLine(tx, model.project.mapsById.get(mapId)!, points, LINE_DEFAULTS),
    ),
  )
}

// A same-map teleport between two rooms, which is the cheapest transition to
// build: an edge door needs the two rooms to share a wall.
function addTeleport(from: CellKey, to: CellKey, mapId: MapId = activeMapId()) {
  const model = useModelStore()
  return ok(
    model.run('Teleport', mapScope(mapId), (tx) =>
      createTeleport(tx, model.project, { mapId, cell: from }, { mapId, cell: to }),
    ),
  )
}

async function setMode(mode: Mode): Promise<void> {
  useModeStore().setMode(mode)
  // The mode watch lands a tick after the store changes, so a gesture
  // dispatched in the same tick would still be resolved against the old mode.
  await nextTick()
}

// ---------------------------------------------------------------------------
// Menu queries
// ---------------------------------------------------------------------------

function text(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

// Items and separators in DOM order, a separator reading as '---' so an
// assertion pins where the rule sits rather than only that one exists.
function outline(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('[role="menuitem"], [role="separator"]')).map((el) =>
    el.getAttribute('role') === 'separator' ? '---' : text(el),
  )
}

// An item's text can carry a shortcut hint after its label, so entries are
// compared by leading label. A match folds back to the expected string, which
// keeps a failure reported as a whole-list diff rather than one index.
function expectOutline(actual: string[], expected: string[]): void {
  const folded = actual.map((entry, index) => {
    const want = expected[index]
    return want !== undefined && entry.startsWith(want) ? want : entry
  })
  expect(folded).toEqual(expected)
}

function itemNamed(root: ParentNode, label: string): HTMLElement {
  const found = Array.from(root.querySelectorAll('[role="menuitem"]')).find((el) =>
    text(el).startsWith(label),
  )
  if (!found) throw new Error(`no menu item labelled ${label}`)
  return found as HTMLElement
}

// reka-ui marks a disabled item with aria-disabled and leaves the attribute
// off entirely when it is enabled.
function isEnabled(root: ParentNode, label: string): boolean {
  return itemNamed(root, label).getAttribute('aria-disabled') !== 'true'
}

function enabledState(root: ParentNode, labels: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(labels.map((label) => [label, isEnabled(root, label)]))
}

// reka-ui keeps a closed menu mounted waiting for an exit animation jsdom never
// fires, so openness is what the menu reports, never whether the node is there.
function isOpen(el: Element | null): boolean {
  return el?.getAttribute('data-state') === 'open'
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

async function mountCanvas(): Promise<HTMLElement> {
  wrapper = mount(CanvasRegion, { attachTo: document.body })
  const viewport = wrapper.get('.canvas-viewport').element as HTMLElement
  // jsdom lays nothing out, so the canvas has no size until it is told one.
  viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
  viewport.setPointerCapture = () => {}
  await nextTick()
  return viewport
}

async function rightClick(viewport: HTMLElement): Promise<void> {
  viewport.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }),
  )
  await nextTick()
  await nextTick()
}

function canvasMenu(): HTMLElement | null {
  return document.querySelector('[role="menu"]')
}

function openCanvasMenu(): HTMLElement {
  const menu = canvasMenu()
  if (!isOpen(menu)) throw new Error('the canvas context menu did not open')
  return menu as HTMLElement
}

async function mountMenuBar(): Promise<void> {
  wrapper = mount(MenuBar, { attachTo: document.body })
  await nextTick()
}

// A real click is a sequence, and a menu trigger may open on any part of it.
function clickThrough(el: HTMLElement): void {
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }))
  }
}

async function openEditMenu(): Promise<HTMLElement> {
  const trigger = wrapper!.findAll('.menu-item').find((el) => el.text().trim() === 'Edit')
  if (!trigger) throw new Error('no Edit trigger in the menu bar')
  clickThrough(trigger.element as HTMLElement)
  await nextTick()
  await nextTick()
  const content = document.querySelector('.edit-menu-content')
  if (!isOpen(content)) throw new Error('the Edit menu did not open')
  return content as HTMLElement
}

// ===========================================================================
// The canvas context menu
// ===========================================================================

describe('canvas context menu', () => {
  it('holds exactly Cut, Copy, Duplicate, Delete, in that order', async () => {
    const viewport = await mountCanvas()
    registerVerbHandlers()
    await setMode('select')
    await rightClick(viewport)

    const items = outline(openCanvasMenu())
    expectOutline(items, CANVAS_VERBS)
    // Paste acts on the pointer rather than on what was right-clicked, so it
    // is not one of the verbs this menu offers.
    expect(items.some((entry) => entry.startsWith('Paste'))).toBe(false)
  })

  it('opens in Select mode', async () => {
    const viewport = await mountCanvas()
    registerVerbHandlers()
    await setMode('select')
    await rightClick(viewport)
    expect(isOpen(canvasMenu())).toBe(true)
  })

  // The other three modes spend the secondary button on erase, so a menu there
  // would take a gesture the mode already uses.
  for (const mode of ['draw', 'door', 'markup'] as const) {
    it(`does not open in ${mode} mode`, async () => {
      const viewport = await mountCanvas()
      registerVerbHandlers()
      await setMode(mode)
      await rightClick(viewport)
      expect(isOpen(canvasMenu())).toBe(false)
    })
  }

  // Half of a real Escape: the menu's own layer listens for the key itself, and
  // dispatching through the precedence stack alone never reaches it. What this
  // pins is the half the stack owns, that nothing below the dialog tier answers
  // the same press. Whether the menu actually goes away is a browser test.
  it('claims the dialog Esc tier while open, leaving the selection alone', async () => {
    const viewport = await mountCanvas()
    registerVerbHandlers()
    await setMode('select')
    const room = paint(['0,0'])
    const selection = useSelectionStore()
    selection.set([{ kind: 'room', id: room.id }], activeMapId())

    const lowerTier = vi.fn()
    cleanups.push(pushEscHandler('selection', lowerTier))
    expect(resolveEscape()).toBe(true)
    expect(lowerTier).toHaveBeenCalledTimes(1) // nothing above it yet

    await rightClick(viewport)
    expect(isOpen(canvasMenu())).toBe(true)

    expect(resolveEscape()).toBe(true)
    expect(lowerTier).toHaveBeenCalledTimes(1) // the dialog tier absorbed it
    expect(selection.selected).toHaveLength(1)
  })

  it('enables all four for a room selection', async () => {
    const viewport = await mountCanvas()
    registerVerbHandlers()
    await setMode('select')
    const room = paint(['0,0', '1,0'])
    useSelectionStore().set([{ kind: 'room', id: room.id }], activeMapId())
    await rightClick(viewport)

    expect(enabledState(openCanvasMenu(), CANVAS_VERBS)).toEqual({
      Cut: true,
      Copy: true,
      Duplicate: true,
      Delete: true,
    })
  })

  it('disables all four when nothing is selected', async () => {
    const viewport = await mountCanvas()
    registerVerbHandlers()
    await setMode('select')
    await rightClick(viewport)

    expect(enabledState(openCanvasMenu(), CANVAS_VERBS)).toEqual({
      Cut: false,
      Copy: false,
      Duplicate: false,
      Delete: false,
    })
  })

  // Transitions are never copied and an icon travels as content on a cell, so a
  // selection of only those two has nothing to put on a clipboard. Deleting
  // them is still meaningful.
  it('offers only Delete for a selection of icons and transitions', async () => {
    const viewport = await mountCanvas()
    registerVerbHandlers()
    await setMode('select')
    paint(['0,0'])
    paint(['4,0'])
    const icon = addIcon('0,0')
    const teleport = addTeleport('0,0', '4,0')
    useSelectionStore().set(
      [
        { kind: 'icon', id: icon.id },
        { kind: 'transition', id: teleport.id },
      ],
      activeMapId(),
    )
    await rightClick(viewport)

    expect(enabledState(openCanvasMenu(), CANVAS_VERBS)).toEqual({
      Cut: false,
      Copy: false,
      Duplicate: false,
      Delete: true,
    })
  })

  it('enables the clipboard verbs for a cell selection', async () => {
    const viewport = await mountCanvas()
    registerVerbHandlers()
    await setMode('select')
    paint(['0,0', '1,0'])
    useToolsStore().setSelectSubMode('cells')
    useSelectionStore().set([{ kind: 'cell', id: '0,0' }], activeMapId())
    await rightClick(viewport)

    expect(enabledState(openCanvasMenu(), CANVAS_VERBS)).toEqual({
      Cut: true,
      Copy: true,
      Duplicate: true,
      Delete: true,
    })
  })

  it('enables the clipboard verbs for a line selection', async () => {
    const viewport = await mountCanvas()
    registerVerbHandlers()
    await setMode('select')
    const line = addLine(['3,3', '4,3'])
    useSelectionStore().set([{ kind: 'line', id: line.id }], activeMapId())
    await rightClick(viewport)

    expect(enabledState(openCanvasMenu(), CANVAS_VERBS)).toEqual({
      Cut: true,
      Copy: true,
      Duplicate: true,
      Delete: true,
    })
  })

  // The selection is per-tab, so one belonging to another map is not something
  // this map's menu can act on.
  it('disables all four for a selection belonging to another map', async () => {
    const viewport = await mountCanvas()
    registerVerbHandlers()
    await setMode('select')
    const tabs = useTabsStore()
    const home = tabs.activeTabId
    tabs.addTab()
    const other = tabs.activeTabId
    const room = paint(['0,0'], other)
    tabs.activate(home)
    useSelectionStore().set([{ kind: 'room', id: room.id }], other)
    await rightClick(viewport)

    expect(enabledState(openCanvasMenu(), CANVAS_VERBS)).toEqual({
      Cut: false,
      Copy: false,
      Duplicate: false,
      Delete: false,
    })
  })

  // The keymap holds every action id long before a feature answers it, so an
  // item with no handler behind it would offer a command that does nothing.
  it('disables an item whose action nothing has registered', async () => {
    const viewport = await mountCanvas()
    registerVerbHandlers()
    await setMode('select')
    const room = paint(['0,0'])
    useSelectionStore().set([{ kind: 'room', id: room.id }], activeMapId())
    for (const id of CANVAS_ACTIONS) clearAction(id)
    await rightClick(viewport)

    expect(enabledState(openCanvasMenu(), CANVAS_VERBS)).toEqual({
      Cut: false,
      Copy: false,
      Duplicate: false,
      Delete: false,
    })
  })

  it('runs the action behind an enabled item', async () => {
    const viewport = await mountCanvas()
    registerVerbHandlers()
    await setMode('select')
    const room = paint(['0,0'])
    useSelectionStore().set([{ kind: 'room', id: room.id }], activeMapId())
    await rightClick(viewport)

    itemNamed(openCanvasMenu(), 'Copy').click()
    await nextTick()
    expect(handlerFor('copy')).toHaveBeenCalledTimes(1)
  })

  it('runs nothing when a disabled item is clicked', async () => {
    const viewport = await mountCanvas()
    registerVerbHandlers()
    await setMode('select')
    await rightClick(viewport)

    itemNamed(openCanvasMenu(), 'Cut').click()
    await nextTick()
    expect(handlerFor('cut')).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// The Edit menu
// ===========================================================================

describe('Edit menu', () => {
  beforeEach(async () => {
    registerVerbHandlers()
    await setMode('select')
  })

  it('lists Undo and Redo, a separator, then the seven selection verbs', async () => {
    await mountMenuBar()
    registerVerbHandlers()
    expectOutline(outline(await openEditMenu()), ['Undo', 'Redo', '---', ...EDIT_VERBS])
  })

  it('disables every verb whose action nothing has registered', async () => {
    await mountMenuBar()
    for (const id of VERB_ACTIONS) clearAction(id)
    const room = paint(['0,0'])
    useSelectionStore().set([{ kind: 'room', id: room.id }], activeMapId())

    expect(enabledState(await openEditMenu(), EDIT_VERBS)).toEqual({
      Cut: false,
      Copy: false,
      Paste: false,
      Duplicate: false,
      Delete: false,
      'Select All': false,
      Deselect: false,
    })
  })

  // Deselect needs something to deselect, so it goes with the verbs that need a
  // selection rather than with Paste and Select All.
  it('offers only Paste and Select All when nothing is selected', async () => {
    await mountMenuBar()
    registerVerbHandlers()

    expect(enabledState(await openEditMenu(), EDIT_VERBS)).toEqual({
      Cut: false,
      Copy: false,
      Paste: true,
      Duplicate: false,
      Delete: false,
      'Select All': true,
      Deselect: false,
    })
  })

  it('enables every verb for a room selection', async () => {
    await mountMenuBar()
    registerVerbHandlers()
    const room = paint(['0,0', '1,0'])
    useSelectionStore().set([{ kind: 'room', id: room.id }], activeMapId())

    expect(enabledState(await openEditMenu(), EDIT_VERBS)).toEqual({
      Cut: true,
      Copy: true,
      Paste: true,
      Duplicate: true,
      Delete: true,
      'Select All': true,
      Deselect: true,
    })
  })

  it('withholds the clipboard verbs from a selection of icons and transitions', async () => {
    await mountMenuBar()
    registerVerbHandlers()
    paint(['0,0'])
    paint(['4,0'])
    const icon = addIcon('0,0')
    const teleport = addTeleport('0,0', '4,0')
    useSelectionStore().set(
      [
        { kind: 'icon', id: icon.id },
        { kind: 'transition', id: teleport.id },
      ],
      activeMapId(),
    )

    expect(enabledState(await openEditMenu(), EDIT_VERBS)).toEqual({
      Cut: false,
      Copy: false,
      Paste: true,
      Duplicate: false,
      Delete: true,
      'Select All': true,
      Deselect: true,
    })
  })

  it('enables the clipboard verbs for a cell selection', async () => {
    await mountMenuBar()
    registerVerbHandlers()
    paint(['0,0', '1,0'])
    useToolsStore().setSelectSubMode('cells')
    useSelectionStore().set([{ kind: 'cell', id: '0,0' }], activeMapId())

    expect(enabledState(await openEditMenu(), EDIT_VERBS)).toEqual({
      Cut: true,
      Copy: true,
      Paste: true,
      Duplicate: true,
      Delete: true,
      'Select All': true,
      Deselect: true,
    })
  })

  it('enables the clipboard verbs for a line selection', async () => {
    await mountMenuBar()
    registerVerbHandlers()
    const line = addLine(['3,3', '4,3'])
    useSelectionStore().set([{ kind: 'line', id: line.id }], activeMapId())

    expect(enabledState(await openEditMenu(), EDIT_VERBS)).toEqual({
      Cut: true,
      Copy: true,
      Paste: true,
      Duplicate: true,
      Delete: true,
      'Select All': true,
      Deselect: true,
    })
  })

  it('treats a selection belonging to another map as no selection', async () => {
    await mountMenuBar()
    registerVerbHandlers()
    const tabs = useTabsStore()
    const home = tabs.activeTabId
    tabs.addTab()
    const other = tabs.activeTabId
    const room = paint(['0,0'], other)
    tabs.activate(home)
    useSelectionStore().set([{ kind: 'room', id: room.id }], other)

    expect(enabledState(await openEditMenu(), EDIT_VERBS)).toEqual({
      Cut: false,
      Copy: false,
      Paste: true,
      Duplicate: false,
      Delete: false,
      'Select All': true,
      Deselect: false,
    })
  })

  // Enablement asks two questions, a registered handler and a selection that
  // can support the verb. The active mode is not one of them.
  it('enables the same verbs outside Select mode', async () => {
    await setMode('draw')
    await mountMenuBar()
    registerVerbHandlers()
    const room = paint(['0,0'])
    useSelectionStore().set([{ kind: 'room', id: room.id }], activeMapId())

    expect(enabledState(await openEditMenu(), EDIT_VERBS)).toEqual({
      Cut: true,
      Copy: true,
      Paste: true,
      Duplicate: true,
      Delete: true,
      'Select All': true,
      Deselect: true,
    })
  })

  it('runs the action behind an enabled item', async () => {
    await mountMenuBar()
    registerVerbHandlers()
    itemNamed(await openEditMenu(), 'Paste').click()
    await nextTick()
    expect(handlerFor('paste')).toHaveBeenCalledTimes(1)
  })

  it('runs nothing when a disabled item is clicked', async () => {
    await mountMenuBar()
    registerVerbHandlers()
    itemNamed(await openEditMenu(), 'Deselect').click()
    await nextTick()
    expect(handlerFor('deselect')).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Delete's two granularities
// ===========================================================================

// No handlers are registered here: the point is what the app itself puts
// behind `deleteSelection`, so a test double would answer its own question.
describe('the deleteSelection action', () => {
  it('deletes the selected rooms in the Rooms sub-mode', async () => {
    await mountCanvas()
    await setMode('select')
    useToolsStore().setSelectSubMode('rooms')
    const room = paint(['0,0', '1,0'])
    const model = useModelStore()
    useSelectionStore().set([{ kind: 'room', id: room.id }], activeMapId())

    expect(runAction('deleteSelection')).toBe(true)
    await nextTick()
    expect(model.project.mapsById.get(activeMapId())!.rooms.size).toBe(0)
  })

  // In the Cells sub-mode the key means "erase the selected cells", which does
  // not exist yet. Falling through to the room delete would destroy whole rooms
  // the user never selected.
  // Two granularities, one key, two ops. Erasing takes the cells back to bare
  // grid and leaves the room holding whatever is left of it, where the same key
  // one granularity over would delete the room outright.
  it('erases the cells rather than deleting their room, in the Cells sub-mode', async () => {
    await mountCanvas()
    await setMode('select')
    useToolsStore().setSelectSubMode('cells')
    const room = paint(['0,0', '1,0'])
    const model = useModelStore()
    useSelectionStore().set([{ kind: 'cell', id: '0,0' }], activeMapId())

    expect(runAction('deleteSelection')).toBe(true)
    await nextTick()
    const map = model.project.mapsById.get(activeMapId())!
    expect(map.rooms.get(room.id)?.cells.has('0,0')).toBe(false)
    expect(map.rooms.get(room.id)?.cells.has('1,0')).toBe(true)
  })

  it('deletes selected icons and lines in Markup mode', async () => {
    await mountCanvas()
    await setMode('markup')
    paint(['0,0'])
    const icon = addIcon('0,0')
    const line = addLine(['3,3', '4,3'])
    const model = useModelStore()
    useSelectionStore().set(
      [
        { kind: 'icon', id: icon.id },
        { kind: 'line', id: line.id },
      ],
      activeMapId(),
    )

    expect(runAction('deleteSelection')).toBe(true)
    await nextTick()
    const map = model.project.mapsById.get(activeMapId())!
    expect(map.icons.size).toBe(0)
    expect(map.lines.size).toBe(0)
    expect(map.rooms.size).toBe(1) // the room the icon sat on is not the target
  })

  it('deletes a selected transition in Door mode', async () => {
    await mountCanvas()
    await setMode('door')
    paint(['0,0'])
    paint(['4,0'])
    const teleport = addTeleport('0,0', '4,0')
    const model = useModelStore()
    useSelectionStore().set([{ kind: 'transition', id: teleport.id }], activeMapId())

    expect(runAction('deleteSelection')).toBe(true)
    await nextTick()
    const map = model.project.mapsById.get(activeMapId())!
    expect(map.transitions.size).toBe(0)
    expect(map.rooms.size).toBe(2)
  })
})
