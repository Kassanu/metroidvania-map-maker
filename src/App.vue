<script setup lang="ts">
import { watchEffect } from 'vue'
import AppShell from './components/layout/AppShell.vue'
import ToastRegion from './components/layout/ToastRegion.vue'
import { useHotkeys } from './hotkeys/useHotkeys'
import { useApplyTheme } from './theme/useApplyTheme'
import { useApplyLocale } from './i18n/useApplyLocale'
import { useModelStore } from './stores/model'
import { t } from './i18n'

useHotkeys()
useApplyTheme()
useApplyLocale()

// The browser tab carries the project name and the unsaved marker, so a user
// with several projects open can tell them apart and can see which one has
// work in it without switching to each. It lives here rather than in the
// MenuBar because it is a property of the document, not of a component.
const model = useModelStore()

watchEffect(() => {
  const title = model.status.isDirty
    ? t('title.unsaved', { name: model.projectName })
    : model.projectName
  document.title = `${title} - ${t('app.name')}`
})
</script>

<template>
  <h1 class="visually-hidden">{{ t('app.name') }}</h1>
  <AppShell />
  <!-- Outside AppShell on purpose: the toast viewport is fixed-position, and a
       fixed element that lost its positioning inside AppShell's grid would
       become an unplaced grid item and displace every region. -->
  <ToastRegion />
</template>
