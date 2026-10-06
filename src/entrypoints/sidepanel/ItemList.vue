<script setup lang="ts">
import {
  ArchiveRestoreIcon,
  ArrowUpRightIcon,
  CopyIcon,
  RotateCcwIcon,
  SquareDashedIcon,
  SquareMousePointerIcon,
  TextSelectIcon,
  Trash2Icon,
} from '@lucide/vue'
import { nextTick, useTemplateRef, watch } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { PageGroup } from '@/lib/collection/ops'
import type { Pointed } from './use-overlay-lines'
import { targetSummary } from '@/lib/format/summary'
import { isSiteOrigin } from '@/lib/settings'
import { STATUS_BADGE, STATUS_NAME } from '@/lib/status'

const props = defineProps<{
  groups: (PageGroup & { current: boolean })[]
  /** Items not found when their page was last open. */
  missing: ReadonlySet<string>
  /** What the page points at: the pin under the pointer, the item whose popover is open. */
  pointed: Pointed
  /** Headings show the page's title next to its path (an option in Settings). */
  pageTitles?: boolean
}>()
const emit = defineEmits<{
  remove: [id: string]
  restore: [id: string]
  reopen: [id: string]
  /** Copy this open pin as the prompt. */
  copy: [id: string]
  highlight: [id: string | null]
  reveal: [id: string]
  go: [pageKey: string]
  /** An entry of another page: open that page and show the item there. */
  jump: [pageKey: string, id: string]
}>()

const list = useTemplateRef<HTMLElement>('list')

function pointedAt(id: string): 'open' | 'hovered' | undefined {
  if (props.pointed.open === id) return 'open'
  if (props.pointed.hovered === id) return 'hovered'
  return undefined
}

// The entry the page points at comes into view (spec section 8).
watch(
  () => props.pointed,
  async (now, before) => {
    const id = now.hovered !== before?.hovered ? now.hovered : now.open
    if (!id) return
    await nextTick()
    list.value
      ?.querySelector(`[data-item-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  },
)

function onEntry(group: PageGroup & { current: boolean }, id: string) {
  if (group.current) emit('reveal', id)
  else if (openable(group.page.url)) emit('jump', group.key, id)
}

/** The page within its site: path and query (the site is in the title row). */
function pathOf(key: string): string {
  try {
    const url = new URL(key)
    return url.protocol === 'file:' ? url.pathname : `${url.pathname}${url.search}`
  } catch {
    return key
  }
}

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
  <div ref="list">
    <section
      v-for="(group, index) in groups"
      :key="group.key"
      data-testid="page-group"
      class="pb-3"
      :class="index > 0 && 'mt-2 border-t'"
    >
      <h2
        class="sticky top-0 z-10 flex min-h-8 items-center gap-2 bg-background/95 px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground backdrop-blur"
        :title="group.key"
      >
        <Badge v-if="group.current" data-testid="this-page" variant="outline" class="shrink-0"
          >This page</Badge
        >
        <!-- Another page on the web: its path is the way there. -->
        <Button
          v-if="!group.current && openable(group.page.url)"
          data-testid="page-link"
          variant="ghost"
          size="xs"
          class="-mx-2 -my-1 min-w-0 justify-start font-medium text-muted-foreground"
          :title="`Open ${group.key} in this tab`"
          @click="emit('go', group.key)"
        >
          <span class="flex min-w-0 items-baseline gap-1.5">
            <span
              v-if="pageTitles && group.page.title"
              data-testid="page-title"
              class="max-w-1/2 min-w-0 shrink-0 truncate"
              >{{ group.page.title }}</span
            >
            <span data-testid="page-path" class="min-w-0 truncate font-mono font-normal">{{
              pathOf(group.key)
            }}</span>
          </span>
          <ArrowUpRightIcon />
        </Button>
        <span v-else class="flex min-w-0 items-baseline gap-1.5">
          <span
            v-if="pageTitles && group.page.title"
            data-testid="page-title"
            class="max-w-1/2 min-w-0 shrink-0 truncate"
            >{{ group.page.title }}</span
          >
          <span data-testid="page-path" class="min-w-0 truncate font-mono font-normal">{{
            pathOf(group.key)
          }}</span>
        </span>
      </h2>
      <ul>
        <li
          v-for="item in group.items"
          :key="item.id"
          data-testid="item"
          :data-item-id="item.id"
          :data-pointed="pointedAt(item.id)"
          class="flex items-start gap-1 px-2 hover:bg-muted/60"
          :class="{
            'bg-muted/60': pointedAt(item.id) === 'hovered',
            'bg-muted shadow-[inset_2px_0_0_var(--color-ring)]': pointedAt(item.id) === 'open',
          }"
          @mouseenter="group.current && emit('highlight', item.id)"
          @mouseleave="group.current && emit('highlight', null)"
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-start gap-3 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            :disabled="!group.current && !openable(group.page.url)"
            :title="
              group.current
                ? 'Show on the page'
                : openable(group.page.url)
                  ? 'Open its page and show it'
                  : undefined
            "
            @click="onEntry(group, item.id)"
          >
            <span
              data-testid="item-number"
              class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
              :class="STATUS_BADGE[item.status]"
              :title="STATUS_NAME[item.status]"
              >{{ item.number }}</span
            >
            <span class="min-w-0 flex-1">
              <span
                class="line-clamp-2 break-words whitespace-pre-line"
                :class="item.status === 'deleted' && 'text-muted-foreground line-through'"
                >{{ item.comment }}</span
              >
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
            v-if="item.status === 'open'"
            data-testid="item-copy"
            variant="ghost"
            size="icon-sm"
            class="mt-1 shrink-0 text-muted-foreground"
            :aria-label="`Copy pin ${item.number}`"
            title="Copy as prompt: it becomes done"
            @click="emit('copy', item.id)"
          >
            <CopyIcon />
          </Button>
          <Button
            v-if="item.status === 'done'"
            data-testid="item-reopen"
            variant="ghost"
            size="icon-sm"
            class="mt-1 shrink-0 text-muted-foreground"
            :aria-label="`Reopen pin ${item.number}`"
            title="Reopen: the next Copy as prompt copies it again"
            @click="emit('reopen', item.id)"
          >
            <RotateCcwIcon />
          </Button>
          <Button
            v-if="item.status === 'deleted'"
            data-testid="item-restore"
            variant="ghost"
            size="icon-sm"
            class="mt-1 shrink-0 text-muted-foreground"
            :aria-label="`Restore pin ${item.number}`"
            title="Restore as an open pin"
            @click="emit('restore', item.id)"
          >
            <ArchiveRestoreIcon />
          </Button>
          <Button
            v-else
            data-testid="item-delete"
            variant="ghost"
            size="icon-sm"
            class="mt-1 shrink-0 text-muted-foreground"
            :aria-label="`Delete pin ${item.number}`"
            title="Delete"
            @click="emit('remove', item.id)"
          >
            <Trash2Icon />
          </Button>
        </li>
      </ul>
    </section>
  </div>
</template>
