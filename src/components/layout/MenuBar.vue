<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDialogEscTier } from '@/hotkeys/useDialogEscTier'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from 'reka-ui'
import { PROJECT_SCOPE, useModelStore } from '@/stores/model'
import { renameProject } from '@/core/ops/project'
import { useUiStore } from '@/stores/ui'
import { usePanelsStore } from '@/stores/panels'
import { PANEL_REGISTRY } from '@/panels/registry'
import { useThemeStore, type ThemeMode } from '@/stores/theme'
import { useCanvasViewStore, type RulerUnits } from '@/stores/canvasView'
import { useSelectionStore } from '@/stores/selection'
import { useClipboardStore } from '@/stores/clipboard'
import { useModeStore } from '@/stores/mode'
import { useTabsStore } from '@/stores/tabs'
import { hasAction, runAction } from '@/hotkeys/actions'
import type { ActionId } from '@/hotkeys/keymap'
import { t } from '@/i18n'
import type { MessageKey } from '@/i18n'
import { useInlineEdit } from '@/composables/useInlineEdit'

const model = useModelStore()
const ui = useUiStore()
const panelsStore = usePanelsStore()
const themeStore = useThemeStore()
const canvasView = useCanvasViewStore()
const selection = useSelectionStore()
const clipboard = useClipboardStore()
const modeStore = useModeStore()
const tabsStore = useTabsStore()

// Destructured so the template gets plain (auto-unwrapped) bindings, and so
// `ref="titleInput"` resolves: a template ref attribute takes the name of a
// setup binding, not a path into an object.
const {
  editing: titleEditing,
  draft: titleDraft,
  setInputRef: setTitleInputRef,
  start: startTitleEdit,
  commit: commitTitleEdit,
  cancel: cancelTitleEdit,
} = useInlineEdit(
  () => model.projectName,
  (name) =>
    model.run(t('history.renameProject'), PROJECT_SCOPE, (tx) =>
      renameProject(tx, model.project, name),
    ),
)

const THEME_OPTIONS: { mode: ThemeMode; labelKey: MessageKey }[] = [
  { mode: 'system', labelKey: 'menu.view.theme.system' },
  { mode: 'light', labelKey: 'menu.view.theme.light' },
  { mode: 'dark', labelKey: 'menu.view.theme.dark' },
]

const RULER_UNIT_OPTIONS: { units: RulerUnits; labelKey: MessageKey }[] = [
  { units: 'cells', labelKey: 'menu.view.units.cells' },
  { units: 'px', labelKey: 'menu.view.units.px' },
]

const GITHUB_URL = 'https://github.com/Kassanu/metroidvania-map-maker'
const WIKI_URL = `${GITHUB_URL}/wiki`

// Each menu's open state is tracked so it can claim the Esc precedence stack's
// `dialog` tier while it is open. Reka's own DismissableLayer is what actually
// closes the menu on Escape; this only tells the global dispatcher a menu is
// open, so a lower-tier handler does not also respond to the same press.
const editMenuOpen = ref(false)
const viewMenuOpen = ref(false)
const helpMenuOpen = ref(false)
useDialogEscTier(editMenuOpen)
useDialogEscTier(viewMenuOpen)
useDialogEscTier(helpMenuOpen)

// Keeps the menu open across multiple toggles: without this, selecting one
// checkbox closes the menu (Reka's default select behavior), same as any
// other menu item.
function keepMenuOpen(event: Event) {
  event.preventDefault()
}

// Restores collapsed/width/order/size/visibility to their registry defaults
// on both sidebars: the escape hatch for a mangled layout.
function resetSidebars() {
  ui.resetSidebarLayout()
  panelsStore.resetLayout()
}

// File is still an inert placeholder: it needs file I/O, which does not exist
// yet.
const inertMenus: MessageKey[] = ['menu.file']

// "Undo Rename Map" rather than a bare "Undo": the label is the transaction's
// own, so the menu names the step it will actually revert. It falls back to the
// bare verb when the stack is empty, where there is nothing to name.
const undoLabel = computed(() =>
  model.status.undoLabel
    ? t('menu.edit.undoStep', { label: model.status.undoLabel })
    : t('menu.edit.undo'),
)

const redoLabel = computed(() =>
  model.status.redoLabel
    ? t('menu.edit.redoStep', { label: model.status.redoLabel })
    : t('menu.edit.redo'),
)

