<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger,
} from 'reka-ui'
import HierarchyIcon from './HierarchyIcon.vue'
import ConfirmAreaDelete from '../modals/ConfirmAreaDelete.vue'
import { PROJECT_SCOPE, dependOn, useModelStore } from '@/stores/model'
import { useSelectionStore } from '@/stores/selection'
import { useTabsStore } from '@/stores/tabs'
import {
  createAreaFromRoom,
  createNewArea,
  deleteArea,
  isImmutableArea,
  renameArea,
  roomsInArea,
} from '@/core/ops/project'
import { assignRoomArea, deleteRooms, renameRoom, reorderRoom } from '@/core/ops/rooms'
import { dropTargetAt, planDrop, type DropTarget } from '@/panels/hierarchyDrop'
import { startPointerDrag } from '@/composables/pointerDrag'
import { DRAG_DEAD_ZONE } from '@/config/constants'
import { duplicateRooms } from '@/core/ops/clipboard'
import { useDialogEscTier } from '@/hotkeys/useDialogEscTier'
import { mapScope } from '@/stores/model'
import { useInlineEdit } from '@/composables/useInlineEdit'
import { copyNamer, freshAreaName, roomLabel } from '@/i18n/naming'
import { t } from '@/i18n'
import type { AreaId, RoomId } from '@/core/ids'
import type { ObjectRef, Room } from '@/core/types'

// Areas and the rooms in them, for the tab in front of you.
//
// Rooms are per-tab and areas are project-wide, which is why every area shows
// on every tab even with nothing under it here: an empty area is still
// selectable, still has properties, and is otherwise unreachable from a tab
// none of its rooms are on.
//
// Rendered flat with `aria-level` rather than as nested lists. A tree is a list
// of visible rows to everything that reads it: the keyboard walks that list,
// and nesting would turn the walk into a traversal describing the same order.
//
// Cells have no row here. A cell selection highlights nothing, because the room
// that owns it is not what is selected and marking it would say otherwise.
//
// The tree reads and writes the one selection store and keeps no idea of its
// own about what is selected. That is the whole of the two-way sync: a second
// copy is what would drift from the canvas.
//
// Each row names itself with `aria-label` rather than letting the name be
// computed from its contents, which would fold the twisty's own label into it
// and read as "Collapse Crateria Crateria".

interface AreaRow {
  kind: 'area'
  id: AreaId
  label: string
  // What a rename starts from, which is not always what the row shows: an
  // unnamed room displays a positional fallback, and seeding the editor with
  // that would turn "Room at 4,2" into the room's actual name on commit.
  name: string
  level: 1
  selected: boolean
  childCount: number
}

interface RoomRow {
  kind: 'room'
  id: RoomId
  label: string
  name: string
  level: 2
  selected: boolean
}

type Row = AreaRow | RoomRow

const model = useModelStore()
const selection = useSelectionStore()
const tabsStore = useTabsStore()

// New areas cycle a small palette rather than all arriving the same colour,
// which is the difference between a tree of distinguishable areas and one the
// user has to recolour before it says anything. Recoloured in the Inspector.
const NEW_AREA_COLORS: { cell: string; wall: string }[] = [
  { cell: '#3a5f7d', wall: '#7fb2d9' },
  { cell: '#6b4a7d', wall: '#b98fd9' },
  { cell: '#4a7d5b', wall: '#86d9a1' },
  { cell: '#7d6a3a', wall: '#d9bd7f' },
  { cell: '#7d3a4a', wall: '#d97f92' },
]

const collapsed = ref<ReadonlySet<AreaId>>(new Set())
// Narrows what is shown, and nothing else: a row filtered out stays selected
// and stays deletable. Local to this tab and to this panel.
const filter = ref('')
// Which row the keyboard is on. A roving tabindex: the tree is one tab stop,
// and the arrows move within it.
const focusedIndex = ref(0)
const rowRefs = ref<HTMLElement[]>([])

function setRowRef(el: Element | null, index: number) {
  if (el instanceof HTMLElement) rowRefs.value[index] = el
}

// A selection belongs to the tab it was made on, so one left on another tab
// highlights nothing here, exactly as it reaches none of this tab's keys.
const selectedRooms = computed(() => new Set(selection.roomsOn(tabsStore.activeTabId)))

