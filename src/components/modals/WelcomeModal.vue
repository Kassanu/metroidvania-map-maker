<script setup lang="ts">
import { DialogClose } from 'reka-ui'
import { useUiStore } from '@/stores/ui'
import { t } from '@/i18n'
import BaseModal from './BaseModal.vue'

const ui = useUiStore()

function onHideOnStartupChange(event: Event) {
  ui.setHideWelcomeOnStartup((event.target as HTMLInputElement).checked)
}
</script>

<template>
  <BaseModal
    v-model:open="ui.welcomeOpen"
    :title="t('modal.welcome.title')"
    :description="t('modal.welcome.description')"
  >
    <!-- Placeholder: real onboarding content (tour, quick-start tips) is still
         undecided; this just proves the shell out. -->
    <p class="welcome-body">{{ t('modal.welcome.body') }}</p>
    <div class="welcome-footer">
      <label class="welcome-checkbox">
        <input type="checkbox" :checked="ui.hideWelcomeOnStartup" @change="onHideOnStartupChange" />
        {{ t('modal.welcome.hideOnStartup') }}
      </label>
      <DialogClose class="welcome-dismiss">{{ t('modal.welcome.getStarted') }}</DialogClose>
    </div>
  </BaseModal>
</template>

<style scoped>
.welcome-body {
  font-size: 0.875rem;
  color: var(--fg);
  opacity: 0.8;
  margin: 0 0 1rem;
}

.welcome-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.welcome-checkbox {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.8125rem;
  color: var(--fg);
  opacity: 0.8;
  cursor: pointer;
}

.welcome-dismiss {
  border: none;
  border-radius: 0.25rem;
  padding: 0.375rem 0.75rem;
  background: var(--accent);
  color: #fff;
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}
.welcome-dismiss:hover {
  opacity: 0.9;
}
</style>
