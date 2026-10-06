// A small Vue 3 app served by a Vite dev server in the E2E tests (tests/e2e/harness.ts), so
// its elements carry real component data: names and absolute `.vue` file paths.
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
