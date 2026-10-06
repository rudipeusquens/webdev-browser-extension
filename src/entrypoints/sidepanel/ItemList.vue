<script setup lang="ts">
import {
  ArrowUpRightIcon,
  SquareDashedIcon,
  SquareMousePointerIcon,
  TextSelectIcon,
  Trash2Icon,
} from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { PageGroup } from '@/lib/collection/ops'
import { targetSummary } from '@/lib/format/summary'
import { isSiteOrigin } from '@/lib/settings'

defineProps<{
  groups: (PageGroup & { current: boolean })[]
  /** Items not found when their page was last open. */
  missing: ReadonlySet<string>
}>()
const emit = defineEmits<{
  remove: [id: string]
  highlight: [id: string | null]
  reveal: [id: string]
  go: [pageKey: string]
}>()

/** Go to works for pages on the web only. */
function openable(url: string): boolean {
  try {
    return isSiteOrigin(new URL(url).origin)
  } catch {
    return false
  }
}

const ICONS = { element: SquareMousePointerIcon, text: TextSelectIcon, area: SquareDashedIcon }
</script>

<template>
  <section v-for="group in groups" :key="group.key" data-testid="page-group" class="pb-2">
    <h2
      class="sticky top-0 z-10 flex items-center gap-2 bg-background/95 px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground backdrop-blur"
      :title="group.key"
    >
      <span class="truncate">{{ group.page.title || group.key }}</span>
      <Badge v-if="group.current" variant="outline" class="shrink-0">This page</Badge>
      <Button
        v-else-if="openable(group.page.url)"
        data-testid="go-to"
        variant="ghost"
        size="xs"
        class="-my-1 ml-auto shrink-0 font-normal"
        :title="`Open ${group.key} in this tab`"
        @click="emit('go', group.key)"
      >
        Go to <ArrowUpRightIcon />
      </Button>
    </h2>
    <ul>
      <li
        v-for="item in group.items"
        :key="item.id"
        data-testid="item"
        class="flex items-start gap-1 px-2 hover:bg-muted/60"
        @mouseenter="group.current && emit('highlight', item.id)"
        @mouseleave="group.current && emit('highlight', null)"
      >
        <button
          type="button"
          class="flex min-w-0 flex-1 items-start gap-3 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
          :disabled="!group.current"
          :title="group.current ? 'Show on the page' : undefined"
          @click="emit('reveal', item.id)"
        >
          <span
            data-testid="item-number"
            class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white"
            >{{ item.number }}</span
          >
          <span class="min-w-0 flex-1">
            <span class="line-clamp-2 break-words whitespace-pre-line">{{ item.comment }}</span>
            <span class="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <component :is="ICONS[item.target.kind]" class="size-3 shrink-0" />
              <span class="truncate font-mono">{{ targetSummary(item.target) }}</span>
              <Badge
                v-if="missing.has(item.id)"
                data-testid="not-found"
                variant="outline"
                class="shrink-0 px-1 py-0 text-[10px] font-normal text-amber-700 dark:text-amber-400"
                title="Not found when this page was last open"
              >
                Not found
              </Badge>
            </span>
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="mt-1 shrink-0 text-muted-foreground"
          :aria-label="`Delete item ${item.number}`"
          @click="emit('remove', item.id)"
        >
          <Trash2Icon />
        </Button>
      </li>
    </ul>
  </section>
</template>
