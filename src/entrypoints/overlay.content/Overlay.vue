<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowReactive,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import { browser } from 'wxt/browser'
import { useSiteCollection } from '@/composables/use-site-collection'
import { keepNewest } from '@/composables/use-stored'
import { useVoice } from '@/composables/use-voice'
import { closestOf, deepActiveElement, tagOf } from '@/lib/capture/dom'
import { snapshotArea } from '@/lib/capture/area'
import { pageInfo, snapshotElement } from '@/lib/capture/snapshot'
import { type CapturedText, sameRange, selectionRange, snapshotRange } from '@/lib/capture/text'
import type { PageInfo, Rect, Status, Target } from '@/lib/collection/model'
import { siteOf } from '@/lib/collection/site'
import { type Tone, toneOf } from '@/lib/status'
import { type Filter, loadView, watchView } from '@/lib/view'
import { isMacPlatform } from '@/lib/shortcuts'
import { truncate } from '@/lib/text'
import {
  type BackgroundMessage,
  isOverlayMessage,
  type Mode,
  type OverlayStatus,
  type PanelMessage,
  type Reply,
} from '@/lib/messages'
import { request } from '@/lib/request'
import { loadStored, watchStored } from '@/lib/storage'
import { jobsKey, parseJobs, type SiteJobs } from '@/lib/voice/jobs'
import { within } from '@/lib/within'
import CommentPopover from './CommentPopover.vue'
import HoverBox from './HoverBox.vue'
import { newId } from '@/lib/ids'
import { type Origins, readOrigins, selectorsOf, withOrigins } from './origins'
import { pageShortcut } from './keys'
import { createLinkSelect, pageSelectSurface } from './link-select'
import { forwardsWheel, isEditable, pickAt, TargetPath, wheelTarget } from './picker'
import { boxOf, type LiveAnchor, linesOf, notRendered, onArea, onElement, onRange } from './pins'
import type { Layer } from './top-layer'
import { rectBetween } from './place'
import SelectionChip from './SelectionChip.vue'
import TextHighlight from './TextHighlight.vue'
import { useComponentNames } from './use-component-names'
import { usePage } from './use-page'
import { usePanelLines } from './use-panel-lines'
import { usePins } from './use-pins'
import { useSelectionChip } from './use-selection-chip'
import { useTracking } from './use-tracking'

const props = defineProps<{ host: HTMLElement; layer: Layer }>()

// Containers that script focus traps (Radix, reka-ui, focus-trap) usually guard.
const TRAP = '[aria-modal="true"], [role="dialog"], [role="alertdialog"]'
const FOCUS_TAKEN = 'This page took the focus. Click into the comment field to continue.'
const NOT_SAVED = 'Could not save. Reload the page and try again.'
/** Smaller drags are clicks, not areas. */
const MIN_AREA = 4
/**
 * How long after marking a save waits for the code origins: the background gives the page
 * 1.5 s to answer, this leaves room for the messages around it.
 */
const ORIGIN_WAIT = 2000
/** How long a reveal waits for its item to be placed: the page may still be loading. */
const REVEAL_WAIT = 3000

interface Draft {
  key: number
  /** The pin's id: an existing one's, or a new one's from the moment it is marked. */
  id: string
  /** A new pin was stored meanwhile (kept, or its dictation handed over). */
  stored?: boolean
  kind: Target['kind']
  /** The element that holds the target: focus traps are looked for around it. */
  el: Element
  /** The target's box in viewport coordinates, now. */
  rect: () => Rect
  /** A selected text, drawn line by line. */
  range?: Range
  /** The popover's header for the target's box now: its size, or that it is not rendered. */
  label: (rect: Rect) => string
  busy: boolean
  error?: string
  /** A new item: taken when it was marked, what was true at that moment. */
  target?: Target
  /** What to remember for a new item once it is saved: more precise than its selector. */
  live?: LiveAnchor
  /** A new item's code origins, asked for when it was marked (`performance.now()`). */
  origins?: Promise<Origins>
  marked?: number
  /** The page a new item was marked on: the app may navigate while the comment is written. */
  page?: PageInfo
  /** An existing item being edited. */
  edit?: { id: string; number: number; comment: string; status: Status; draft?: true }
}

