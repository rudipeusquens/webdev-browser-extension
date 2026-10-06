<script setup lang="ts">
import { ArrowUpRightIcon, Trash2Icon } from '@lucide/vue'
import { toRef } from 'vue'
import { browser } from 'wxt/browser'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { siteLabel } from '@/lib/collection/site'
import { isSiteOrigin } from '@/lib/settings'
import { useSites } from './use-sites'

const props = defineProps<{ remembered: string[] }>()
const emit = defineEmits<{ forget: [origin: string] }>()
const { sites } = useSites(toRef(props, 'remembered'))

/** Only sites on the web open from here; local files have no address to open. */
function open(site: string) {
  if (isSiteOrigin(site)) browser.tabs.create({ url: `${site}/` }).catch(() => undefined)
}
</script>

<template>
  <div data-testid="site-settings" class="space-y-2">
    <h3 class="text-xs font-medium text-muted-foreground">Sites</h3>
    <p class="text-xs text-muted-foreground">
      Each site keeps its own feedback. <strong class="font-medium">Auto</strong> sites load the
      overlay by themselves.
    </p>
    <ul v-if="sites.length" class="space-y-1">
      <li
        v-for="entry in sites"
        :key="entry.site"
        data-testid="site"
        class="flex items-center gap-2 rounded-md border px-3 py-1.5"
      >
        <a
          v-if="isSiteOrigin(entry.site)"
          data-testid="site-link"
          :href="`${entry.site}/`"
          target="_blank"
          rel="noreferrer"
          class="flex min-w-0 flex-1 items-center gap-1 font-mono text-xs underline-offset-2 hover:underline"
          :title="`Open ${entry.site} in a new tab`"
          @click.prevent="open(entry.site)"
        >
          <span data-testid="site-label" class="truncate">{{ siteLabel(entry.site) }}</span>
          <ArrowUpRightIcon class="size-3 shrink-0 text-muted-foreground" />
        </a>
        <span v-else class="min-w-0 flex-1 truncate font-mono text-xs" :title="entry.site">
          <span data-testid="site-label">{{ siteLabel(entry.site) }}</span>
        </span>
        <span
          v-if="!entry.remembered || entry.open"
          data-testid="site-open-count"
          class="shrink-0 text-xs text-muted-foreground"
          >{{ entry.open }} open</span
        >
        <Badge
          v-if="entry.remembered"
          data-testid="site-auto"
          variant="secondary"
          class="shrink-0"
          title="Pages of this site load the overlay by themselves"
          >Auto</Badge
        >
        <Button
          v-if="entry.remembered"
          data-testid="remove-site"
          variant="ghost"
          size="icon-sm"
          class="shrink-0 text-muted-foreground"
          :aria-label="`Forget ${entry.site}`"
          :title="`Forget ${entry.site}: it no longer loads the overlay by itself`"
          @click="emit('forget', entry.site)"
        >
          <Trash2Icon />
        </Button>
      </li>
    </ul>
    <p v-else class="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
      No sites yet. Feedback you add on a page appears here, and so do sites you enable with Always
      enable here.
    </p>
  </div>
</template>
