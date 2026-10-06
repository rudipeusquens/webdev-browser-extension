import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// The live voice test (spec section 12): local only, against the real OpenRouter API, with
// OPENROUTER_API_KEY_TEST from .env. CI never runs it.
export default defineConfig(({ mode }) => ({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.live.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    // The model comparison is printed.
    silent: false,
    reporters: ['verbose'],
    env: {
      OPENROUTER_API_KEY_TEST:
        loadEnv(mode, process.cwd(), 'OPENROUTER_').OPENROUTER_API_KEY_TEST ?? '',
    },
  },
}))
