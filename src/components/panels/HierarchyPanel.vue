<script setup lang="ts">
import { t } from '@/i18n'
</script>

<template>
  <p class="placeholder">{{ t('panel.placeholder', { title: t('panel.hierarchy') }) }}</p>
</template>

<style scoped>
.placeholder {
  color: var(--fg);
  opacity: 0.6;
  font-size: 0.8125rem;
}
</style>