// This overlay, for the panel: a new injection (after an update, or where this one did not
// answer) starts a new one on the same tab.
const instance = newId()
const mode = ref<Mode>('browse')
const path = shallowRef<TargetPath | null>(null)
const hovered = shallowRef<Element | null>(null)
const draft = shallowRef<Draft | null>(null)
const popover = useTemplateRef<{ snapshot(): string }>('popover')
// A counter that gives the popover's field the focus again.
const nudge = ref(0)
const highlighted = ref<string | null>(null)
// The panel or the P key can hide the pins, until they show them again or the overlay
// restarts.
const pinsShown = ref(true)
// The pin whose outline is drawn stronger: the pointer rests on it.
const hoveredPin = ref<string | null>(null)
// The rectangle being dragged in area mode, in viewport coordinates.
const drag = shallowRef<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(
  null,
)
const { frame, layout } = useTracking()
const { key: page } = usePage()
// The site of this page: a single-page app stays on it while it navigates.
const site = siteOf(location.href)
const { collection } = useSiteCollection(ref(site))
// The state of the pins' dictations while they are not done (spec section 8).
const jobs = shallowRef<SiteJobs>({})
const newestJobs = keepNewest((now: SiteJobs) => (jobs.value = now))
const stopJobs = watchStored(jobsKey(site), parseJobs, newestJobs.changed)
void loadStored(jobsKey(site), parseJobs).then(newestJobs.loaded)
// The dictation belongs to the overlay, not to a popover: it outlives the popover's changes.
const voice = useVoice({
  // Another recording wants to start (another tab, Rec): this one is handed over, if it
  // recorded anything of the developer's own stop (a starting or held one is dropped).
  yielded: () => {
    if (draft.value && running()) void stopDictation()
    else voice.cancel()
  },
  // The limit's question went unanswered.
  timedOut: () => void stopDictation(),
})
// The panel's filter: which items have pins (spec section 8).
const filter = ref<Filter>('open')
const newestFilter = keepNewest((now: Filter) => (filter.value = now))
const stopView = watchView((view) => newestFilter.changed(view.filter))
void loadView().then((view) => newestFilter.loaded(view.filter))
// What was marked in this session, by item id: more precise than the stored selector.
const live = shallowReactive(new Map<string, LiveAnchor>())
let pointed: Element | null = null
let lastPointer: { x: number; y: number } | null = null
let drafts = 0

function rectOf(el: Element): Rect {
  void frame.value
  return boxOf(el)
}

/** A box's size, or "hidden" for a target that is not rendered (a closed menu). */
const sizeOf = (r: Rect) =>
  notRendered(r) ? 'hidden' : `${Math.round(r.width)}×${Math.round(r.height)}`

const describe = (el: Element, r: Rect, component?: string | null) =>
  [tagOf(el), component, sizeOf(r)].filter(Boolean).join(' · ')

const hoverRect = computed(() =>
  hovered.value && mode.value === 'element' && !draft.value ? rectOf(hovered.value) : null,
)
const hoverLabel = computed(() =>
  hovered.value && hoverRect.value
    ? describe(hovered.value, hoverRect.value, componentOf(hovered.value))
    : '',
)
const dragRect = computed(() => drag.value && rectBetween(drag.value.from, drag.value.to))
// A selected text is measured once per frame, before anything is written: box and lines.
const draftText = computed(() => {
  void frame.value
  const range = draft.value?.range
  return range ? linesOf(range, window.innerHeight) : null
})
const draftRect = computed(() => {
  void frame.value
  return draftText.value?.rect ?? draft.value?.rect() ?? null
})
const draftLabel = computed(() =>
  draftRect.value ? (draft.value?.label(draftRect.value) ?? '') : '',
)
/** The target being commented on is rendered: it gets a marking (a closed menu has none). */
const draftShown = computed(() => !!draftRect.value && !notRendered(draftRect.value))

const { chip, chipLine, onRelease, onSelectionChange } = useSelectionChip({
  host: props.host,
  mode,
  draft,
  frame,
})

const { pageItems, placements, pins, outlines, highlight } = usePins({
  collection,
  page,
  filter,
  live,
  frame,
  layout,
  pinsShown,
  hoveredPin,
  highlighted,
  jobs,
  draft,
})

