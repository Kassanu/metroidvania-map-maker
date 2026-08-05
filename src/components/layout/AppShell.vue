<script setup lang="ts">
import MenuBar from './MenuBar.vue'
import Toolbar from './Toolbar.vue'
import ActivityBar from './ActivityBar.vue'
import SidebarContainer from './SidebarContainer.vue'
import CanvasRegion from './CanvasRegion.vue'
import TabBar from './TabBar.vue'
import CheatSheetModal from '../modals/CheatSheetModal.vue'
import WelcomeModal from '../modals/WelcomeModal.vue'
import AboutModal from '../modals/AboutModal.vue'
import ConfirmUnsavedChanges from '../modals/ConfirmUnsavedChanges.vue'
import LoadOutcomeDialog from '../modals/LoadOutcomeDialog.vue'
import RecoveryOffer from '../modals/RecoveryOffer.vue'
import { onMounted } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useModelStore } from '@/stores/model'
import { useFileStore } from '@/stores/file'
import { useRecoveryStore } from '@/stores/recovery'
import { useHotkeyAction } from '@/hotkeys/useHotkeyAction'
import { useUnloadGuard } from '@/composables/useUnloadGuard'

const ui = useUiStore()
const model = useModelStore()
const file = useFileStore()
// Instantiated here rather than lazily, because autosave is watchers the store
// registers: nothing else would ever ask for it, and a snapshot that is only
// taken once someone opens a dialog is no snapshot at all.
const recovery = useRecoveryStore()

// Once, and only at startup. What is in the store at this moment is a previous
// session's work; anything written after this is this session's own.
onMounted(() => void recovery.scan())

// The File verbs are always available, so they register here rather than in a
// mode that owns them. Each runs the same store action the menu item runs, so
// a shortcut and its item cannot come to mean different things.
useHotkeyAction('newProject', () => void file.newProject())
useHotkeyAction('openProject', () => void file.open())
useHotkeyAction('save', () => void file.save())
useHotkeyAction('saveAs', () => void file.saveAs())

useUnloadGuard()

// The repaired project is reachable only through the closure the store put on
// the outcome, so accepting is the one way past the gate.
function acceptRepairedLoad() {
  const outcome = file.outcome
  if (outcome?.kind === 'repaired') outcome.accept()
  file.dismissOutcome()
}
</script>

<template>
  <div class="app-shell" :class="{ zen: ui.zenMode }">
    <template v-if="!ui.zenMode">
      <MenuBar class="region-menu" />
      <ActivityBar class="region-activity" />
      <SidebarContainer side="left" class="region-left" />
    </template>
    <Toolbar class="region-toolbar" />
    <CanvasRegion class="region-canvas" />
    <template v-if="!ui.zenMode">
      <SidebarContainer side="right" class="region-right" />
    </template>
    <TabBar class="region-tabs" />
    <CheatSheetModal />
    <WelcomeModal />
    <AboutModal />
    <ConfirmUnsavedChanges
      :open="file.unsavedPromptOpen"
      :name="model.projectName"
      @choose="file.chooseUnsaved($event)"
    />
    <LoadOutcomeDialog
      :outcome="file.outcome"
      @accept="acceptRepairedLoad"
      @dismiss="file.dismissOutcome()"
    />
    <RecoveryOffer
      :snapshots="recovery.offered"
      @recover="recovery.recover($event)"
      @discard="recovery.discard($event)"
      @dismiss="recovery.dismiss()"
    />
  </div>
</template>

<style scoped>
.app-shell {
  height: 100dvh;
  display: grid;
  grid-template-areas:
    'menu     menu   menu    menu'
    'toolbar  toolbar toolbar toolbar'
    'activity left   canvas  right'
    'tabs     tabs   tabs    tabs';
  grid-template-rows: auto auto 1fr auto;
  grid-template-columns: auto auto 1fr auto;
}
/* Zen mode keeps only the toolbar, canvas, and tab bar: no menu bar,
 * activity bar, or sidebars. */
.app-shell.zen {
  grid-template-areas:
    'toolbar'
    'canvas'
    'tabs';
  grid-template-rows: auto 1fr auto;
  grid-template-columns: 1fr;
}

.region-menu {
  grid-area: menu;
}
.region-toolbar {
  grid-area: toolbar;
}
.region-activity {
  grid-area: activity;
}
.region-left {
  grid-area: left;
}
.region-canvas {
  grid-area: canvas;
  min-width: 0;
  min-height: 0;
}
.region-right {
  grid-area: right;
}
.region-tabs {
  grid-area: tabs;
}
</style>
