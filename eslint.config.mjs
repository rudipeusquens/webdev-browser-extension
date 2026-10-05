// @ts-check
import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Stack-neutral base: JS + TypeScript recommended rules. Once the extension
// framework is chosen, add its globals/plugins here. `eslint-config-prettier`
// stays last — it turns off rules that fight Prettier, which owns formatting.
export default defineConfig(
  globalIgnores(['dist/', 'build/', '.output/', '.private/', '.worktrees/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['scripts/**/*.{js,mjs}', '*.config.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  eslintConfigPrettier,
)