/** The pin being edited, as stored now. */
const editStored = computed(() => {
  const edit = draft.value?.edit
  return edit && collection.value?.items.find((item) => item.id === edit.id)
})
/** The tone of the pin being edited, now: the panel may change it while its popover is open. */
const editStatus = computed((): Tone | undefined => {
  const edit = draft.value?.edit
  if (!edit) return undefined
  return toneOf(editStored.value ?? edit)
})
/** The comment of the pin being edited as stored now: a dictation may fill it meanwhile. */
const editComment = computed(() => {
  const edit = draft.value?.edit
  if (!edit) return undefined
  return editStored.value?.comment ?? edit.comment
})

/** Retry or Dismiss on the open pin's dictation. */
async function jobAction(type: 'dictation:retry' | 'dictation:dismiss') {
  const current = draft.value
  if (!current) return
  const reply = await request({ type, site, id: current.id })
  if (draft.value?.key === current.key && reply && !reply.ok) {
    draft.value = { ...current, error: reply.error }
  }
}

// Another page of a single-page app: its own pins; the chip and highlight belonged to the last.
watch(page, () => {
  chip.value = null
  highlighted.value = null
  notifyPanel()
})

function notifyPanel() {
  const changed: PanelMessage = { type: 'overlay:changed', instance }
  browser.runtime.sendMessage(changed).catch(() => undefined)
}

function showPins(visible: boolean) {
  if (pinsShown.value === visible) return
  pinsShown.value = visible
  // A pin that goes away under the pointer gets no mouseleave.
  hoveredPin.value = null
  notifyPanel()
}

function hover(el: Element | null) {
  path.value = el ? new TargetPath(el, props.host) : null
  hovered.value = el
}

// Also used by hoverLabel above: a computed, first read once the overlay renders.
const { componentOf } = useComponentNames(hovered, mode)

function setMode(next: Mode) {
  if (mode.value === next) return
  mode.value = next
  chip.value = null
  drag.value = null
  pointed = null
  lastPointer = null
  hover(null)
  notifyPanel()
}

/**
 * Lets a script focus trap accept the comment field: the host goes into the container that
 * holds the focus (or the target) while a comment is written.
 */
function containForComment(el: Element) {
  const focused = deepActiveElement(document)
  const trap = (focused && closestOf(focused, TRAP)) ?? closestOf(el, TRAP)
  props.layer.contain(trap)
}

watch(draft, (current, previous) => {
  if (!current && previous) props.layer.contain(null)
})

/** Opens the popover for a new item or an edit. */
function openDraft(next: Omit<Draft, 'key' | 'busy' | 'id'>): number {
  chip.value = null
  containForComment(next.el)
  const key = ++drafts
  // What an earlier popover's dictation said is over.
  voice.clear()
  // A new pin's id is fixed now: storing it twice can only fail, never make two.
  draft.value = { ...next, id: next.edit?.id ?? newId(), key, busy: false }
  return key
}

/**
 * What a new item takes when it is marked: its page, and its code origins, asked for while
 * the comment is written.
 */
function marking(target: Target, elements: Element[]): Pick<Draft, 'origins' | 'marked' | 'page'> {
  return {
    origins: readOrigins(elements, selectorsOf(target)),
    marked: performance.now(),
    page: pageInfo(window),
  }
}

function select(el: Element | null) {
  if (!el) return
  let target: Target
  try {
    target = { kind: 'element', element: snapshotElement(el) }
  } catch {
    return
  }
  const asked = marking(target, [el])
  const key = openDraft({
    kind: 'element',
    ...onElement(el),
    target,
    live: el,
    label: (r) => describe(el, r, componentOf(el)),
    ...asked,
  })
  // The popover names the component once it is known.
  void asked.origins?.then(([origin]) => {
    const component = origin?.chain.at(-1)?.name
    const current = draft.value
    if (component && current?.key === key) {
      draft.value = { ...current, label: (r) => describe(el, r, component) }
    }
  })
}

