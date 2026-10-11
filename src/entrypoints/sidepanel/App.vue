<script setup lang="ts">
import {
  CopyIcon,
  MapPinIcon,
  Redo2Icon,
  RepeatIcon,
  MapPinOffIcon,
  MousePointer2Icon,
  PlusIcon,
  SettingsIcon,
  SquareDashedIcon,
  SquareMousePointerIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { browser } from 'wxt/browser'
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
  PIN_NOT_KEPT,
} from '@/lib/messages'
import { NO_ANSWER, request } from '@/lib/request'
import { isSiteOrigin, originPattern } from '@/lib/settings'
import EmptyBinDialog from './EmptyBinDialog.vue'
import CopyFallbackDialog, { type Fallback } from './CopyFallbackDialog.vue'
import ForgetSiteDialog from './ForgetSiteDialog.vue'
import ItemList from './ItemList.vue'
import NoteList from './NoteList.vue'
import RecButton from './RecButton.vue'
import RecMessages from './RecMessages.vue'
import SitePill from './SitePill.vue'
import SettingsView from './SettingsView.vue'
import { useActiveTab } from './use-active-tab'
import { writeClipboard } from './clipboard'
import { useDictation } from './use-dictation'
import { usePanelView } from './use-panel-view'
import { useMissing } from './use-missing'
import { useOverlayLines } from './use-overlay-lines'
import { usePinJump } from './use-pin-jump'
import { usePanelToggle } from './use-panel-toggle'
import { useSettings } from './use-settings'
import { useShortcut } from './use-shortcut'
import { NOTES_KEY, parseNotes } from '@/lib/notes/model'
import { copyable, jobsKey, parseJobs } from '@/lib/voice/jobs'
import { useSiteCollection } from '@/composables/use-site-collection'
import { useStored } from '@/composables/use-stored'
import { emptyCollection, pick } from '@/lib/collection/ops'
import { plural } from '@/lib/text'
import { isFilter, shows } from '@/lib/view'
import { useView } from './use-view'
import { useHistory } from './use-history'
import { isMacPlatform, panelKey, recKey } from '@/lib/shortcuts'
import { siteLabel, siteOrNull } from '@/lib/collection/site'

const { tabId, windowId, status, refresh } = useActiveTab()
/** The site of the active tab's page, known while its overlay answers. */
const site = computed(() =>
  status.value.kind === 'active' ? siteOrNull(status.value.pageKey) : null,
)
const { collection: stored, loading } = useSiteCollection(site)
/** Rec's notes, the same on every site (spec section 8). */
const storedNotes = useStored(ref(NOTES_KEY), parseNotes).value
const notes = computed(() => storedNotes.value.items)
/** The active site's pins whose dictation is not done; Copy as prompt waits until it is read. */
const { value: jobs, loaded: jobsLoaded } = useStored(
  computed(() => (site.value ? jobsKey(site.value) : null)),
  parseJobs,
)
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
const mac = isMacPlatform()
const undoKey = mac ? '⌘Z' : 'Ctrl+Z'
const redoKey = mac ? '⇧⌘Z' : 'Ctrl+Shift+Z'
const recShortcut = mac ? '⌥V' : 'Alt+V'

function history(type: 'history:undo' | 'history:redo') {
  if (site.value) void change({ type, site: site.value })
}

/**
 * In Edit, outside text fields: Ctrl+Z and Ctrl+Shift+Z (⌘ on macOS), the page keeps its own;
 * Alt+V starts and stops Rec, Escape cancels it while no dialog is open.
 */