const selectedAreas = computed(() => {
  const ids = new Set<AreaId>()
  if (selection.mapId !== tabsStore.activeTabId) return ids
  for (const ref of selection.selected) {
    if (ref.kind === 'area') ids.add(ref.id)
  }
  return ids
})

const query = computed(() => filter.value.trim().toLowerCase())

function matches(label: string): boolean {
  return label.toLowerCase().includes(query.value)
}

// Areas in project order, which is the order they were created and the order
// they serialise in. World comes first by being created first, not by being
// sorted there.
//
// While a filter is on, a matching area keeps all its rooms and a matching room
// keeps its area as its parent, and collapse state is ignored: a match hidden
// under a closed area makes the filter look broken.
const rows = computed<Row[]>(() => {
  dependOn(model.rev, model.structureRev)
  const map = model.project.mapsById.get(tabsStore.activeTabId)
  const filtering = query.value !== ''
  const out: Row[] = []

  for (const area of model.project.areas.values()) {
    const all = map
      ? map.roomOrder
          .map((roomId) => map.rooms.get(roomId))
          .filter((room): room is Room => room !== undefined && room.areaId === area.id)
      : []

    const areaMatches = matches(area.name)
    const rooms = !filtering || areaMatches ? all : all.filter((room) => matches(roomLabel(room)))
    if (filtering && !areaMatches && rooms.length === 0) continue

    out.push({
      kind: 'area',
      id: area.id,
      label: area.name,
      name: area.name,
      level: 1,
      selected: selectedAreas.value.has(area.id),
      childCount: rooms.length,
    })

    if (!filtering && collapsed.value.has(area.id)) continue
    for (const room of rooms) {
      out.push({
        kind: 'room',
        id: room.id,
        label: roomLabel(room),
        name: room.name,
        level: 2,
        selected: selectedRooms.value.has(room.id),
      })
    }
  }

  return out
})

// Position among siblings, which ARIA wants per row and a flat list has to
// count. Areas are siblings of areas; a room's siblings are the rooms under
// its own area, so a collapsed area contributes none.
const positions = computed(() => {
  const out: { posInSet: number; setSize: number }[] = []
  const areaCount = model.project.areas.size
  let areaIndex = 0
  let roomIndex = 0
  let siblingRooms = 0

  for (const row of rows.value) {
    if (row.kind === 'area') {
      areaIndex++
      roomIndex = 0
      siblingRooms = row.childCount
      out.push({ posInSet: areaIndex, setSize: areaCount })
    } else {
      roomIndex++
      out.push({ posInSet: roomIndex, setSize: siblingRooms })
    }
  }
  return out
})

// A filtered tree ignores collapse state, so the twisty says so rather than
// claiming a state the rows do not reflect.
function isCollapsed(id: AreaId): boolean {
  return query.value === '' && collapsed.value.has(id)
}

// Created, then immediately renamed. An area named by a default and left that
// way is the state nobody wants, and the row does not exist to edit until the
// tree has re-rendered around it.
function addArea() {
  const existing = [...model.project.areas.values()].map((area) => area.name)
  const palette = NEW_AREA_COLORS[model.project.areas.size % NEW_AREA_COLORS.length]
  const area = model.run(t('history.addArea'), PROJECT_SCOPE, (tx) =>
    createNewArea(tx, model.project, freshAreaName(existing), palette.cell, palette.wall),
  )
  requestRenameOf(`area:${area.id}`)
}

function toggle(id: AreaId) {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
}

// Which `ObjectRef` a row stands for. Rooms and areas are the two kinds the
// tree can reach, and areas are reachable from nowhere else.
function refOf(row: Row): ObjectRef {
  return row.kind === 'area' ? { kind: 'area', id: row.id } : { kind: 'room', id: row.id }
}

// A press on a row selects through the shared policy, so the tree cannot
// disagree with the four dispatches that already use it: click replaces,
// shift-click toggles.
//
// Selecting here never changes the mode. Reaching a room from the tree is a
// way of pointing at it, not of deciding what to do to it next.
//
// A click on the panel's own dead space does nothing. "A click on nothing
// clears" is the canvas's rule, where empty space is a real target; in a list
// the space below the last row is layout, and clearing there would make
// scrollback a selection hazard.
function selectRow(row: Row, index: number, additive: boolean) {
  focusedIndex.value = index
  fromTree = true
  selection.clickSelect(refOf(row), tabsStore.activeTabId, additive)
}

