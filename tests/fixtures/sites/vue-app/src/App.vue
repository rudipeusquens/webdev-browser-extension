<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import AboutPage from './pages/AboutPage.vue'
import HomePage from './pages/HomePage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import { go, route } from './router'

const pages = [
  { path: '/', label: 'Home', page: HomePage },
  { path: '/settings', label: 'Settings', page: SettingsPage },
  { path: '/about', label: 'About', page: AboutPage },
]
const current = computed(() => pages.find((p) => p.path === route.value) ?? pages[0])

watchEffect(() => {
  document.title = `Shop · ${current.value?.label}`
})
</script>

<template>
  <nav class="links">
    <a v-for="p in pages" :key="p.path" :href="p.path" @click.prevent="go(p.path)">
      {{ p.label }}
    </a>
  </nav>
  <component :is="current?.page" />
</template>

<style>
body {
  font-family: sans-serif;
  margin: 0;
  padding: 16px;
}
.links {
  display: flex;
  gap: 16px;
}
</style>