function onKeydown(e: KeyboardEvent) {
  if (showSettings.value || e.defaultPrevented) return
  const target = e.target as HTMLElement | null
  if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))
    return
  const rec = recKey(e)
  if (rec === 'toggle') {
    e.preventDefault()
    dictation.toggle()
    return
  }
  if (rec === 'cancel') {
    const dialog = fallback.value !== null || confirmEmpty.value || forgetting.value !== null
    if (dictation.busy.value && !dialog) {
      e.preventDefault()
      dictation.cancel()
    }
    return
  }
  const action = panelKey(e, mac)
  if (!action) return
  e.preventDefault()
  if (action === 'undo' ? labels.value.undo : labels.value.redo) {
    history(action === 'undo' ? 'history:undo' : 'history:redo')
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
const items = computed(() => collection.value.items)
/** Open pins whose comment is complete: no drafts, nothing transcribed (spec section 8). */
const openIds = computed(() =>
  items.value
    .filter((item) => copyable(item, jobs.value))
    .sort((a, b) => a.number - b.number)
    .map((item) => item.id),
)
/** What the next Copy as prompt copies: nothing until the site's dictations are read. */
const count = computed(() => (jobsLoaded.value ? openIds.value.length : 0))
const binned = computed(() => items.value.filter((item) => item.status === 'deleted'))
const binPages = computed(() => new Set(binned.value.map((item) => item.pageKey)).size)
/** The filter's counts; `all` is also what Clear all moves to Deleted: the open and done items. */
const counts = computed(() => ({
  open: items.value.filter((item) => item.status === 'open').length,
  all: items.value.filter((item) => shows(item, 'all')).length,
  deleted: binned.value.length,
}))
/** Open items it leaves out: drafts, and pins still transcribed. */
const leftOut = computed(() => counts.value.open - count.value)
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
/** What the empty Edit view says while the overlay does not run on the tab. */
const startText = computed(() => {
  switch (status.value.kind) {
    case 'blocked':
      return "Can't run on this page: Chrome keeps extensions off it."
    case 'failed':
      return "Couldn't start on this page. Reload it and try again; the page's console has details."
    default: {
      const press = shortcut.value ? ` or press ${shortcut.value}` : ''
      const menu = settings.value.contextMenu
        ? ', or right-click the page and choose "Annotate this page"'
        : ''
      return `Click the toolbar icon${press} to annotate this page${menu}.`
    }
  }
})
/**
 * A page without the overlay that the panel can start it on: Chrome tells the panel its
 * address only where the extension may run already (spec section 8).
 */
const startable = computed(
  () => status.value.kind === 'idle' && siteOrNull(status.value.url) !== null,
)

const copyStatus = ref('')
/** Texts the clipboard did not take, offered for copying by hand one after the other. */
const fallbacks = ref<Fallback[]>([])
const fallback = computed(() => fallbacks.value[0] ?? null)
const confirmEmpty = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | undefined

function toBackground(message: BackgroundMessage) {
  browser.runtime.sendMessage(message).catch(() => undefined)
}

/** Why the last change from the panel was refused; empty once one works. */
const panelError = ref('')

/**
 * A change of the site's items, or Go to: its refusal is shown, its success clears the last
 * one. True when it was made.
 */
async function change(
  message: BackgroundMessage,
  refused = (error: string) => error,
): Promise<boolean> {
  const reply = await request(message)
  if (reply?.ok) panelError.value = ''
  else panelError.value = refused(reply?.error ?? NO_ANSWER)
  return reply?.ok === true
}

/** A short note above the footer's buttons, gone after a few seconds. */
function say(text: string) {
  copyStatus.value = text
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => (copyStatus.value = ''), 4000)
}

function toOverlay(message: OverlayMessage) {
  if (tabId.value === undefined) return
  browser.tabs.sendMessage(tabId.value, message, { frameId: 0 }).catch(() => undefined)
}

/**
 * Writes the prompt of `ids` to the clipboard, or offers it for manual copying when the
 * clipboard refuses.
 */
async function writePrompt(ids: string[], done: string): Promise<void> {
  const text = formatCollection(pick(collection.value, new Set(ids)), { missing: missing.value })
  const settle = dictation.copyingOther()
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    settle(false)
    fallbacks.value.push({ text, kind: 'prompt' })
    return
  }
  settle(true)
  say(done)
}

