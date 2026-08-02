import { globalIgnores } from 'eslint/config'
import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },

  globalIgnores(['dist/**', 'dev-dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**']),

  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    name: 'app/single-word-layout-components',
    files: ['src/components/layout/Toolbar.vue'],
    rules: {
      // Layout singletons (one instance ever, named for their role) read
      // fine single-word; the multi-word rule exists to avoid clashing
      // with native HTML elements, which isn't a risk here.
      'vue/multi-word-component-names': 'off',
    },
  },

  skipFormatting,
)