// The seven that act on a selection, in the locked order. Each runs the action
// id the keyboard runs, so a menu item and its shortcut cannot come to mean
// different things.
//
// Each `needs` names what the action behind the item would refuse without, so
// an item is enabled exactly when its action would do something:
//
//   payload    something a clipboard can hold, in the mode that holds one
//   clipboard  a payload to land, in the mode that can land it
//   deletable  a selection this mode has an op for
//   selectAll  the mode with a granularity to select everything at
//   selection  anything selected on this tab
const EDIT_ITEMS = [
  { action: 'cut', label: 'menu.edit.cut', needs: 'payload' },
  { action: 'copy', label: 'menu.edit.copy', needs: 'payload' },
  { action: 'paste', label: 'menu.edit.paste', needs: 'clipboard' },
  { action: 'duplicate', label: 'menu.edit.duplicate', needs: 'payload' },
  { action: 'deleteSelection', label: 'menu.edit.delete', needs: 'deletable' },
  { action: 'selectAll', label: 'menu.edit.selectAll', needs: 'selectAll' },
  { action: 'deselect', label: 'menu.edit.deselect', needs: 'selection' },
] as const satisfies readonly {
  action: ActionId
  label: MessageKey
  needs: EditNeed
}[]

type EditNeed = 'payload' | 'clipboard' | 'deletable' | 'selectAll' | 'selection'

const editItems = computed(() =>
  EDIT_ITEMS.map((item) => ({
    ...item,
    // An id with no handler registered is disabled rather than silently inert.
    // Read at render rather than watched: handlers register once, when the
    // feature that owns them mounts, which is always before a menu can open.
    enabled: hasAction(item.action) && meetsNeed(item.needs),
  })),
)

function meetsNeed(need: EditNeed): boolean {
  const mapId = tabsStore.activeTabId
  const selected = !selection.isEmpty && selection.mapId === mapId
  switch (need) {
    case 'payload':
      return inSelect.value && selection.hasCopyableOn(mapId)
    case 'clipboard':
      return inSelect.value && !clipboard.isEmpty
    // Cells are the one kind no other mode has an op for: `Del` there names
    // objects, and a cell selection carried out of Select mode holds none.
    case 'deletable':
      return selected && (inSelect.value || selection.selected.some((ref) => ref.kind !== 'cell'))
    case 'selectAll':
      return inSelect.value
    case 'selection':
      return selected
  }
}

// The four clipboard verbs and Select All belong to Select mode alone, so the
// items for them are live there alone: the other three modes spend their
// gestures on authoring, and the selection they carry is there to hold resize
// handles rather than to be copied.
const inSelect = computed(() => modeStore.active === 'select')

// The dirty marker is `History.isDirty` directly: measured against the last
// entry that changed the model, so browsing tabs after a save does not claim
// unsaved work. There is no store-side copy to drift.
const displayTitle = computed(() =>
  model.status.isDirty ? t('title.unsaved', { name: model.projectName }) : model.projectName,
)
</script>