const dictation = useDictation(
  {
    write: writeClipboard,
    copied: () => say('Copied dictation'),
    offer: (text, refused) =>
      fallbacks.value.push({ text, kind: refused ? 'dictation' : 'outdone' }),
  },
  notes,
)
/** What screen readers hear of Rec: its changes, not every second of its clock. */
const recSpoken = computed(() => {
  const now = dictation.state.value.state
  if (now === 'recording') return `Recording. ${recShortcut} stops it.`
  if (now === 'paused') return 'Rec paused at the limit. Keep recording?'
  return ''
})

/** A note's text as it is, from its own Copy. */
function copyNote(id: string) {
  const text = notes.value.find((note) => note.id === id)?.text
  if (!text) return
  const settle = dictation.copyingOther()
  const written = writeClipboard(text)
  settle(written)
  if (written) say('Copied note')
  else fallbacks.value.push({ text, kind: 'dictation' })
}

function retryNote(id: string) {
  dictation.retried(id)
  void change({ type: 'note:retry', id })
}

/** Copies the prompt of `ids`, then marks them done on `current`; `noun` names them in a refusal. */
async function copyPins(ids: string[], current: string, done: string, noun: 'pin' | 'pins') {
  await writePrompt(ids, done)
  await change(
    { type: 'collection:copied', site: current, ids },
    (error) => `Copied, but the ${noun} could not be marked done: ${error}`,
  )
}

/** The open items; then exactly those become done (spec section 7). */
async function copy() {
  const ids = openIds.value
  const current = site.value
  if (!current || ids.length === 0 || !jobsLoaded.value) return
  const left = leftOut.value ? `. ${leftOut.value} left out: drafts and pins still transcribed` : ''
  await copyPins(ids, current, `Copied ${plural(ids.length, 'pin')}${left}`, 'pins')
}

/** One open pin, from its entry: it becomes done, and Copy again copies it. */
async function copyOne(id: string) {
  const current = site.value
  const item = items.value.find((i) => i.id === id)
  if (!current || !item) return
  await copyPins([id], current, `Copied pin ${item.number}`, 'pin')
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
      const reply = await request(message)
      if (reply && !reply.ok) siteError.value = reply.error
    })
    .catch(() => undefined)
}

/** The site whose Forget waits for its confirmation. */
const forgetting = ref<string | null>(null)

function forgetSite(origin: string) {
  toBackground({ type: 'site:forget', origin })
}

/** Annotate this page, from the panel: where Chrome lets the extension, without the toolbar. */
function startOverlay() {
  if (tabId.value !== undefined) void change({ type: 'tab:start', tabId: tabId.value })
}

function changeItem(
  type: 'annotation:remove' | 'annotation:restore' | 'annotation:reopen',
  id: string,
) {
  if (site.value) void change({ type, site: site.value, id })
}

/** Clear all: the open and done pins move to Deleted, at once (Undo and Restore exist). */
async function clearSite() {
  const moved = counts.value.all
  if (!site.value || moved === 0) return
  if (await change({ type: 'collection:clear', site: site.value })) {
    say(`Moved ${plural(moved, 'pin')} to Deleted`)
  }
}

function emptySiteBin() {
  if (site.value) void change({ type: 'collection:empty-bin', site: site.value })
}

const { pointed } = useOverlayLines(tabId, status)
// A refusal for the popover's unsaved text holds only while that popover is open (on the tab
// the panel shows).
watch(
  () => pointed.value.popover,
  (open) => {
    if (!open && panelError.value === PIN_NOT_KEPT) panelError.value = ''
  },
)

const { goTo, jumpTo, reveal } = usePinJump(tabId, status, change, panelError)

function setPins(visible: boolean) {
  toOverlay({ type: 'overlay:set-pins', visible })
  void refresh()
}

