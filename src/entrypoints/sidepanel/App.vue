<script setup lang="ts">
import {
  CopyIcon,
  MapPinIcon,
  Redo2Icon,
  RepeatIcon,
  MapPinOffIcon,
  MousePointer2Icon,
  SettingsIcon,
  SquareDashedIcon,
  SquareMousePointerIcon,
  Undo2Icon,
  XIcon,
} from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import { useSiteCollection } from '@/composables/use-site-collection'
import { emptyCollection, pick } from '@/lib/collection/ops'
import { type Filter, shows } from '@/lib/view'
import { useView } from './use-view'
import { useHistory } from './use-history'
import { currentPlatform, isMacPlatform, panelKey } from '@/lib/shortcuts'
import { siteLabel, siteOf } from '@/lib/collection/site'

const { tabId, windowId, status, refresh } = useActiveTab()
/** The site of the active tab's page, known while its overlay answers. */
const site = computed(() => {
  if (status.value.kind !== 'active') return null
  try {
    return siteOf(status.value.pageKey)
  } catch {
    return null
  }
})
const { collection: stored } = useSiteCollection(site)
/** What the panel lists: the active site's collection, empty without one. */
const collection = computed(() => stored.value ?? emptyCollection(site.value ?? 'file://'))
usePanelToggle(windowId)
const { missing } = useMissing()
const { settings } = useSettings()
const { shortcut } = useShortcut()
const showSettings = ref(false)
// Open settings in a comment popover opens them here.
usePanelView(windowId, () => (showSettings.value = true))

const { filter, choose } = useView()
const { labels } = useHistory(site)
const mac = isMacPlatform(currentPlatform())
const undoKey = mac ? '⌘Z' : 'Ctrl+Z'
const redoKey = mac ? '⇧⌘Z' : 'Ctrl+Shift+Z'

function history(type: 'history:undo' | 'history:redo') {
  if (site.value) void change({ type, site: site.value })
}

/** Ctrl+Z and Ctrl+Shift+Z (⌘ on macOS) in Edit, outside text fields; the page keeps its own. */
function onKeydown(e: KeyboardEvent) {
  if (showSettings.value || e.defaultPrevented) return
  const target = e.target as HTMLElement | null
  if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))
    return
  const action = panelKey(e, mac)
  if (!action) return
  e.preventDefault()
  if (action === 'undo' ? labels.value.undo : labels.value.redo) {
    history(action === 'undo' ? 'history:undo' : 'history:redo')
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  cancelJump()
})
const items = computed(() => collection.value.items)
const openIds = computed(() =>
  items.value
    .filter((item) => item.status === 'open')
    .sort((a, b) => a.number - b.number)
    .map((item) => item.id),
)
/** Open items: what the next Copy as prompt copies. */
const count = computed(() => openIds.value.length)
const counts = computed(() => ({
  open: count.value,
  all: items.value.filter((item) => shows(item, 'all')).length,
  deleted: items.value.filter((item) => item.status === 'deleted').length,
}))
const shown = computed(() => items.value.filter((item) => shows(item, filter.value)))
/** Items of the last copy that were not deleted since: what Copy again copies. */
const againIds = computed(() => {
  const kept = new Set(items.value.filter((i) => i.status !== 'deleted').map((i) => i.id))
  return collection.value.lastCopy.filter((id) => kept.has(id))
})
const groups = computed(() => {
  const current = status.value.kind === 'active' ? status.value.pageKey : undefined
  const all = groupByPage({ ...collection.value, items: shown.value }).map((g) => ({
    ...g,
    current: g.key === current,
  }))
  return [...all.filter((g) => g.current), ...all.filter((g) => !g.current)]
})
const pageCount = computed(() => new Set(items.value.map((item) => item.pageKey)).size)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
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

function toBackground(message: BackgroundMessage) {
  browser.runtime.sendMessage(message).catch(() => undefined)
}

/** Why the last change from the panel was refused; empty once one works. */
const panelError = ref('')

/** A change of the site's items: its refusal is shown, its success clears the last one. */
async function change(message: BackgroundMessage, refused = (error: string) => error) {
  let reply: Reply | undefined
  try {
    reply = (await browser.runtime.sendMessage(message)) as Reply | undefined
  } catch {
    reply = undefined
  }
  if (reply?.ok) panelError.value = ''
  else panelError.value = refused(reply?.error ?? 'The extension did not answer. Try again.')
}

function toOverlay(message: OverlayMessage) {
  if (tabId.value === undefined) return
  browser.tabs.sendMessage(tabId.value, message).catch(() => undefined)
}

/**
 * Writes the prompt of `ids` to the clipboard, or offers it for manual copying when the
 * clipboard refuses. True when the text was written or offered.
 */