/** Opens the popover for the area `rect` (viewport coordinates) that was just dragged. */
function selectArea(rect: Rect) {
  let snapshot: ReturnType<typeof snapshotArea>
  try {
    snapshot = snapshotArea(document, rect, props.host)
  } catch {
    return
  }
  const { container, elements, target } = snapshot
  // The area keeps its place inside the container, as its pin will later.
  const at = boxOf(container)
  const dx = rect.x - at.x
  const dy = rect.y - at.y
  openDraft({
    kind: 'area',
    ...onArea(container, dx, dy, rect.width, rect.height),
    target,
    live: container,
    label: labelOf(target, container),
    ...marking(target, [container, ...elements]),
  })
}

/** Short description of an item's target for the popover header, for its box now. */
function labelOf(target: Target, el: Element): (rect: Rect) => string {
  switch (target.kind) {
    case 'element':
      return (r) => describe(el, r)
    case 'text': {
      const quoted = `"${truncate(target.selected, 24)}"`
      return (r) => (notRendered(r) ? `${quoted} · hidden` : quoted)
    }
    case 'area':
      return (r) => `area · ${sizeOf(r)}`
  }
}

/** Opens the popover of an existing item; false when its target is not on the page. */
function openEdit(id: string): boolean {
  const item = pageItems.value.find((i) => i.id === id)
  const placement = placements.value.get(id)
  if (!item || !placement) return false
  const { el, rect, range } = placement
  openDraft({
    kind: item.target.kind,
    el,
    rect,
    range,
    label: labelOf(item.target, el),
    edit: {
      id,
      number: item.number,
      comment: item.comment,
      status: item.status,
      ...(item.draft ? { draft: true as const } : {}),
    },
  })
  return true
}

/**
 * Scrolls to an item and opens its popover. Its own open popover stays as it is; another one
 * closes and keeps what it holds first (a draft, a changed comment, a dictation handed over).
 */
async function reveal(id: string): Promise<'shown' | 'missing' | Reply> {
  if (draft.value?.id === id) {
    placements.value.get(id)?.el.scrollIntoView({ block: 'center', inline: 'nearest' })
    nudge.value++
    return 'shown'
  }
  if (draft.value) {
    const left = await leave()
    if (!left.ok) return left
  }
  const placement = placements.value.get(id)
  if (!placement) return 'missing'
  placement.el.scrollIntoView({ block: 'center', inline: 'nearest' })
  return openEdit(id) ? 'shown' : 'missing'
}

// A reveal that came before its item was placed (the panel jumped to this page): it happens
// once the item is placed, or not at all after REVEAL_WAIT.
let wanted: string | null = null
let wantedTimer: ReturnType<typeof setTimeout> | undefined

/** The panel's click on an entry: refused only when the open popover cannot be kept. */
async function revealSoon(id: string): Promise<Reply> {
  clearTimeout(wantedTimer)
  wanted = null
  const shown = await reveal(id)
  if (typeof shown === 'object') return shown
  if (shown === 'missing') {
    wanted = id
    wantedTimer = setTimeout(() => (wanted = null), REVEAL_WAIT)
  }
  return { ok: true }
}

watch(placements, (placed) => {
  if (!wanted || !placed.has(wanted) || draft.value) return
  const id = wanted
  wanted = null
  clearTimeout(wantedTimer)
  void reveal(id)
})

/** The chip was clicked: comment on the selection it was offered for. */
function commentOnSelection() {
  const offered = chip.value
  chip.value = null
  const range = selectionRange(document)
  // The page may change the selection on the way to the click (`selectionchange` comes
  // later): only what the chip was offered for is captured.
  if (!offered || !range || !sameRange(range, offered.range)) return
  let captured: CapturedText | null
  try {
    captured = snapshotRange(range)
  } catch {
    captured = null
  }
  if (!captured) return
  // What was read: measuring it on every frame stays cheap however much was selected.
  const { target, range: read } = captured
  const placed = onRange(read)
  openDraft({
    kind: 'text',
    ...placed,
    target,
    live: read,
    label: labelOf(target, placed.el),
    ...marking(target, [placed.el]),
  })
}

/**
 * Runs `work` while the open popover shows busy: it closes once that succeeded (`closing` runs
 * first), or says why not (`failed` runs after). A popover opened meanwhile stays as it is.
 */
