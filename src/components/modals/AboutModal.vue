<script setup lang="ts">
import { useUiStore } from '@/stores/ui'
import { version as appVersion } from '../../../package.json'
import { t } from '@/i18n'
import BaseModal from './BaseModal.vue'

const ui = useUiStore()
</script>

<template>
  <BaseModal
    v-model:open="ui.aboutOpen"
    :title="t('modal.about.title')"
    :description="t('modal.about.description')"
    width="24rem"
  >
    <p class="about-version">{{ t('modal.about.version', { version: appVersion }) }}</p>
  </BaseModal>
</template>

<style scoped>
.about-version {
  font-size: 0.875rem;
  color: var(--fg);
  opacity: 0.8;
  margin: 0;
}
</style>
