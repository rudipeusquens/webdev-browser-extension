<script setup lang="ts">
import { ref } from 'vue'
import { browser } from 'wxt/browser'
import { Switch } from '@/components/ui/switch'
import type { BackgroundMessage, Reply } from '@/lib/messages'
import type { Option, Settings } from '@/lib/settings'

/** The stored settings; the background writes them, the switches only ask. */
defineProps<{ settings: Settings }>()

const OPTIONS: { key: Option; testid: string; label: string; detail: string }[] = [
  {
    key: 'pageTitles',
    testid: 'option-page-titles',
    label: 'Show page titles',
    detail: 'Page headings in the list show the title next to the path.',
  },
  {
    key: 'contextMenu',
    testid: 'option-context-menu',
    label: 'Annotate this page in the context menu',
    detail: 'Right-click a page to start the overlay there.',
  },
]

const error = ref('')

async function set(key: Option, value: boolean) {
  const message: BackgroundMessage = { type: 'settings:set', key, value }
  let reply: Reply | undefined
  try {
    reply = (await browser.runtime.sendMessage(message)) as Reply | undefined
  } catch {
    reply = undefined
  }
  error.value = reply?.ok ? '' : (reply?.error ?? 'The extension did not answer. Try again.')
}
</script>

<template>
  <div data-testid="general-settings" class="space-y-3">
    <h3 class="text-xs font-medium text-muted-foreground">General</h3>
    <div v-for="option in OPTIONS" :key="option.key" class="flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <label :for="option.testid" class="font-medium">{{ option.label }}</label>
        <p class="text-xs text-muted-foreground">{{ option.detail }}</p>
      </div>
      <Switch
        :id="option.testid"
        :data-testid="option.testid"
        class="mt-0.5"
        :model-value="settings[option.key]"
        @update:model-value="(value: boolean) => set(option.key, value)"
      />
    </div>
    <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
  </div>
</template>
