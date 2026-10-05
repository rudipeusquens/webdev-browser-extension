// @ts-check
import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// `eslint-config-prettier` stays last — it turns off rules that fight Prettier, which owns
// formatting.
export default defineConfig(
  globalIgnores(['dist/', 'build/', '.output/', '.wxt/', '.private/', '.worktrees/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    files: ['src/**/*.{ts,vue}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['scripts/**/*.{js,mjs}', '*.config.{js,mjs,ts}', 'tests/e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  // shadcn-vue components use single-word names (Button, Popover).
  { rules: { 'vue/multi-word-component-names': 'off' } },
  eslintConfigPrettier,
)