// A selection made on the canvas scrolls its row into view; one made here moves
// no camera and needs no scroll, since the row was already under the pointer.
let fromTree = false

watch(
  () => selection.selected,
  () => {
    if (fromTree) {
      fromTree = false
      return
    }
    const first = rows.value.findIndex((row) => row.selected)
    if (first >= 0) rowRefs.value[first]?.scrollIntoView({ block: 'nearest' })
  },
  { flush: 'post' },
)

// Drag a room onto an area to join it, or between two rooms to place it.
//
// Its own drag rather than `useDragReorder`, which reorders a flat list of ids
// and commits live as the pointer crosses each midpoint. This needs two drop
// semantics, a preview that says which one is about to happen, and a single
// transaction on release: a live splice per crossed midpoint would put a row of
// undo entries behind one gesture.
const draggingRoom = ref<RoomId | null>(null)
const dropTarget = ref<DropTarget | null>(null)
// A completed drag still ends in a synthetic click; this swallows exactly that
// one, so dropping a row does not also select it.
let justDragged = false

function dropRows() {
  return rows.value.flatMap((row, index) => {
    const el = rowRefs.value[index]
    if (!el) return []
    const rect = el.getBoundingClientRect()
    return [{ kind: row.kind, id: row.id, top: rect.top, height: rect.height }]
  })
}

function startRowDrag(event: PointerEvent, row: Row) {
  if (row.kind !== 'room' || editing.value) return
  if ((event.target as HTMLElement).closest('.hierarchy-rename, .hierarchy-twisty')) return

  // Capture at press, not deferred. The drag primitive listens on the element
  // the press began on, and a row drag leaves that row almost immediately: with
  // capture deferred, a fast drag to a distant area never reports a move back
  // to the row and no drag ever starts. Capturing costs nothing here, since a
  // completed drag already swallows its own click.
  startPointerDrag(event, {
    deadZone: DRAG_DEAD_ZONE,
    deadZoneAxis: 'y',
    onStart: () => {
      draggingRoom.value = row.id
    },
    onMove: ({ event: current }) => {
      if (!draggingRoom.value) return
      dropTarget.value = dropTargetAt(current.clientY, dropRows())
    },
    onEnd: ({ dragged }) => {
      justDragged = dragged
      const target = dropTarget.value
      const roomId = draggingRoom.value
      draggingRoom.value = null
      dropTarget.value = null
      if (dragged && roomId && target) applyDrop(roomId, target)
    },
  })
}

function applyDrop(roomId: RoomId, target: DropTarget) {
  const mapId = tabsStore.activeTabId
  const map = model.project.mapsById.get(mapId)
  if (!map) return
  const plan = planDrop(target, roomId, map.roomOrder, (id) => map.rooms.get(id)?.areaId)
  if (!plan) return

  const from = map.rooms.get(roomId)?.areaId
  const reassigning = from !== undefined && from !== plan.areaId
  // Reassign and placement are one transaction, because a cross-area drop is
  // one gesture and one undo step: dropping a room into another area between
  // two of its rooms does both, and the user asked for it once.
  model.run(
    reassigning ? t('history.assignArea') : t('history.reorderRoom'),
    mapScope(mapId),
    (tx) => {
      if (reassigning) assignRoomArea(tx, map, roomId, plan.areaId)
      if (plan.toIndex !== null) reorderRoom(tx, map, roomId, plan.toIndex)
    },
  )
}

// The two previews, which must never both show: an area row fills, a room row
// grows a line on the edge the drop would land against.
function dropClass(row: Row): string | null {
  const target = dropTarget.value
  if (!target || !draggingRoom.value) return null
  if (target.kind === 'intoArea') {
    return row.kind === 'area' && row.id === target.areaId ? 'drop-into' : null
  }
  if (row.kind !== 'room' || row.id !== target.roomId) return null
  return target.after ? 'drop-after' : 'drop-before'
}

function swallowClickAfterDrag(event: MouseEvent) {
  if (!justDragged) return
  justDragged = false
  event.stopPropagation()
}