async function closeAfter(
  current: Draft,
  work: () => Promise<Reply | undefined>,
  { closing, failed }: { closing?: () => void; failed?: () => void } = {},
): Promise<Reply> {
  draft.value = { ...current, busy: true, error: undefined }
  const reply: Reply = (await work()) ?? { ok: false, error: NOT_SAVED }
  if (draft.value?.key !== current.key) return reply
  if (reply.ok) {
    closing?.()
    draft.value = null
  } else {
    draft.value = { ...current, busy: false, error: reply.error }
    failed?.()
  }
  return reply
}

/** Delete or Restore in the popover of an existing item: it closes once the change is saved. */
async function changeStatus(type: 'annotation:remove' | 'annotation:restore') {
  const current = draft.value
  const id = current?.edit?.id
  if (!current || !id || current.busy) return
  voice.cancel()
  await closeAfter(current, () => request({ type, site, id }))
}

function onPinClick(e: MouseEvent, id: string) {
  if (!e.isTrusted) return
  // Its popover is open already: it stays as it is.
  if (draft.value?.id === id) nudge.value++
  else if (!draft.value) openEdit(id)
  else
    void leave().then((left) => {
      if (left.ok && !draft.value) openEdit(id)
    })
}

/** Esc on the page: a drag ends, a dictation ends, then the popover closes and keeps its pin. */
function cancel() {
  if (drag.value) drag.value = null
  else if (voice.active.value) voice.cancel()
  else void leave()
}

/**
 * Stores the open popover's pin (spec section 8). Saved: Save, `Enter` or a dictation's stop,
 * a draft until it has a comment. Kept: `Esc`, X, another pin, Go to, the page going; a new
 * pin is a draft, a pin keeps its status. A new pin waits a moment for its code origins,
 * unless the page goes (`wait` off: the message leaves before anything is awaited).
 */
async function persist(
  current: Draft,
  text: string,
  how: 'save' | 'keep',
  wait = true,
): Promise<Reply> {
  const comment = text.trim()
  const kept = how === 'keep'
  const edit = current.edit
  let message: BackgroundMessage | undefined
  if (edit || current.stored) {
    const before = edit?.comment.trim() ?? ''
    const draftNow = edit ? !!edit.draft : true
    // Nothing changed, or a pin would lose its comment: nothing to store.
    if ((kept && comment === before) || (!draftNow && comment === '')) return { ok: true }
    message = { type: 'annotation:update', site, id: current.id, comment }
    if (kept) message.keep = true
  } else {
    let target = current.target
    if (target && current.origins && wait) {
      const waited = performance.now() - (current.marked ?? 0)
      const origins = await within(current.origins, ORIGIN_WAIT - waited)
      if (origins) target = withOrigins(target, origins)
    }
    message = {
      type: 'annotation:add',
      id: current.id,
      page: current.page ?? pageInfo(window),
      target: target as Target,
      comment,
    }
    if (kept || comment === '') message.draft = true
  }
  const reply = await request(message)
  if (!reply?.ok) return { ok: false, error: reply && !reply.ok ? reply.error : NOT_SAVED }
  if (!edit) {
    current.stored = true
    // The open popover holds a copy of the draft: it is stored now too.
    if (draft.value?.key === current.key) draft.value.stored = true
    if (current.live) live.set(current.id, current.live)
  }
  return { ok: true }
}

/** A dictation records or waits at its limit: what a stop hands over. */
const running = () => voice.recording.value && !voice.holds.value

/** The save (or stop) of the open popover while it is stored, for a leave that comes meanwhile. */
let saving: Promise<Reply> | undefined

/** Keeps `stored` as `saving` until it settles. */
function track(stored: Promise<Reply>): Promise<Reply> {
  saving = stored
  return stored.finally(() => (saving = undefined))
}

/** Save or `Enter`: the pin is saved; a running dictation is stopped first, its text follows. */
async function save(comment: string) {
  if (running()) return void stopDictation()
  const current = draft.value
  if (!current || current.busy) return
  // A microphone that only starts recorded nothing: it goes with the popover.
  voice.cancel()
  await closeAfter(current, () => track(persist(current, comment, 'save')))
}

/**
 * A dictation's stop (spec section 8): the pin is saved, a draft while it has no comment, the
 * recording handed over to the background, and the popover closes. The text follows.
 */