<template>
  <header class="menu-bar">
    <div class="app-icon" aria-hidden="true">MM</div>
    <div class="project-title">
      <input
        v-if="titleEditing"
        :ref="setTitleInputRef"
        v-model="titleDraft"
        class="project-title-input"
        @keydown.enter="commitTitleEdit"
        @keydown.esc="cancelTitleEdit"
        @blur="commitTitleEdit"
      />
      <button v-else type="button" class="project-title-button" @click="startTitleEdit">
        {{ displayTitle }}
      </button>
    </div>
    <nav class="menu-list" :aria-label="t('menu.main')">
      <button v-for="menu in inertMenus" :key="menu" type="button" class="menu-item">
        {{ t(menu) }}
      </button>
      <DropdownMenuRoot v-model:open="editMenuOpen">
        <DropdownMenuTrigger class="menu-item">{{ t('menu.edit') }}</DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            class="popover-surface edit-menu-content"
            style="--popover-min-width: 12rem"
            :side-offset="4"
            align="start"
          >
            <DropdownMenuItem
              class="popover-item"
              :disabled="!model.status.canUndo"
              @select="model.undo()"
            >
              {{ undoLabel }}
            </DropdownMenuItem>
            <DropdownMenuItem
              class="popover-item"
              :disabled="!model.status.canRedo"
              @select="model.redo()"
            >
              {{ redoLabel }}
            </DropdownMenuItem>
            <DropdownMenuSeparator class="popover-separator" />
            <DropdownMenuItem
              v-for="item in editItems"
              :key="item.action"
              class="popover-item"
              :disabled="!item.enabled"
              @select="runAction(item.action)"
            >
              {{ t(item.label) }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
      <DropdownMenuRoot v-model:open="viewMenuOpen">
        <DropdownMenuTrigger class="menu-item">{{ t('menu.view') }}</DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            class="popover-surface view-menu-content"
            style="--popover-min-width: 10rem"
            :side-offset="4"
            align="start"
          >
            <DropdownMenuCheckboxItem
              v-for="entry in PANEL_REGISTRY"
              :key="entry.id"
              class="popover-item checkable"
              :model-value="panelsStore.isVisible(entry.id)"
              @update:model-value="panelsStore.setVisible(entry.id, Boolean($event))"
              @select="keepMenuOpen"
            >
              {{ t(entry.titleKey) }}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator class="popover-separator" />
            <DropdownMenuCheckboxItem
              class="popover-item checkable"
              :model-value="canvasView.showGrid"
              @update:model-value="canvasView.toggleGrid()"
              @select="keepMenuOpen"
            >
              {{ t('menu.view.grid') }}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              class="popover-item checkable"
              :model-value="canvasView.showRulers"
              @update:model-value="canvasView.toggleRulers()"
              @select="keepMenuOpen"
            >
              {{ t('menu.view.rulers') }}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              class="popover-item checkable"
              :model-value="canvasView.showCoords"
              @update:model-value="canvasView.toggleCoords()"
              @select="keepMenuOpen"
            >
              {{ t('menu.view.coords') }}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger class="popover-item checkable popover-subtrigger">
                {{ t('menu.view.rulerUnits') }}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent
                  class="popover-surface view-menu-content"
                  style="--popover-min-width: 10rem"
                  :side-offset="4"
                >
                  <DropdownMenuRadioGroup
                    :model-value="canvasView.rulerUnits"
                    @update:model-value="canvasView.setRulerUnits($event as RulerUnits)"
                  >
                    <DropdownMenuRadioItem
                      v-for="option in RULER_UNIT_OPTIONS"
                      :key="option.units"
                      class="popover-item checkable"
                      :value="option.units"
                    >
                      {{ t(option.labelKey) }}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSeparator class="popover-separator" />
            <!-- Per-layer visibility. The teleport-lines item is a sub-toggle
                 nested under the transitions master: the master hides every
                 transition, the sub-toggle hides only the faint connecting
                 lines and keeps the endpoint markers.

                 Nested by indentation rather than a submenu, since a submenu
                 would hide the sub-toggle behind a hover, and the one thing
                 this pair must communicate is that the second control depends
                 on the first. -->
            <DropdownMenuCheckboxItem
              class="popover-item checkable"
              :model-value="canvasView.showTransitions"
              @update:model-value="canvasView.toggleTransitions()"
              @select="keepMenuOpen"
            >
              {{ t('menu.view.transitions') }}
            </DropdownMenuCheckboxItem>
            <!-- Disabled, not merely ignored, when the master is off. With the
                 layer hidden the lines are already gone, so a control that
                 still ticked would be claiming an effect it cannot have. -->
            <DropdownMenuCheckboxItem
              class="popover-item checkable nested"
              :model-value="canvasView.showTeleportLines"
              :disabled="canvasView.teleportLinesDisabled"
              @update:model-value="canvasView.toggleTeleportLines()"
              @select="keepMenuOpen"
            >
              {{ t('menu.view.teleportLines') }}
            </DropdownMenuCheckboxItem>
            <!-- The markup layer, nested the same way and for the same reason.
                 Two sub-toggles rather than one, because icons and lines are
                 independent halves of the layer and hiding either on its own is
                 a thing people want. -->
            <DropdownMenuCheckboxItem
              class="popover-item checkable"
              :model-value="canvasView.showMarkup"
              @update:model-value="canvasView.toggleMarkup()"
              @select="keepMenuOpen"
            >
              {{ t('menu.view.markup') }}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              class="popover-item checkable nested"
              :model-value="canvasView.showIcons"
              :disabled="canvasView.markupLayersDisabled"
              @update:model-value="canvasView.toggleIcons()"
              @select="keepMenuOpen"
            >
              {{ t('menu.view.icons') }}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              class="popover-item checkable nested"
              :model-value="canvasView.showLines"
              :disabled="canvasView.markupLayersDisabled"
              @update:model-value="canvasView.toggleLines()"
              @select="keepMenuOpen"
            >
              {{ t('menu.view.lines') }}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator class="popover-separator" />
            <!-- A peer of the layers rather than a child of markup, and never
                 disabled: it says when labels appear, not whether a class of
                 object is drawn, and it outlives this layer as soon as anything
                 else on the map carries a name. Hiding markup already hides its
                 labels, so there is no state to force here. -->
            <DropdownMenuCheckboxItem
              class="popover-item checkable"
              :model-value="canvasView.showAllLabels"
              @update:model-value="canvasView.toggleAllLabels()"
              @select="keepMenuOpen"
            >
              {{ t('menu.view.allLabels') }}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator class="popover-separator" />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger class="popover-item checkable popover-subtrigger">
                {{ t('menu.view.appearance') }}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent
                  class="popover-surface"
                  style="--popover-min-width: 10rem"
                  :side-offset="4"
                >
                  <DropdownMenuRadioGroup
                    :model-value="themeStore.mode"
                    @update:model-value="themeStore.setMode($event as ThemeMode)"
                  >
                    <DropdownMenuRadioItem
                      v-for="option in THEME_OPTIONS"
                      :key="option.mode"
                      class="popover-item checkable"
                      :value="option.mode"
                    >
                      {{ t(option.labelKey) }}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSeparator class="popover-separator" />
            <DropdownMenuItem class="popover-item checkable" @select="resetSidebars">
              {{ t('menu.view.resetSidebars') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator class="popover-separator" />
            <DropdownMenuItem class="popover-item checkable" @select="ui.toggleZenMode()">
              {{ t('menu.view.zenMode') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
      <DropdownMenuRoot v-model:open="helpMenuOpen">
        <DropdownMenuTrigger class="menu-item">{{ t('menu.help') }}</DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            class="popover-surface help-menu-content"
            style="--popover-min-width: 10rem"
            :side-offset="4"
            align="start"
          >
            <DropdownMenuItem class="popover-item" @select="ui.toggleCheatSheet()">
              {{ t('menu.help.cheatSheet') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator class="popover-separator" />
            <DropdownMenuItem class="popover-item" @select="ui.openWelcome()">
              {{ t('menu.help.welcome') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator class="popover-separator" />
            <DropdownMenuItem as-child class="popover-item">
              <a :href="GITHUB_URL" target="_blank" rel="noopener noreferrer">{{
                t('menu.help.github')
              }}</a>
            </DropdownMenuItem>
            <DropdownMenuItem as-child class="popover-item">
              <a :href="WIKI_URL" target="_blank" rel="noopener noreferrer">{{
                t('menu.help.wiki')
              }}</a>
            </DropdownMenuItem>
            <DropdownMenuSeparator class="popover-separator" />
            <DropdownMenuItem class="popover-item" @select="ui.openAbout()">
              {{ t('menu.help.about') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </nav>
  </header>
</template>

<style scoped>
.menu-bar {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 0.75rem;
  padding: 0.375rem 0.75rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.app-icon {
  grid-row: 1 / span 2;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.25rem;
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  font-size: 0.75rem;
}

.project-title {
  grid-column: 2;
  grid-row: 1;
}

.project-title-button {
  background: none;
  border: none;
  font: inherit;
  font-weight: 600;
  color: var(--fg);
  cursor: pointer;
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
}
.project-title-button:hover {
  background: var(--surface-active);
}

.project-title-input {
  font: inherit;
  font-weight: 600;
  padding: 0.125rem 0.25rem;
}

.menu-list {
  grid-column: 2;
  grid-row: 2;
  display: flex;
  gap: 0.25rem;
}

.menu-item {
  background: none;
  border: none;
  font: inherit;
  color: var(--fg);
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  cursor: pointer;
}
.menu-item:hover {
  background: var(--surface-active);
}
</style>