async function writePrompt(ids: string[], done: string): Promise<boolean> {
  const text = formatCollection(pick(collection.value, new Set(ids)), { missing: missing.value })
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    fallbackText.value = text
    return true
  }
  copyStatus.value = done
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => (copyStatus.value = ''), 4000)
  return true
}

/** The open items; then exactly those become done (spec section 7). */
async function copy() {
  const ids = openIds.value
  const current = site.value
  if (!current || ids.length === 0) return
  await writePrompt(ids, `Copied ${plural(ids.length, 'pin')}`)
  await change(
    { type: 'collection:copied', site: current, ids },
    (error) => `Copied, but the pins could not be marked done: ${error}`,
  )
}

/** The last copy again, for a paste that went wrong; it changes nothing. */
async function copyAgain() {
  const ids = againIds.value
  if (ids.length > 0) await writePrompt(ids, `Copied ${plural(ids.length, 'pin')} again`)
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

function changeItem(
  type: 'annotation:remove' | 'annotation:restore' | 'annotation:reopen',
  id: string,
) {
  if (site.value) void change({ type, site: site.value, id })
}

function clearSite() {
  if (site.value) void change({ type: 'collection:clear', site: site.value })
}

function goTo(pageKey: string) {
  cancelJump()
  if (tabId.value === undefined) return
  toBackground({ type: 'tab:go', tabId: tabId.value, pageKey })
}

const { pointed } = useOverlayLines(tabId, status)

/** How long a jump to an item of another page waits for that page's overlay. */
const JUMP_WAIT = 30_000
let jump: {
  tab: number
  pageKey: string
  id: string
  timer: ReturnType<typeof setTimeout>
} | null = null

function cancelJump() {
  if (jump) clearTimeout(jump.timer)
  jump = null
}

/** An entry of another page: open the page in the tab, then show the item once it is ready. */
function jumpTo(pageKey: string, id: string) {
  cancelJump()
  const tab = tabId.value
  if (tab === undefined) return
  toBackground({ type: 'tab:go', tabId: tab, pageKey })
  jump = { tab, pageKey, id, timer: setTimeout(cancelJump, JUMP_WAIT) }
}

watch(status, (now) => {
  if (!jump || now.kind !== 'active') return
  if (tabId.value !== jump.tab || now.pageKey !== jump.pageKey) return
  const { id } = jump
  cancelJump()
  toOverlay({ type: 'overlay:reveal', id })
})

function reveal(id: string) {
  cancelJump()
  toOverlay({ type: 'overlay:reveal', id })
}

function setPins(visible: boolean) {
  toOverlay({ type: 'overlay:set-pins', visible })
  void refresh()
}

function setFilter(next: unknown) {
  // A single toggle group reports '' when the active item is clicked again.
  if (next === 'open' || next === 'all' || next === 'with-deleted') choose(next as Filter)
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
        <span
          v-if="!showSettings && site"
          data-testid="title-site"
          class="min-w-0 truncate font-mono text-xs text-muted-foreground"
          :title="site"
          >{{ siteLabel(site) }}</span
        >
        <Badge v-if="!showSettings && count" data-testid="item-count" variant="secondary">{{
          count
        }}</Badge>
        <template v-if="!showSettings">
          <Button
            data-testid="undo"
            variant="ghost"
            size="icon-sm"
            class="ml-auto text-muted-foreground"
            :disabled="!labels.undo"
            aria-label="Undo"
            :title="
              labels.undo ? `Undo: ${labels.undo} (${undoKey})` : `Nothing to undo (${undoKey})`
            "
            @click="history('history:undo')"
          >
            <Undo2Icon />
          </Button>
          <Button
            data-testid="redo"
            variant="ghost"
            size="icon-sm"
            class="text-muted-foreground"
            :disabled="!labels.redo"
            aria-label="Redo"
            :title="
              labels.redo ? `Redo: ${labels.redo} (${redoKey})` : `Nothing to redo (${redoKey})`
            "
            @click="history('history:redo')"
          >
            <Redo2Icon />
          </Button>
        </template>
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
          class="text-muted-foreground"
          aria-label="Settings"
          title="Settings"
          @click="showSettings = true"
        >
          <SettingsIcon />
        </Button>
      </div>
      <template v-if="!showSettings">
        <!-- The modes share the row; Pins keeps 8 px to them, and wraps when it must. -->
        <div class="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            class="w-auto flex-1"
            :model-value="mode"
            :disabled="status.kind !== 'active'"
            @update:model-value="setMode"
          >
            <ToggleGroupItem
              value="browse"
              data-testid="mode-browse"
              class="flex-1 gap-1.5 px-2"
              aria-label="Browse mode"
            >
              <MousePointer2Icon /> Browse
            </ToggleGroupItem>
            <ToggleGroupItem
              value="element"
              data-testid="mode-element"
              class="flex-1 gap-1.5 px-2"
              aria-label="Element mode"
            >
              <SquareMousePointerIcon /> Element
            </ToggleGroupItem>
            <ToggleGroupItem
              value="area"
              data-testid="mode-area"
              class="flex-1 gap-1.5 px-2"
              aria-label="Area mode"
            >
              <SquareDashedIcon /> Area
            </ToggleGroupItem>
          </ToggleGroup>
          <Toggle
            data-testid="toggle-pins"
            variant="outline"
            size="sm"
            class="gap-1.5 px-2"
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
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          class="w-full"
          aria-label="Show"
          :model-value="filter"
          :disabled="!site"
          @update:model-value="setFilter"
        >
          <ToggleGroupItem
            value="open"
            data-testid="filter-open"
            class="flex-1"
            title="Open pins only: what Copy as prompt copies"
          >
            Open <span class="text-muted-foreground tabular-nums">{{ counts.open }}</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="all"
            data-testid="filter-all"
            class="flex-1"
            title="Open and done pins"
          >
            All <span class="text-muted-foreground tabular-nums">{{ counts.all }}</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="with-deleted"
            data-testid="filter-with-deleted"
            class="flex-1"
            title="Deleted pins too"
          >
            + Deleted <span class="text-muted-foreground tabular-nums">{{ counts.deleted }}</span>
          </ToggleGroupItem>
        </ToggleGroup>
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
      </template>
    </header>

    <SettingsView
      v-if="showSettings"
      :settings="settings"
      :shortcut="shortcut"
      @forget="forgetSite"
    />
    <section v-else data-testid="list-area" class="flex-1 overflow-y-auto">
      <!-- Empty states sit in the middle of the list area. -->
      <div v-if="!site || !shown.length" class="flex min-h-full items-center justify-center p-6">
        <div data-testid="empty-state" class="max-w-72 text-center text-muted-foreground">
          <p v-if="!site" data-testid="no-site">
            Feedback is kept per site. Start the overlay on a page to see the feedback of its site.
          </p>
          <p v-else-if="!items.length">
            No feedback yet: pick an element, drag an area, or select text.
          </p>
          <p v-else data-testid="filter-hides">
            Nothing to show here. {{ plural(items.length, 'pin') }}
            {{ items.length === 1 ? 'is' : 'are' }} hidden by this filter.
          </p>
        </div>
      </div>
      <ItemList
        v-else
        :groups="groups"
        :missing="missing"
        :pointed="pointed"
        :page-titles="settings.pageTitles"
        @remove="(id) => changeItem('annotation:remove', id)"
        @restore="(id) => changeItem('annotation:restore', id)"
        @reopen="(id) => changeItem('annotation:reopen', id)"
        @highlight="(id) => toOverlay({ type: 'overlay:highlight', id })"
        @reveal="reveal"
        @jump="jumpTo"
        @go="goTo"
      />
    </section>

    <footer v-if="!showSettings" class="relative border-t p-3">
      <!-- Above the buttons, so the footer's padding is the same on every side. -->
      <div v-if="panelError || copyStatus" class="mb-2 space-y-1 text-xs">
        <p v-if="panelError" data-testid="panel-error" role="alert" class="text-destructive">
          {{ panelError }}
        </p>
        <p v-if="copyStatus" class="text-muted-foreground" aria-hidden="true">{{ copyStatus }}</p>
      </div>
      <!-- Two rows: three labels do not fit side by side in a narrow panel. -->
      <div class="grid grid-cols-2 gap-2">
        <Button
          data-testid="copy-prompt"
          class="col-span-2"
          :disabled="!count"
          title="Copy the open pins; they become done"
          @click="copy"
        >
          <CopyIcon /> Copy as prompt
        </Button>
        <Button
          data-testid="copy-again"
          variant="outline"
          :disabled="!againIds.length"
          title="Copy the last copied pins again; nothing changes"
          @click="copyAgain"
        >
          <RepeatIcon /> Copy again
        </Button>
        <Button
          data-testid="clear-all"
          variant="outline"
          :disabled="!items.length"
          @click="confirmClear = true"
        >
          Clear all
        </Button>
      </div>
      <!-- Always there, so screen readers announce each copy. -->
      <p data-testid="copy-status" aria-live="polite" class="sr-only">{{ copyStatus }}</p>
    </footer>

    <ClearAllDialog
      v-model:open="confirmClear"
      :items="items.length"
      :pages="pageCount"
      :site="site ? siteLabel(site) : ''"
      @confirm="clearSite"
    />
    <CopyFallbackDialog :text="fallbackText" @close="fallbackText = null" />
  </main>
</template>
