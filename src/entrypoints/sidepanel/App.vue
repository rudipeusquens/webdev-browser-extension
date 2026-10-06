<script setup lang="ts">
import {
  CopyIcon,
  MapPinIcon,
  MapPinOffIcon,
  MousePointer2Icon,
  SquareDashedIcon,
  SquareMousePointerIcon,
} from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { browser } from 'wxt/browser'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { groupByPage } from '@/lib/collection/ops'
import { formatCollection } from '@/lib/format/markdown'
import { type BackgroundMessage, type Mode, MODES, type OverlayMessage } from '@/lib/messages'
import ClearAllDialog from './ClearAllDialog.vue'
import CopyFallbackDialog from './CopyFallbackDialog.vue'
import ItemList from './ItemList.vue'
import { useActiveTab } from './use-active-tab'
import { useMissing } from './use-missing'
import { useCollection } from '@/composables/use-collection'

const { collection } = useCollection()
const { tabId, status, refresh } = useActiveTab()
const { missing } = useMissing()

const count = computed(() => collection.value.items.length)
const groups = computed(() => {
  const current = status.value.kind === 'active' ? status.value.pageKey : undefined
  const all = groupByPage(collection.value).map((g) => ({ ...g, current: g.key === current }))
  return [...all.filter((g) => g.current), ...all.filter((g) => !g.current)]
})
const mode = computed(() => (status.value.kind === 'active' ? status.value.mode : undefined))
const pinsShown = computed(() => status.value.kind !== 'active' || status.value.pins)
const statusText = computed(() => {
  switch (status.value.kind) {
    case 'active':
      return `Active on ${status.value.host}`
    case 'blocked':
      return "Can't run on this page"
    default:
      return 'Not active on this page. Click the toolbar icon or press Alt+Shift+A.'
  }
})

const copyStatus = ref('')
const fallbackText = ref<string | null>(null)
const confirmClear = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | undefined

watch(collection, () => (copyStatus.value = ''))

function toBackground(message: BackgroundMessage) {
  browser.runtime.sendMessage(message).catch(() => undefined)
}

function toOverlay(message: OverlayMessage) {
  if (tabId.value === undefined) return
  browser.tabs.sendMessage(tabId.value, message).catch(() => undefined)
}

async function copy() {
  const text = formatCollection(collection.value, { missing: missing.value })
  const n = count.value
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    fallbackText.value = text
    return
  }
  copyStatus.value = `Copied ${n} item${n === 1 ? '' : 's'}`
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => (copyStatus.value = ''), 4000)
}

function setPins(visible: boolean) {
  toOverlay({ type: 'overlay:set-pins', visible })
  void refresh()
}

function setMode(next: unknown) {
  // A single toggle group reports '' when the active item is clicked again.
  if (!MODES.includes(next as Mode)) return
  toOverlay({ type: 'overlay:set-mode', mode: next as Mode })
  void refresh()
}
</script>

<template>
  <main class="flex h-screen flex-col bg-background text-sm text-foreground">
    <header class="space-y-3 border-b px-4 py-3">
      <div class="flex items-center gap-2">
        <h1 class="font-semibold">Feedback</h1>
        <Badge v-if="count" data-testid="item-count" variant="secondary">{{ count }}</Badge>
      </div>
      <p data-testid="tab-status" class="flex items-start gap-2 text-xs text-muted-foreground">
        <span
          class="mt-1 size-2 shrink-0 rounded-full"
          :class="{
            'bg-green-500': status.kind === 'active',
            'bg-red-500': status.kind === 'blocked',
            'bg-muted-foreground/40': status.kind === 'idle',
          }"
        />
        <span>{{ statusText }}</span>
      </p>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          :model-value="mode"
          :disabled="status.kind !== 'active'"
          @update:model-value="setMode"
        >
          <ToggleGroupItem value="browse" data-testid="mode-browse" aria-label="Browse mode">
            <MousePointer2Icon /> Browse
          </ToggleGroupItem>
          <ToggleGroupItem value="element" data-testid="mode-element" aria-label="Element mode">
            <SquareMousePointerIcon /> Element
          </ToggleGroupItem>
          <ToggleGroupItem value="area" data-testid="mode-area" aria-label="Area mode">
            <SquareDashedIcon /> Area
          </ToggleGroupItem>
        </ToggleGroup>
        <Toggle
          data-testid="toggle-pins"
          variant="outline"
          size="sm"
          :model-value="pinsShown"
          :disabled="status.kind !== 'active'"
          :aria-label="pinsShown ? 'Hide pins' : 'Show pins'"
          :title="pinsShown ? 'Hide pins on the page' : 'Show pins on the page'"
          @update:model-value="setPins"
        >
          <MapPinIcon v-if="pinsShown" />
          <MapPinOffIcon v-else />
          Pins
        </Toggle>
        <p
          v-if="status.kind === 'active'"
          class="flex items-center gap-1 text-xs text-muted-foreground"
          title="On the page: E for element mode, A for area mode, Esc for browse mode"
        >
          <kbd class="rounded border bg-muted px-1 font-mono">E</kbd>
          <kbd class="rounded border bg-muted px-1 font-mono">A</kbd>
          <kbd class="rounded border bg-muted px-1 font-mono">Esc</kbd>
        </p>
      </div>
    </header>

    <section class="flex-1 overflow-y-auto">
      <p v-if="!count" class="p-6 pt-12 text-center text-muted-foreground">
        No feedback yet: pick an element, drag an area, or select text.
      </p>
      <ItemList
        v-else
        :groups="groups"
        :missing="missing"
        @remove="(id) => toBackground({ type: 'annotation:remove', id })"
        @highlight="(id) => toOverlay({ type: 'overlay:highlight', id })"
        @reveal="(id) => toOverlay({ type: 'overlay:reveal', id })"
      />
    </section>

    <footer class="space-y-2 border-t p-3">
      <div class="flex gap-2">
        <Button data-testid="copy-prompt" class="flex-1" :disabled="!count" @click="copy">
          <CopyIcon /> Copy as prompt
        </Button>
        <Button
          data-testid="clear-all"
          variant="outline"
          :disabled="!count"
          @click="confirmClear = true"
        >
          Clear all
        </Button>
      </div>
      <p data-testid="copy-status" aria-live="polite" class="min-h-4 text-xs text-muted-foreground">
        {{ copyStatus }}
      </p>
    </footer>

    <ClearAllDialog
      v-model:open="confirmClear"
      :items="count"
      :pages="groups.length"
      @confirm="toBackground({ type: 'collection:clear' })"
    />
    <CopyFallbackDialog :text="fallbackText" @close="fallbackText = null" />
  </main>
</template>