function stopDictation(): Promise<Reply> {
  const current = draft.value
  if (!current || current.busy) return Promise.resolve({ ok: false, error: NOT_SAVED })
  return closeAfter(
    current,
    () => track(persist(current, popover.value?.snapshot() ?? '', 'save')),
    // Only once the pin is stored: its text is filled into it.
    { closing: () => voice.stop({ pin: current.id }) },
  )
}

/** Space, Alt+V, the mic, Retry of a held recording: starts a dictation, or stops it. */
function dictate() {
  const current = draft.value
  if (!current) return
  if (voice.recording.value) return void stopDictation()
  if (jobs.value[current.id]?.state === 'transcribing') return
  voice.start()
}

let leaving: Promise<Reply> | undefined

/**
 * Closes the open popover and keeps what it holds (spec section 8): a new pin as a draft, a
 * changed comment, a dictation handed over. One at a time; refused only when nothing could be
 * stored, and the popover says why.
 */
function leave(): Promise<Reply> {
  const current = draft.value
  if (!current) return Promise.resolve({ ok: true })
  leaving ??= (async (): Promise<Reply> => {
    try {
      // A save on its way: it closes the popover, or says why it could not.
      if (saving) {
        const saved = await saving.catch((): Reply => ({ ok: false, error: NOT_SAVED }))
        if (draft.value?.key !== current.key) return saved
      }
      if (running()) return await stopDictation()
      // A starting microphone recorded nothing; a held recording goes out on Retry only.
      voice.cancel()
      return await closeAfter(
        current,
        () => persist(current, popover.value?.snapshot() ?? '', 'keep'),
        { failed: () => nudge.value++ },
      )
    } finally {
      leaving = undefined
    }
  })()
  return leaving
}

/** Delete on a new pin: it was never stored, and goes with what it recorded. */
function discard() {
  voice.cancel()
  draft.value = null
}

/**
 * The page goes (reload, navigation, the tab closing): the open popover is kept now, without
 * waiting for anything, and its recording handed over. A page kept for Back closes it.
 */
function onPageHide(e: PageTransitionEvent) {
  const current = draft.value
  if (!current) return
  const text = popover.value?.snapshot() ?? ''
  if (running()) {
    void persist(current, text, 'save', false)
    voice.stop({ pin: current.id })
  } else {
    voice.cancel()
    // A save on its way stays one: its pin is not made a draft by the page going.
    void persist(current, text, saving ? 'save' : 'keep', false)
  }
  if (e.persisted) draft.value = null
}

/** Hovers the element at a viewport point; only a new element resets a path walked with ↑/↓. */
function pointAt(x: number, y: number) {
  lastPointer = { x, y }
  const el = pickAt(document, x, y, props.host)
  if (el === pointed) return
  pointed = el
  hover(el)
}

function onPointerMove(e: PointerEvent) {
  if (!e.isTrusted || draft.value) return
  if (mode.value === 'element') pointAt(e.clientX, e.clientY)
  else if (drag.value) drag.value = { ...drag.value, to: { x: e.clientX, y: e.clientY } }
}

/** Area mode: a primary button press on the glass starts a rectangle. */
function onPointerDown(e: PointerEvent) {
  if (!e.isTrusted || mode.value !== 'area' || draft.value || e.button !== 0) return
  const at = { x: e.clientX, y: e.clientY }
  drag.value = { from: at, to: at }
  // Keeps the drag going when the pointer leaves the window.
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
}

function onPointerUp(e: PointerEvent) {
  const current = drag.value
  if (!e.isTrusted || !current) return
  drag.value = null
  const rect = rectBetween(current.from, { x: e.clientX, y: e.clientY })
  if (rect.width >= MIN_AREA && rect.height >= MIN_AREA) selectArea(rect)
}

// Scrolling and layout changes move elements under a pointer that stands still.
watch(frame, () => {
  if (mode.value === 'element' && !draft.value && lastPointer) {
    pointAt(lastPointer.x, lastPointer.y)
  }
})

function onGlassClick(e: MouseEvent) {
  e.preventDefault()
  if (!e.isTrusted || draft.value || mode.value !== 'element') return
  pointAt(e.clientX, e.clientY)
  select(path.value?.current ?? null)
}

/**
 * The glass takes the pointer: the browser scrolls the document under it by itself, but no
 * scroll container. Those are scrolled from here, at once and by the whole turn: with the
 * page's smooth scrolling, each turn would start from where the last one is and lose distance.
 */
