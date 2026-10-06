<script setup lang="ts">
import ShortcutList from './ShortcutList.vue'
import SiteList from './SiteList.vue'
import VoiceSettings from './VoiceSettings.vue'

/** `shortcut`: the toolbar shortcut Chrome assigned, empty when there is none. */
defineProps<{ origins: string[]; shortcut: string }>()
const emit = defineEmits<{ forget: [origin: string] }>()
</script>

<template>
  <section class="flex-1 space-y-6 overflow-y-auto p-4">
    <VoiceSettings />

    <SiteList :remembered="origins" @forget="(origin) => emit('forget', origin)" />

    <ShortcutList :toolbar="shortcut" />
  </section>
</template>
