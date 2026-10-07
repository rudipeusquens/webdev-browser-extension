import { defineConfig } from 'vitest/config'

// The README's screenshots (tests/screenshots): local only, after a build. CI never runs them.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/screenshots/**/*.screenshots.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