function onWheel(e: WheelEvent) {
  if (!e.isTrusted || !forwardsWheel(e)) return
  const vertical = Math.abs(e.deltaY) >= Math.abs(e.deltaX)
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
  const under = pickAt(document, e.clientX, e.clientY, props.host)
  const target = wheelTarget(under, vertical, (vertical ? e.deltaY : e.deltaX) * unit)
  if (target === 'page') return
  e.preventDefault()
  target?.scrollBy({ left: e.deltaX * unit, top: e.deltaY * unit, behavior: 'instant' })
}

function onKeydown(e: KeyboardEvent) {
  // This capture-phase listener also sees keys on their way into the overlay (the target is
  // then the host); those belong to the comment field.
  if (e.target === props.host) return
  // A key for the page while a comment is open: a focus trap took the focus. Enter and
  // Space would trigger the page's focused control; keep them away from it.
  const current = draft.value
  if (current && e.isTrusted && (e.key === 'Enter' || e.key === ' ') && !e.isComposing) {
    e.preventDefault()
    e.stopImmediatePropagation()
    draft.value = { ...current, error: FOCUS_TAKEN }
    return
  }
  const action = pageShortcut(e, {
    mode: mode.value,
    hovering: path.value !== null,
    drafting: draft.value !== null,
    dragging: drag.value !== null,
    editableFocus: isEditable(deepActiveElement(document)),
  })
  if (!action) return
  e.preventDefault()
  e.stopImmediatePropagation()
  const walk = path.value
  if (typeof action === 'object') setMode(action.mode)
  else if (action === 'pins') showPins(!pinsShown.value)
  else if (action === 'cancel') cancel()
  else if (walk && action === 'up') hovered.value = walk.up()
  else if (walk && action === 'down') hovered.value = walk.down()
  else if (walk && action === 'select') select(walk.current)
}

const status = (): OverlayStatus => ({
  instance,
  host: location.host || location.protocol.replace(':', ''),
  pageKey: page.value,
  pins: pinsShown.value,
  mode: mode.value,
})

const onMessage: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (
  message,
  sender,
  sendResponse,
) => {
  if (sender.id !== browser.runtime.id || !isOverlayMessage(message)) return
  switch (message.type) {
    case 'overlay:status':
      sendResponse(status())
      return
    case 'overlay:set-mode':
      setMode(message.mode)
      sendResponse({ ok: true } satisfies Reply)
      return
    case 'overlay:set-pins':
      showPins(message.visible)
      sendResponse({ ok: true } satisfies Reply)
      return
    case 'overlay:highlight':
      highlighted.value = message.id
      sendResponse({ ok: true } satisfies Reply)
      return
    case 'overlay:reveal':
      void revealSoon(message.id).then(sendResponse)
      return true
    case 'overlay:leave':
      // Go to: the open popover is kept first; the page stays only when it cannot be.
      void leave().then(sendResponse)
      return true
  }
}

const { panels, onConnect } = usePanelLines({ hoveredPin, draft, highlighted, setMode })

// Ctrl+drag (⌘+drag on macOS) selects text in Browse mode, also in a link, while the panel is
// open; the page keeps its Ctrl+click otherwise (spec section 8).
const linkSelect = createLinkSelect(pageSelectSurface(document, props.host), {
  host: props.host,
  mac: isMacPlatform(),
  active: () => mode.value === 'browse' && panels.size > 0,
  editable: (target) => isEditable(target instanceof Element ? target : null),
})

const RELEASES = ['pointerup', 'mouseup', 'keyup'] as const
// Removes the listeners on the window and the document together; the page's scripts cannot
// reach it from their world.
const listeners = new AbortController()

onMounted(() => {
  const { signal } = listeners
  // Capture phase on window: before the page's own bubble-phase shortcut handlers.
  window.addEventListener('keydown', onKeydown, { capture: true, signal })
  window.addEventListener('pagehide', onPageHide, { signal })
  for (const type of RELEASES) window.addEventListener(type, onRelease, { capture: true, signal })
  window.addEventListener('mousedown', linkSelect.down, { capture: true, signal })
  window.addEventListener('mousemove', linkSelect.move, { capture: true, signal })
  window.addEventListener('mouseup', linkSelect.up, { capture: true, signal })
  window.addEventListener('blur', linkSelect.up, { signal })
  window.addEventListener('click', linkSelect.click, { capture: true, signal })
  document.addEventListener('selectionchange', onSelectionChange, { signal })
  browser.runtime.onMessage.addListener(onMessage)
  browser.runtime.onConnect.addListener(onConnect)
  notifyPanel()
})

