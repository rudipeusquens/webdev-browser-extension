<script setup lang="ts">
import { computed } from 'vue'
import { browser } from 'wxt/browser'
import { Button } from '@/components/ui/button'
import { currentPlatform, isMacPlatform, shortcutGroups } from '@/lib/shortcuts'

/** The toolbar shortcut as Chrome assigned it; empty when there is none. */
defineProps<{ toolbar: string }>()

const groups = computed(() => shortcutGroups(isMacPlatform(currentPlatform())))
const NOTES: Record<string, string> = {
  'On the page': 'While no field of the page has the focus.',
  'Browse mode': 'While this panel is open.',
}

function changeShortcut() {
  browser.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => undefined)
}
</script>

<template>
  <div data-testid="shortcut-list" class="space-y-4">
    <h3 class="text-xs font-medium text-muted-foreground">Keyboard shortcuts</h3>
    <div class="space-y-1">
      <div class="flex items-center gap-2">
        <span class="min-w-0 flex-1">Open or close this panel</span>
        <kbd
          v-if="toolbar"
          class="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-xs"
          >{{ toolbar }}</kbd
        >
        <span v-else class="shrink-0 text-xs text-muted-foreground">Not set</span>
        <Button
          data-testid="change-shortcut"
          variant="outline"
          size="xs"
          class="shrink-0"
          title="Change it on Chrome's shortcut page"
          @click="changeShortcut"
        >
          Change
        </Button>
      </div>
    </div>
    <div v-for="group in groups" :key="group.title" class="space-y-1">
      <h4 class="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {{ group.title }}
      </h4>
      <ul>
        <li
          v-for="row in group.rows"
          :key="row.action"
          class="flex items-center justify-between gap-3 border-b py-1.5 last:border-b-0"
        >
          <span class="min-w-0">{{ row.action }}</span>
          <span class="flex shrink-0 gap-1">
            <kbd
              v-for="keys in row.keys"
              :key="keys"
              class="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs"
              >{{ keys }}</kbd
            >
          </span>
        </li>
      </ul>
      <p v-if="NOTES[group.title]" class="text-xs text-muted-foreground">
        {{ NOTES[group.title] }}
      </p>
    </div>
  </div>
</template>