function keyOf(row: Row): string {
  return `${row.kind}:${row.id}`
}

// Inline rename, the third home of the pattern the project title and the tab
// names already use. One editor for the whole tree: only one row is ever being
// renamed, so the row being edited is a key rather than per-row state.
const editingKey = ref<string | null>(null)

function editingRow(): Row | null {
  return rows.value.find((row) => keyOf(row) === editingKey.value) ?? null
}

const {
  editing,
  draft,
  setInputRef,
  start: startEdit,
  commit: commitEdit,
  cancel: cancelEdit,
} = useInlineEdit(
  () => editingRow()?.name ?? '',
  (value) => applyRename(value),
)

// World is the guaranteed fallback for every room, so it cannot be renamed.
// Refused here as well as in the op, which is the same question asked once:
// a row that opened an editor and then discarded the result would be worse
// than one that never opened it.
function canRename(row: Row): boolean {
  return row.kind === 'room' || !isImmutableArea(row.id)
}

function beginRename(row: Row, index: number) {
  if (!canRename(row)) return
  focusedIndex.value = index
  editingKey.value = keyOf(row)
  startEdit()
}

function applyRename(value: string) {
  const row = editingRow()
  if (!row) return
  if (row.kind === 'area') {
    model.run(t('history.renameArea'), PROJECT_SCOPE, (tx) =>
      renameArea(tx, model.project, row.id, value),
    )
    return
  }
  const mapId = tabsStore.activeTabId
  const map = model.project.mapsById.get(mapId)
  if (!map) return
  model.run(t('history.renameRoom'), mapScope(mapId), (tx) => renameRoom(tx, map, row.id, value))
}

function finishRename() {
  commitEdit()
  editingKey.value = null
}

function abandonRename() {
  cancelEdit()
  editingKey.value = null
}

// The row menu: one menu for the whole tree, acting on the row that was
// right-clicked, in the shape the canvas menu already uses. One per row would
// mount a Reka root per room.
//
// A right-click aims. An unselected row is selected alone first, so the verbs
// act on what was pointed at; a right-click inside a multi-selection leaves it
// whole. Both are the canvas's rules, and the tree has no reason to differ.
const menuRow = ref<Row | null>(null)
const confirmingDelete = ref(false)

useDialogEscTier(confirmingDelete)

function aimAt(row: Row, index: number) {
  menuRow.value = row
  focusedIndex.value = index
  if (!row.selected) selectRow(row, index, false)
}

// One predicate per verb, read by the item's disabled state and by the handler
// both. Two conditions that agree today are how the two drift tomorrow.
function canDuplicate(row: Row | null): row is RoomRow {
  return row?.kind === 'room'
}

function canDelete(row: Row | null): boolean {
  if (!row) return false
  return row.kind === 'room' || !isImmutableArea(row.id)
}

function canAreaFromRoom(row: Row | null): row is RoomRow {
  return row?.kind === 'room'
}

const menuItems = computed(() => {
  const row = menuRow.value
  return [
    { id: 'rename', label: t('hierarchy.menu.rename'), enabled: !!row && canRename(row) },
    { id: 'duplicate', label: t('hierarchy.menu.duplicate'), enabled: canDuplicate(row) },
    { id: 'areaFromRoom', label: t('hierarchy.menu.areaFromRoom'), enabled: canAreaFromRoom(row) },
    { id: 'delete', label: t('hierarchy.menu.delete'), enabled: canDelete(row) },
  ]
})

// A rename asked for from the menu waits for the menu to close.
//
// Reka returns focus to the trigger as it closes, and the trigger here is the
// whole tree: an editor opened before that lands is focused and then instantly
// blurred, which commits an edit the user never typed.
const pendingRename = ref<string | null>(null)

// Reka hands focus back to the trigger as the menu unmounts. When the item
// picked was Rename, that focus lands on the tree and blurs the editor the
// same frame it opens, committing an edit nobody typed. Refusing the restore
// leaves focus for the editor to claim.
// Either state means an editor is coming or already here, and the two cover
// both orderings: the restore can land before the deferred open or after it.
function onMenuCloseAutoFocus(event: Event) {
  if (pendingRename.value || editing.value) event.preventDefault()
}