function setFilter(next: unknown) {
  // A single toggle group reports '' when the active item is clicked again.
  if (isFilter(next)) choose(next)
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
      <div data-testid="title-row" class="relative flex h-8 items-center gap-2">
        <h1 data-testid="panel-title" class="font-semibold">
          {{ showSettings ? 'Settings' : 'Edit' }}
        </h1>
        <!-- In the middle of the row, kept clear of what sits at either side. -->
        <div
          class="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 justify-center"
          :class="showSettings ? 'w-[calc(100%-10rem)]' : 'w-[calc(100%-14rem)]'"
        >
          <SitePill
            :status="status"
            :remembered="remembered"
            @start="startOverlay"
            @remember="rememberSite"
            @forget="forgetting = siteOrigin"
          />
        </div>
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
      <!--
        Two rows on one grid: the modes and Rec, the filter and Pins. Rec and Pins share a
        column that grows with the panel (22 %), 8 px from the rest, which keeps at least the
        width of its content. Too narrow for their words, Rec and Pins show their icons only.
      -->
      <div
        v-if="!showSettings"
        data-testid="controls"
        class="grid grid-cols-[minmax(min-content,1fr)_minmax(2.25rem,22%)] items-center gap-x-2 gap-y-3"
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          class="w-full"
          :model-value="mode"
          :disabled="status.kind !== 'active'"
          @update:model-value="setMode"
        >
          <ToggleGroupItem
            value="browse"
            data-testid="mode-browse"
            class="min-w-max flex-1 gap-1.5 px-2"
            aria-label="Browse mode"
          >
            <MousePointer2Icon /> Browse
          </ToggleGroupItem>
          <ToggleGroupItem
            value="element"
            data-testid="mode-element"
            class="min-w-max flex-1 gap-1.5 px-2"
            aria-label="Element mode"
          >
            <SquareMousePointerIcon /> Element
          </ToggleGroupItem>
          <ToggleGroupItem
            value="area"
            data-testid="mode-area"
            class="min-w-max flex-1 gap-1.5 px-2"
            aria-label="Area mode"
          >
            <SquareDashedIcon /> Area
          </ToggleGroupItem>
        </ToggleGroup>
        <div class="@container min-w-0">
          <RecButton
            data-testid="rec"
            :state="dictation.state.value.state"
            :clock="dictation.clock.value"
            :shortcut="recShortcut"
            @toggle="dictation.toggle()"
          />
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
            class="min-w-max flex-1 px-2"
            title="Open pins only: what Copy as prompt copies"
          >
            Open <span class="text-muted-foreground tabular-nums">{{ counts.open }}</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="all"
            data-testid="filter-all"
            class="min-w-max flex-1 px-2"
            title="Open and done pins"
          >
            All <span class="text-muted-foreground tabular-nums">{{ counts.all }}</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="with-deleted"
            data-testid="filter-with-deleted"
            class="min-w-max flex-1 px-2"
            title="Deleted pins too"
          >
            + Deleted <span class="text-muted-foreground tabular-nums">{{ counts.deleted }}</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <div class="@container min-w-0">
          <Toggle
            data-testid="toggle-pins"
            variant="outline"
            size="sm"
            class="w-full gap-1.5 px-2"
            :model-value="pinsShown"
            :disabled="status.kind !== 'active'"
            :aria-label="pinsShown ? 'Hide pins' : 'Show pins'"
            :title="pinsShown ? 'Hide pins on the page (P)' : 'Show pins on the page (P)'"
            @update:model-value="setPins"
          >
            <MapPinIcon v-if="pinsShown" />
            <MapPinOffIcon v-else />
            <span class="hidden @min-[4.75rem]:inline">Pins</span>
          </Toggle>
        </div>
      </div>
      <span class="sr-only" role="status" aria-live="polite">{{ recSpoken }}</span>
      <p v-if="siteError" data-testid="site-error" role="alert" class="text-xs text-destructive">
        {{ siteError }}
      </p>
    </header>

    <SettingsView
      v-if="showSettings"
      :settings="settings"
      :shortcut="shortcut"
      @forget="(origin) => (forgetting = origin)"
    />
    <section v-else data-testid="list-area" class="flex flex-1 flex-col overflow-y-auto">
      <!-- Rec's notes come first, on every site and also without one. -->
      <NoteList
        v-if="notes.length"
        :notes="notes"
        @copy="copyNote"
        @remove="(id) => change({ type: 'note:delete', id })"
        @retry="retryNote"
        @settings="showSettings = true"
      />
      <!-- A new site's pins are being read: neither the last site's list nor an empty state. -->
      <template v-if="site && loading" />
      <!-- Empty states sit in the middle of the list area. -->
      <div v-else-if="!site || !shown.length" class="flex flex-1 items-center justify-center p-6">
        <div data-testid="empty-state" class="max-w-72 space-y-3 text-center text-muted-foreground">
          <template v-if="!site">
            <p data-testid="tab-status">
              {{ startable ? 'The overlay is not running on this page yet.' : startText }}
            </p>
            <Button v-if="startable" data-testid="start-overlay-center" @click="startOverlay">
              <PlusIcon /> Annotate this page
            </Button>
            <p data-testid="no-site" class="text-xs">
              Feedback is kept per site. It shows here once the overlay runs on the page.
            </p>
          </template>
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
        :jobs="jobs"
        @job-retry="(id) => site && change({ type: 'dictation:retry', site, id })"
        @job-dismiss="(id) => site && change({ type: 'dictation:dismiss', site, id })"
        @settings="showSettings = true"
        @remove="(id) => changeItem('annotation:remove', id)"
        @restore="(id) => changeItem('annotation:restore', id)"
        @reopen="(id) => changeItem('annotation:reopen', id)"
        @copy="copyOne"
        @highlight="(id) => toOverlay({ type: 'overlay:highlight', id })"
        @reveal="reveal"
        @jump="jumpTo"
        @go="goTo"
      />
    </section>

    <footer v-if="!showSettings" class="relative border-t p-3">
      <!-- Above the buttons, so the footer's padding is the same on every side. -->
      <div
        v-if="panelError || dictation.failure.value || dictation.paused.value || copyStatus"
        class="mb-2 space-y-1 text-xs"
      >
        <p v-if="panelError" data-testid="panel-error" role="alert" class="text-destructive">
          {{ panelError }}
        </p>
        <RecMessages
          :paused="dictation.paused.value"
          :clock="dictation.clock.value"
          :failure="dictation.failure.value"
          @keep="dictation.resume()"
          @toggle="dictation.toggle()"
          @settings="showSettings = true"
        />
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
        <!-- Once only deleted pins are left, the bin can be emptied. -->
        <Button
          v-if="counts.all || !binned.length"
          data-testid="clear-all"
          variant="outline"
          :disabled="!counts.all"
          title="Move every open and done pin to Deleted"
          @click="clearSite"
        >
          <Trash2Icon /> Clear all
        </Button>
        <Button
          v-else
          data-testid="empty-bin"
          variant="outline"
          title="Remove the deleted pins for good"
          @click="confirmEmpty = true"
        >
          <Trash2Icon /> Empty bin
        </Button>
      </div>
      <!-- Always there, so screen readers announce each copy. -->
      <p data-testid="copy-status" aria-live="polite" class="sr-only">{{ copyStatus }}</p>
    </footer>

    <EmptyBinDialog
      v-model:open="confirmEmpty"
      :pins="binned.length"
      :pages="binPages"
      :site="site ? siteLabel(site) : ''"
      @confirm="emptySiteBin"
    />
    <CopyFallbackDialog :fallback="fallback" @close="fallbacks.shift()" />
    <ForgetSiteDialog :origin="forgetting" @confirm="forgetSite" @close="forgetting = null" />
  </main>
</template>
