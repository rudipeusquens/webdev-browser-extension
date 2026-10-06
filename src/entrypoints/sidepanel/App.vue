<script setup lang="ts">
import {
  CopyIcon,
  MapPinIcon,
  MapPinOffIcon,
  MousePointer2Icon,
  SettingsIcon,
  SquareDashedIcon,
  SquareMousePointerIcon,
  XIcon,
} from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { browser } from 'wxt/browser'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { groupByPage } from '@/lib/collection/ops'
import { formatCollection } from '@/lib/format/markdown'
import {
  type BackgroundMessage,
  type Mode,
  MODES,
  type OverlayMessage,
  type Reply,
} from '@/lib/messages'
import { isSiteOrigin, originPattern } from '@/lib/settings'
import ClearAllDialog from './ClearAllDialog.vue'
import CopyFallbackDialog from './CopyFallbackDialog.vue'
import ItemList from './ItemList.vue'
import SettingsView from './SettingsView.vue'
import { useActiveTab } from './use-active-tab'
import { usePanelView } from './use-panel-view'
import { useMissing } from './use-missing'
import { useOverlayLines } from './use-overlay-lines'
import { usePanelToggle } from './use-panel-toggle'
import { useSettings } from './use-settings'
import { useShortcut } from './use-shortcut'
import { useCollection } from '@/composables/use-collection'

const { collection } = useCollection()
const { tabId, windowId, status, refresh } = useActiveTab()
usePanelToggle(windowId)
const { missing } = useMissing()
const { settings } = useSettings()
const { shortcut } = useShortcut()
const showSettings = ref(false)
// Open settings in a comment popover opens them here.
usePanelView(windowId, () => (showSettings.value = true))

const count = computed(() => collection.value.items.length)
const groups = computed(() => {
  const current = status.value.kind === 'active' ? status.value.pageKey : undefined
  const all = groupByPage(collection.value).map((g) => ({ ...g, current: g.key === current }))
  return [...all.filter((g) => g.current), ...all.filter((g) => !g.current)]
})
const mode = computed(() => (status.value.kind === 'active' ? status.value.mode : undefined))
const pinsShown = computed(() => status.value.kind !== 'active' || status.value.pins)
/** The origin of the active page, when it is a site that can be remembered. */
const siteOrigin = computed(() => {
  if (status.value.kind !== 'active') return null
  try {
    const { origin } = new URL(status.value.pageKey)
    return isSiteOrigin(origin) ? origin : null
  } catch {
    return null
  }
})
const remembered = computed(
  () => !!siteOrigin.value && settings.value.rememberedOrigins.includes(siteOrigin.value),
)
const statusText = computed(() => {
  switch (status.value.kind) {
    case 'active':
      return `Active on ${status.value.host}`
    case 'blocked':
      return "Can't run on this page"
    case 'failed':
      return "Couldn't start on this page. Reload it and try again; the page's console has details."
    default: {
      const press = shortcut.value ? `, press ${shortcut.value}` : ''
      return `Not active on this page. Click the toolbar icon${press} or right-click the page and choose "Annotate this page".`
    }
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

const siteError = ref('')

/** Always enable here: Chrome asks for access inside the click, then the site is remembered. */
function rememberSite() {
  const origin = siteOrigin.value
  if (!origin) return
  siteError.value = ''
  browser.permissions
    .request({ origins: [originPattern(origin)] })
    .then(async (granted) => {
      if (!granted) return
      const message: BackgroundMessage = { type: 'site:remember', origin }
      const reply = (await browser.runtime.sendMessage(message)) as Reply | undefined
      if (reply && !reply.ok) siteError.value = reply.error
    })
    .catch(() => undefined)
}

function forgetSite(origin: string) {
  toBackground({ type: 'site:forget', origin })
}

function goTo(pageKey: string) {
  if (tabId.value === undefined) return
  toBackground({ type: 'tab:go', tabId: tabId.value, pageKey })
}

useOverlayLines(tabId, status)

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
      <div data-testid="title-row" class="flex items-center gap-2">
        <h1 data-testid="panel-title" class="font-semibold">
          {{ showSettings ? 'Settings' : 'Edit' }}
        </h1>
        <Badge v-if="!showSettings && count" data-testid="item-count" variant="secondary">{{
          count
        }}</Badge>
        <Button
          v-if="showSettings"
          data-testid="close-settings"
          variant="ghost"
          size="icon-sm"
          class="ml-auto text-muted-foreground"
          aria-label="Close settings"
          title="Close settings"
          @click="showSettings = false"
        >
          <XIcon />
        </Button>
        <Button
          v-else
          data-testid="open-settings"
          variant="ghost"
          size="icon-sm"
          class="ml-auto text-muted-foreground"
          aria-label="Settings"
          title="Settings"
          @click="showSettings = true"
        >
          <SettingsIcon />
        </Button>
      </div>
      <template v-if="!showSettings">
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
            :title="pinsShown ? 'Hide pins on the page (P)' : 'Show pins on the page (P)'"
            @update:model-value="setPins"
          >
            <MapPinIcon v-if="pinsShown" />
            <MapPinOffIcon v-else />
            Pins
          </Toggle>
        </div>
        <p data-testid="tab-status" class="flex items-start gap-2 text-xs text-muted-foreground">
          <span
            class="mt-1 size-2 shrink-0 rounded-full"
            :class="{
              'bg-green-500': status.kind === 'active',
              'bg-red-500': status.kind === 'blocked' || status.kind === 'failed',
              'bg-muted-foreground/40': status.kind === 'idle',
            }"
          />
          <span class="min-w-0 flex-1">{{ statusText }}</span>
          <Button
            v-if="siteOrigin && !remembered"
            data-testid="remember-site"
            variant="outline"
            size="xs"
            class="-my-1 shrink-0"
            :title="`Load the overlay on every page of ${siteOrigin}`"
            @click="rememberSite"
          >
            Always enable here
          </Button>
          <Button
            v-else-if="siteOrigin"
            data-testid="forget-site"
            variant="ghost"
            size="xs"
            class="-my-1 shrink-0 text-muted-foreground"
            :title="`Stop loading the overlay on ${siteOrigin} by itself`"
            @click="forgetSite(siteOrigin)"
          >
            Forget this site
          </Button>
        </p>
        <p v-if="siteError" data-testid="site-error" role="alert" class="text-xs text-destructive">
          {{ siteError }}
        </p>
        <p
          v-if="status.kind === 'active'"
          data-testid="page-keys"
          class="flex items-center gap-1 text-xs text-muted-foreground"
          title="On the page: E for element mode, A for area mode, P to show or hide the pins, Esc for browse mode"
        >
          Keys on the page:
          <kbd class="rounded border bg-muted px-1 font-mono">E</kbd>
          <kbd class="rounded border bg-muted px-1 font-mono">A</kbd>
          <kbd class="rounded border bg-muted px-1 font-mono">P</kbd>
          <kbd class="rounded border bg-muted px-1 font-mono">Esc</kbd>
        </p>
      </template>
    </header>

    <SettingsView
      v-if="showSettings"
      :origins="settings.rememberedOrigins"
      :shortcut="shortcut"
      @forget="forgetSite"
    />
    <section v-else class="flex-1 overflow-y-auto">
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
        @go="goTo"
      />
    </section>

    <footer v-if="!showSettings" class="space-y-2 border-t p-3">
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
