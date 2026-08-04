<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import HierarchyIcon from './HierarchyIcon.vue'
import { PROJECT_SCOPE, dependOn, useModelStore } from '@/stores/model'
import { useSelectionStore } from '@/stores/selection'
import { useTabsStore } from '@/stores/tabs'
import { createNewArea } from '@/core/ops/project'
import { freshAreaName, roomLabel } from '@/i18n/naming'
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
  level: 1
  selected: boolean
  childCount: number
}

interface RoomRow {
  kind: 'room'
  id: RoomId
  label: string
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

function addArea() {
  const existing = [...model.project.areas.values()].map((area) => area.name)
  const palette = NEW_AREA_COLORS[model.project.areas.size % NEW_AREA_COLORS.length]
  model.run(t('history.addArea'), PROJECT_SCOPE, (tx) =>
    createNewArea(tx, model.project, freshAreaName(existing), palette.cell, palette.wall),
  )
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

  <ul class="hierarchy-tree" role="tree" :aria-label="t('hierarchy.tree')">
    <li
      v-for="(row, index) in rows"
      :key="`${row.kind}:${row.id}`"
      :ref="(el) => setRowRef(el as Element | null, index)"
      role="treeitem"
      class="hierarchy-row"
      :class="{ selected: row.selected, area: row.kind === 'area' }"
      :style="{ '--depth': row.level - 1 }"
      :data-row-kind="row.kind"
      :data-row-id="row.id"
      :aria-label="row.label"
      :aria-level="row.level"
      :aria-posinset="positions[index].posInSet"
      :aria-setsize="positions[index].setSize"
      :aria-selected="row.selected"
      :aria-expanded="row.kind === 'area' && row.childCount > 0 ? !isCollapsed(row.id) : undefined"
      :tabindex="index === focusedIndex ? 0 : -1"
      @focus="focusedIndex = index"
      @click="selectRow(row, index, $event.shiftKey)"
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
      <span class="hierarchy-label">{{ row.label }}</span>
    </li>
  </ul>
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

.hierarchy-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
