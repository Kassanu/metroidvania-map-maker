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
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
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
