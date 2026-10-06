import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import { WxtVitest } from 'wxt/testing/vitest-plugin'

export default defineConfig({
  // WxtVitest does not add the Vue plugin itself.
  plugins: [vue(), WxtVitest()],
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
  },
})