// Opens an editor on a row named by key, a tick later.
//
// The tick is what lets a row that does not exist yet be renamed: creating an
// area and naming it are one gesture, and the row only appears once the tree
// has re-rendered. It is also long enough for a menu to be on its way out.
//
// Not driven off the menu's close event: a real browser closes the menu before
// running the item that was picked, so a flag set from the item arrives after
// the close and nothing would ever read it.
function requestRenameOf(key: string) {
  pendingRename.value = key
  nextTick(() => {
    pendingRename.value = null
    const index = rows.value.findIndex((each) => keyOf(each) === key)
    if (index >= 0) beginRename(rows.value[index], index)
  })
}

function runMenuItem(id: string) {
  const row = menuRow.value
  if (!row) return
  switch (id) {
    case 'rename':
      if (canRename(row)) requestRenameOf(keyOf(row))
      return
    case 'duplicate':
      if (canDuplicate(row)) duplicateRoom(row)
      return
    case 'areaFromRoom':
      if (canAreaFromRoom(row)) areaFromRoom(row)
      return
    case 'delete':
      if (canDelete(row)) deleteRow(row)
      return
  }
}

// The same op and the same locked naming the canvas menu and Ctrl+D run, but
// not routed through that action: the clipboard verbs belong to Select mode
// alone, and the tree is mode-independent by design.
function duplicateRoom(row: RoomRow) {
  const mapId = tabsStore.activeTabId
  const map = model.project.mapsById.get(mapId)
  if (!map) return
  const copies = model.run(t('history.duplicate'), mapScope(mapId), (tx) =>
    duplicateRooms(tx, model.project, map, [row.id], {
      nameFor: copyNamer([...map.rooms.values()].map((room) => room.name)),
    }),
  )
  fromTree = true
  selection.set(
    copies.map((room) => ({ kind: 'room', id: room.id }) as const),
    mapId,
  )
}

// The deferred "I just want to colour one room" fast path. It lives here and
// nowhere else: creation belongs in one surface, which is why Draw's area
// picker only picks.
function areaFromRoom(row: RoomRow) {
  const mapId = tabsStore.activeTabId
  const existing = [...model.project.areas.values()].map((area) => area.name)
  const palette = NEW_AREA_COLORS[model.project.areas.size % NEW_AREA_COLORS.length]
  const area = model.run(t('history.areaFromRoom'), PROJECT_SCOPE, (tx) =>
    createAreaFromRoom(
      tx,
      model.project,
      mapId,
      row.id,
      freshAreaName(existing),
      palette.cell,
      palette.wall,
    ),
  )
  requestRenameOf(`area:${area.id}`)
}

// A room goes straight away: undoable, and visibly gone from a tab you are
// looking at. An area asks first, because its rooms are project-wide and the
// ones it reassigns may be on tabs you are not.
function deleteRow(row: Row) {
  if (row.kind === 'area') {
    confirmingDelete.value = true
    return
  }
  const mapId = tabsStore.activeTabId
  const map = model.project.mapsById.get(mapId)
  if (!map) return
  model.run(t('history.deleteRoom'), mapScope(mapId), (tx) =>
    deleteRooms(tx, model.project, map, [row.id]),
  )
}

// What the delete will actually move, asked ahead of the action rather than
// returned by it, and computed only while the dialog is open: it walks every
// map's rooms, which is not work to do on every render.
const deleteImpact = computed(() => {
  if (!confirmingDelete.value) return null
  dependOn(model.rev, model.structureRev)
  const row = menuRow.value
  if (row?.kind !== 'area') return null
  return { name: row.label, rooms: roomsInArea(model.project, row.id) }
})

function confirmDeleteArea() {
  const row = menuRow.value
  if (row?.kind !== 'area' || !canDelete(row)) return
  model.run(t('history.deleteArea'), PROJECT_SCOPE, (tx) => deleteArea(tx, model.project, row.id))
}

function focusRow(index: number) {
  const clamped = Math.max(0, Math.min(index, rows.value.length - 1))
  focusedIndex.value = clamped
  rowRefs.value[clamped]?.focus()
}

