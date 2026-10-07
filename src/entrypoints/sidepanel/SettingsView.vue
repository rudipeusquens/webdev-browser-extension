<script setup lang="ts">
import type { Settings } from '@/lib/settings'
import GeneralSettings from './GeneralSettings.vue'
import ShortcutList from './ShortcutList.vue'
import SiteList from './SiteList.vue'
import VoiceSettings from './VoiceSettings.vue'

/** `shortcut`: the toolbar shortcut Chrome assigned, empty when there is none. */
defineProps<{ settings: Settings; shortcut: string }>()
const emit = defineEmits<{ forget: [origin: string] }>()
</script>

<template>
  <!-- Sections apart, with a line between them. -->
  <section data-testid="settings" class="flex-1 divide-y overflow-y-auto px-4">
    <GeneralSettings class="py-6" :settings="settings" />

    <VoiceSettings class="py-6" />

    <SiteList
      class="py-6"
      :remembered="settings.rememberedOrigins"
      @forget="(origin) => emit('forget', origin)"
    />

    <ShortcutList class="py-6" :toolbar="shortcut" />
  </section>
</template>
