<script setup lang="ts">
import { Trash2Icon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import ShortcutList from './ShortcutList.vue'
import VoiceSettings from './VoiceSettings.vue'

/** `shortcut`: the toolbar shortcut Chrome assigned, empty when there is none. */
defineProps<{ origins: string[]; shortcut: string }>()
const emit = defineEmits<{ forget: [origin: string] }>()
</script>

<template>
  <section class="flex-1 space-y-6 overflow-y-auto p-4">
    <VoiceSettings />

    <div data-testid="site-settings" class="space-y-2">
      <h3 class="text-xs font-medium text-muted-foreground">Sites</h3>
      <p class="text-xs text-muted-foreground">
        Pages of these sites load the overlay by themselves.
      </p>
      <ul v-if="origins.length" class="space-y-1">
        <li
          v-for="origin in origins"
          :key="origin"
          data-testid="site"
          class="flex items-center gap-2 rounded-md border px-3 py-1.5"
        >
          <span class="min-w-0 flex-1 truncate font-mono text-xs" :title="origin">{{
            origin
          }}</span>
          <Button
            data-testid="remove-site"
            variant="ghost"
            size="icon-sm"
            class="shrink-0 text-muted-foreground"
            :aria-label="`Forget ${origin}`"
            @click="emit('forget', origin)"
          >
            <Trash2Icon />
          </Button>
        </li>
      </ul>
      <p v-else class="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        No remembered sites yet. Use Always enable here on a page.
      </p>
    </div>

    <ShortcutList :toolbar="shortcut" />
  </section>
</template>