// Arrow keys move focus and open and close areas. What a row *selects* is the
// next chunk's question; being able to reach every row without a pointer is
// this one's, and the two are independent.
function handleKeydown(event: KeyboardEvent, index: number) {
  const row = rows.value[index]
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      focusRow(index + 1)
      return
    case 'ArrowUp':
      event.preventDefault()
      focusRow(index - 1)
      return
    case 'Home':
      event.preventDefault()
      focusRow(0)
      return
    case 'End':
      event.preventDefault()
      focusRow(rows.value.length - 1)
      return
    case 'ArrowRight':
      event.preventDefault()
      // Open a closed area, then step into it. On a room, and on an area with
      // nothing under it, there is nowhere further right to go.
      if (row.kind === 'area' && row.childCount > 0) {
        if (isCollapsed(row.id)) toggle(row.id)
        else focusRow(index + 1)
      }
      return
    // The tree-standard rename key, and the only route to it without a pointer
    // until the row menu lands.
    case 'F2':
      event.preventDefault()
      beginRename(row, index)
      return
    // The keyboard's own way to select the focused row, matching the click.
    case 'Enter':
    case ' ':
      event.preventDefault()
      selectRow(row, index, event.shiftKey)
      return
    case 'ArrowLeft': {
      event.preventDefault()
      if (row.kind === 'area') {
        if (!isCollapsed(row.id) && row.childCount > 0) toggle(row.id)
        return
      }
      // Out of a room is up to its area, which is the nearest area above it.
      for (let above = index - 1; above >= 0; above--) {
        if (rows.value[above].kind === 'area') {
          focusRow(above)
          return
        }
      }
      return
    }
  }
}
</script>

<template>
  <div class="hierarchy-toolbar">
    <input
      v-model="filter"
      type="search"
      class="hierarchy-filter"
      :placeholder="t('hierarchy.filter')"
      :aria-label="t('hierarchy.filter')"
    />
    <button
      type="button"
      class="hierarchy-add"
      :title="t('hierarchy.addArea')"
      :aria-label="t('hierarchy.addArea')"
      @click="addArea"
    >
      ＋
    </button>
  </div>

  <p v-if="rows.length === 0" class="hierarchy-empty">
    {{ t('hierarchy.noMatches', { query: filter.trim() }) }}
  </p>

  <ContextMenuRoot>
    <ContextMenuTrigger as-child>
      <ul
        class="hierarchy-tree"
        role="tree"
        :aria-label="t('hierarchy.tree')"
        @click.capture="swallowClickAfterDrag"
      >
        <li
          v-for="(row, index) in rows"
          :key="`${row.kind}:${row.id}`"
          :ref="(el) => setRowRef(el as Element | null, index)"
          role="treeitem"
          class="hierarchy-row"
          :class="[
            {
              selected: row.selected,
              area: row.kind === 'area',
              dragging: draggingRoom === row.id,
            },
            dropClass(row),
          ]"
          :style="{ '--depth': row.level - 1 }"
          :data-row-kind="row.kind"
          :data-row-id="row.id"
          :aria-label="row.label"
          :aria-level="row.level"
          :aria-posinset="positions[index].posInSet"
          :aria-setsize="positions[index].setSize"
          :aria-selected="row.selected"
          :aria-expanded="
            row.kind === 'area' && row.childCount > 0 ? !isCollapsed(row.id) : undefined
          "
          :tabindex="index === focusedIndex ? 0 : -1"
          @focus="focusedIndex = index"
          @click="selectRow(row, index, $event.shiftKey)"
          @dblclick="beginRename(row, index)"
          @contextmenu="aimAt(row, index)"
          @pointerdown="startRowDrag($event, row)"
          @keydown="handleKeydown($event, index)"
        >
          <button
            v-if="row.kind === 'area' && row.childCount > 0"
            type="button"
            class="hierarchy-twisty"
            :aria-label="
              isCollapsed(row.id)
                ? t('hierarchy.expandArea', { name: row.label })
                : t('hierarchy.collapseArea', { name: row.label })
            "
            tabindex="-1"
            @click.stop="toggle(row.id)"
          >
            {{ isCollapsed(row.id) ? '▸' : '▾' }}
          </button>
          <span v-else class="hierarchy-twisty-spacer" aria-hidden="true" />
          <HierarchyIcon :kind="row.kind" />
          <input
            v-if="editing && editingKey === keyOf(row)"
            :ref="setInputRef"
            v-model="draft"
            class="hierarchy-rename"
            :data-row-id="row.id"
            @click.stop
            @dblclick.stop
            @keydown.stop
            @keydown.enter="finishRename"
            @keydown.esc="abandonRename"
            @blur="finishRename"
          />
          <span v-else class="hierarchy-label">{{ row.label }}</span>
        </li>
      </ul>
    </ContextMenuTrigger>

    <ContextMenuPortal>
      <ContextMenuContent
        class="popover-surface"
        style="--popover-min-width: 11rem"
        @close-auto-focus="onMenuCloseAutoFocus"
      >
        <ContextMenuItem
          v-for="item in menuItems"
          :key="item.id"
          class="popover-item"
          :disabled="!item.enabled"
          @select="runMenuItem(item.id)"
        >
          {{ item.label }}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>

  <ConfirmAreaDelete
    v-model:open="confirmingDelete"
    :names="deleteImpact ? [deleteImpact.name] : []"
    :rooms="deleteImpact?.rooms ?? 0"
    @confirm="confirmDeleteArea"
  />