onBeforeUnmount(() => {
  stopView()
  clearTimeout(wantedTimer)
  listeners.abort()
  stopJobs()
  browser.runtime.onMessage.removeListener(onMessage)
  browser.runtime.onConnect.removeListener(onConnect)
})
</script>

<template>
  <!-- Every positioned layer has the maximum z-index: pages use it too. -->
  <div data-testid="overlay-root" class="font-sans text-sm text-foreground">
    <div
      v-if="mode === 'element' || mode === 'area'"
      data-testid="overlay-glass"
      class="fixed inset-0 z-[2147483647] cursor-crosshair"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @lostpointercapture="drag = null"
      @mousedown.prevent
      @click="onGlassClick"
      @wheel="onWheel"
      @contextmenu.prevent
    />
    <div
      v-for="outline in outlines"
      :key="outline.id"
      data-testid="overlay-outline"
      :data-strong="outline.strong"
      class="pointer-events-none fixed top-0 left-0 z-[2147483647] rounded-[3px] will-change-transform"
      :class="[outline.dashed ? 'border-dashed' : 'border-solid', outline.tone]"
      :style="outline.style"
    />
    <HoverBox v-if="hoverRect" :rect="hoverRect" :label="hoverLabel" />
    <HoverBox
      v-if="highlight && !draft"
      :rect="highlight.rect"
      :label="highlight.label"
      :status="highlight.status"
      testid="overlay-highlight"
    />
    <button
      v-for="pin in pins"
      :key="pin.id"
      type="button"
      data-testid="overlay-pin"
      class="fixed z-[2147483647] flex size-5 items-center justify-center rounded-full text-xs leading-none font-semibold text-white shadow-md ring-2 ring-white"
      :class="[pin.tone, pin.transcribing && 'animate-pulse motion-reduce:animate-none']"
      :data-transcribing="pin.transcribing ? '' : undefined"
      :style="{ left: pin.left, top: pin.top }"
      :aria-label="`Edit pin ${pin.number}`"
      @pointerup="onRelease"
      @mouseenter="hoveredPin = pin.id"
      @mouseleave="hoveredPin = null"
      @click="onPinClick($event, pin.id)"
    >
      {{ pin.number }}
    </button>
    <TextHighlight v-if="draftText" :boxes="draftText.lines" :status="editStatus" />
    <HoverBox
      v-else-if="draftRect && draftShown"
      :rect="draftRect"
      :tone="draft?.kind === 'area' ? 'area' : 'selected'"
      :status="editStatus"
    />
    <HoverBox
      v-if="dragRect"
      :rect="dragRect"
      :label="`${Math.round(dragRect.width)}×${Math.round(dragRect.height)}`"
      tone="area"
      testid="overlay-area"
    />
    <SelectionChip
      v-if="chipLine"
      :line="chipLine"
      @comment="commentOnSelection"
      @obscured="props.layer.raise()"
    />
    <CommentPopover
      v-if="draft && draftRect"
      ref="popover"
      :key="draft.key"
      :rect="draftRect"
      :label="draftLabel"
      :initial="editComment"
      :number="draft.edit?.number"
      :status="draft.edit?.status"
      :draft="editStatus === 'draft'"
      :busy="draft.busy"
      :error="draft.error"
      :frame="frame"
      :nudge="nudge"
      :voice="voice.state.value"
      :clock="voice.clock.value"
      :job="jobs[draft.id]"
      @save="save"
      @close="leave"
      @discard="discard"
      @remove="changeStatus('annotation:remove')"
      @restore="changeStatus('annotation:restore')"
      @dictate="dictate"
      @voice-cancel="voice.cancel()"
      @resume="voice.resume()"
      @job-retry="jobAction('dictation:retry')"
      @job-dismiss="jobAction('dictation:dismiss')"
      @obscured="props.layer.raise()"
    />
  </div>
</template>
