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
import UpdateToast from './UpdateToast.vue'
import { onMounted } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useModelStore } from '@/stores/model'
import { useFileStore } from '@/stores/file'
import { useRecoveryStore } from '@/stores/recovery'
import { useAppUpdateStore } from '@/stores/appUpdate'
import { onLaunchedFiles } from '@/pwa/launchFiles'
import { registerServiceWorker } from '@/pwa/serviceWorker'
import { useHotkeyAction } from '@/hotkeys/useHotkeyAction'
import { useUnloadGuard } from '@/composables/useUnloadGuard'

const ui = useUiStore()
const model = useModelStore()
const file = useFileStore()
// Instantiated here rather than lazily, because autosave is watchers the store
// registers: nothing else would ever ask for it, and a snapshot that is only
// taken once someone opens a dialog is no snapshot at all.
const recovery = useRecoveryStore()
const update = useAppUpdateStore()

// Once, and only at startup. What is in the store at this moment is a previous
// session's work; anything written after this is this session's own.
//
// Work to recover displaces the welcome screen, which is otherwise shown on
// every launch and would sit stacked underneath it. Somebody who crashed
// mid-project is not being introduced to the app.
onMounted(async () => {
  await recovery.scan()
  if (recovery.offered.length > 0) ui.closeWelcome()
})

// Read once into memory, so the File menu renders the list it already has.
onMounted(() => void file.refreshRecent())

onMounted(() => {
  update.watchForUpdates(registerServiceWorker)

  // A `.mvm` double-clicked in the OS. Only the first is taken: opening
  // several would mean each replacing the last, and the last one winning
  // silently is worse than opening one and saying nothing about the rest.
  onLaunchedFiles((files) => void file.openLaunched(files[0]))
})

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

// Dropping the recent entry that led to a file which no longer opens. Carried
// on the outcome for the same reason as `accept`: the dialog says which file
// without being told which list it came from.
function forgetFailedFile() {
  const outcome = file.outcome
  if (outcome?.kind === 'missing' || outcome?.kind === 'permission-refused') outcome.forget()
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
      @forget="forgetFailedFile"
      @dismiss="file.dismissOutcome()"
    />
    <RecoveryOffer
      :snapshots="recovery.offered"
      @recover="recovery.recover($event)"
      @discard="recovery.discard($event)"
      @dismiss="recovery.dismiss()"
    />
    <UpdateToast :open="update.available" @install="update.install()" @dismiss="update.dismiss()" />
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