</template>

<style scoped>
/* Indent per level, and where the guide line for that level sits. One number,
   so the line always lands under the twisty of the row above it. */
.hierarchy-tree {
  --row-indent: 0.875rem;
  --guide-offset: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hierarchy-toolbar {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-bottom: 0.375rem;
}

.hierarchy-filter {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 0.8125rem;
  padding: 0.1875rem 0.375rem;
}
.hierarchy-filter:focus {
  outline: none;
  border-color: var(--accent);
}

.hierarchy-add {
  flex: none;
  width: 1.5rem;
  height: 1.5rem;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  background: transparent;
  color: var(--fg);
  font: inherit;
  font-size: 0.75rem;
  line-height: 1;
  cursor: pointer;
}
.hierarchy-add:hover {
  background: var(--surface-active);
}

.hierarchy-empty {
  margin: 0;
  color: var(--fg);
  opacity: 0.6;
  font-size: 0.8125rem;
}

.hierarchy-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.1875rem;
  padding: 0.125rem 0.25rem;
  padding-left: calc(0.25rem + var(--depth) * var(--row-indent));
  border-radius: 0.1875rem;
  font-size: 0.8125rem;
  line-height: 1.25rem;
  color: var(--fg);
  cursor: default;
  user-select: none;
}

/* The vertical guide running down a section, drawn per child row rather than
   per section: the rows are a flat list, so a line spanning them would have to
   be an element outside the list positioned over it. */
.hierarchy-row:not(.area)::before {
  content: '';
  position: absolute;
  left: calc(0.25rem + (var(--depth) - 1) * var(--row-indent) + var(--guide-offset));
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--border);
}
.hierarchy-row:hover {
  background: var(--surface-active);
}
.hierarchy-row.dragging {
  opacity: 0.5;
}

/* The two drop previews. An area fills, so "this row is the destination"; a
   room grows a line on one edge, so "the gap here is the destination". */
.hierarchy-row.drop-into {
  background: var(--accent);
  color: #fff;
}
.hierarchy-row.drop-before,
.hierarchy-row.drop-after {
  position: relative;
}
.hierarchy-row.drop-before::after,
.hierarchy-row.drop-after::after {
  content: '';
  position: absolute;
  left: calc(0.25rem + var(--depth) * var(--row-indent));
  right: 0.25rem;
  height: 2px;
  background: var(--accent);
  pointer-events: none;
}
.hierarchy-row.drop-before::after {
  top: -1px;
}
.hierarchy-row.drop-after::after {
  bottom: -1px;
}
.hierarchy-row:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
.hierarchy-row.area {
  font-weight: 600;
}
.hierarchy-row.selected {
  background: var(--accent);
  color: #fff;
}
.hierarchy-row.selected:hover {
  background: var(--accent);
}

.hierarchy-twisty,
.hierarchy-twisty-spacer {
  flex: none;
  width: 1rem;
  height: 1rem;
  line-height: 1;
}

.hierarchy-twisty {
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.6875rem;
  cursor: pointer;
  padding: 0;
}

.hierarchy-rename {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--accent);
  border-radius: 0.1875rem;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 0.8125rem;
  padding: 0 0.125rem;
}
.hierarchy-rename:focus {
  outline: none;
}

.hierarchy-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
