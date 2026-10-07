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
    files: ['src/**/*.{ts,vue}', 'tests/fixtures/**/*.{js,ts,vue}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: [
      'scripts/**/*.{js,mjs}',
      '*.config.{js,mjs,ts}',
      'tests/e2e/**/*.ts',
      'tests/screenshots/**/*.ts',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  // shadcn-vue components use single-word names (Button, Popover).
  { rules: { 'vue/multi-word-component-names': 'off' } },
  // The overlay runs next to hostile pages and never touches the OpenRouter key (spec
  // section 9): no key module, no key name.
  {
    files: ['src/entrypoints/overlay.content/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: 'voice/key(\\.ts)?$',
              message: 'The overlay never reads the OpenRouter key.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Identifier[name=/openrouterKey/i]',
          message: 'The overlay never reads the OpenRouter key.',
        },
        {
          selector: 'Literal[value=/openrouterKey/i]',
          message: 'The overlay never reads the OpenRouter key.',
        },
        {
          selector: 'TemplateElement[value.raw=/openrouterKey/i]',
          message: 'The overlay never reads the OpenRouter key.',
        },
      ],
    },
  },
  // Copied shadcn-vue components declare optional props without defaults on purpose.
  {
    files: ['src/components/ui/**/*.vue'],
    rules: { 'vue/require-default-prop': 'off' },
  },
  eslintConfigPrettier,
)
