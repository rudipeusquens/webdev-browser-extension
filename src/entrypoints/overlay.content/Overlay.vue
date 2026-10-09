<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowReactive, shallowRef, watch } from 'vue'
import { browser, type Browser } from 'wxt/browser'
import { useSiteCollection } from '@/composables/use-site-collection'
import { closestOf, deepActiveElement, queryFirst, tagOf } from '@/lib/capture/dom'
import { findText } from '@/lib/capture/find-text'
import { snapshotArea } from '@/lib/capture/area'
import { buildSelector } from '@/lib/capture/selector'
import { pageInfo, snapshotElement } from '@/lib/capture/snapshot'
import {
  type CapturedText,
  chipAnchor,
  firstShownCharacter,
  rangeContainer,
  sameRange,
  selectionRange,
  snapshotRange,
} from '@/lib/capture/text'
import type { PageInfo, Rect, Status, Target } from '@/lib/collection/model'
import { siteOf } from '@/lib/collection/site'
import { STATUS_BADGE, type Tone, toneOf } from '@/lib/status'
import { type Filter, loadView, shows, watchView } from '@/lib/view'
import { truncate } from '@/lib/text'
import {
  type BackgroundMessage,
  isOverlayMessage,
  isPanelAway,
  type Mode,
  type OverlayStatus,
  type PanelMessage,
  type PinsPointed,
  type Reply,
  UNSAVED_PIN,
} from '@/lib/messages'
import { createAnchorStatus } from './anchor-status'
import CommentPopover from './CommentPopover.vue'
import HoverBox from './HoverBox.vue'
import { newId } from '@/lib/ids'
import { type Origins, readOrigins, sourcesOf, within, withOrigins } from './origins'
import { pageShortcut } from './keys'
import { forwardsWheel, isEditable, pickAt, TargetPath, wheelTarget } from './picker'
import {
  areaIn,
  boxOf,
  clippersOf,
  inBounds,
  isLiveRange,
  type LiveAnchor,
  linesOf,
  notRendered,
  outlineBox,
  pinPositions,
  placeItems,
  pruneLive,
  visibleBounds,
} from './pins'
import type { Layer } from './top-layer'
import { rectBetween } from './place'
import SelectionChip from './SelectionChip.vue'
import TextHighlight from './TextHighlight.vue'
import { usePage } from './use-page'
import { createTextMarks, type Marks, pageSurface } from './text-marks'
import { useTracking } from './use-tracking'

const props = defineProps<{ host: HTMLElement; layer: Layer }>()

// Containers that script focus traps (Radix, reka-ui, focus-trap) usually guard.
const TRAP = '[aria-modal="true"], [role="dialog"], [role="alertdialog"]'
const FOCUS_TAKEN = 'This page took the focus. Click into the comment field to continue.'
/** What the popover says when a click asks for another one while it holds unsaved text. */
const KEEP_DRAFT = 'Save or cancel this pin first.'
/** Smaller drags are clicks, not areas. */
const MIN_AREA = 4
/**
 * How long after marking a save waits for the code origins: the background gives the page
 * 1.5 s to answer, this leaves room for the messages around it.
 */
const ORIGIN_WAIT = 2000
/** How long the pointer rests on an element before its component is looked up. */
const HOVER_DWELL = 150
/** Text items are searched again at most this often while the page changes. */
const REANCHOR_EVERY = 300
/** How long a reveal waits for its item to be placed: the page may still be loading. */
const REVEAL_WAIT = 3000

interface Draft {
  key: number
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
// Whether the open popover holds something closing it would lose (the popover says so), and a
// counter that gives its field the focus again.
const unsaved = ref(false)
const nudge = ref(0)
const highlighted = ref<string | null>(null)
// The panel or the P key can hide the pins, until they show them again or the overlay
// restarts.
const pinsShown = ref(true)
// The page's selection the Pin chip offers to pin (browse mode), the character the chip sits
// under, and the first one the selection shows.
const chip = shallowRef<{ range: Range; anchor: Range; start: Range | null } | null>(null)
// The rectangle being dragged in area mode, in viewport coordinates.
const drag = shallowRef<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(
  null,
)
const { frame, layout } = useTracking()
const { key: page } = usePage()
// The site of this page: a single-page app stays on it while it navigates.
const site = siteOf(location.href)
const { collection } = useSiteCollection(ref(site))
// The panel's filter: which items have pins (spec section 8).
const filter = ref<Filter>('open')
let filterChanged = false
const stopView = watchView((view) => {
  filterChanged = true
  filter.value = view.filter
})
void loadView().then((view) => {
  if (!filterChanged) filter.value = view.filter
})
// What was marked in this session, by item id: more precise than the stored selector.
const live = shallowReactive(new Map<string, LiveAnchor>())
let pointed: Element | null = null
let lastPointer: { x: number; y: number } | null = null
let drafts = 0
let chipCheck = 0

function rectOf(el: Element): Rect {
  void frame.value
  return boxOf(el)
}

/** A box's size, or "hidden" for a target that is not rendered (a closed menu). */
const sizeOf = (r: Rect) =>
  notRendered(r) ? 'hidden' : `${Math.round(r.width)}×${Math.round(r.height)}`

const describe = (el: Element, r: Rect, component?: string | null) =>
  [tagOf(el), component, sizeOf(r)].filter(Boolean).join(' · ')

// The innermost component of elements looked up while hovering, for the label. A WeakMap is
// not reactive: `componentsSeen` changes whenever an entry is added.
const components = new WeakMap<Element, string | null>()
const componentsSeen = ref(0)
let hoverTimer: ReturnType<typeof setTimeout> | undefined
let askingComponent = false

function componentOf(el: Element): string | null | undefined {
  void componentsSeen.value
  return components.get(el)
}

/** Looks up the component of the element the pointer rests on; one lookup at a time. */
async function askComponent(el: Element) {
  if (askingComponent || components.has(el)) return
  askingComponent = true
  try {
    const [origin] = await readOrigins({ elements: [el], selectors: [buildSelector(el)] })
    components.set(el, origin?.chain.at(-1)?.name ?? null)
    componentsSeen.value++
  } catch {
    components.set(el, null)
  } finally {
    askingComponent = false
  }
  // The pointer moved on meanwhile.
  const now = hovered.value
  if (now && now !== el && mode.value === 'element') void askComponent(now)
}

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
// The scroll containers and clipping boxes around the chip's selection: looked up once per
// selection, measured on every frame.
const chipClippers = computed(() => {
  const anchor = chip.value?.anchor
  return anchor ? clippersOf(rangeContainer(anchor), true) : []
})
const chipLine = computed(() => {
  void frame.value
  const anchor = chip.value?.anchor
  if (!anchor || mode.value !== 'browse' || draft.value) return null
  const r = anchor.getBoundingClientRect()
  const line = { x: r.x, y: r.y, width: r.width, height: r.height }
  // The page hid the selection's end (a menu closed): it would sit in the corner.
  if (notRendered(line)) return null
  // From the first character to the last: a long selection keeps its chip at the edge while
  // any of it is in view.
  const s = chip.value?.start?.getBoundingClientRect() ?? r
  const x = Math.min(r.x, s.x)
  const y = Math.min(r.y, s.y)
  const span = {
    x,
    y,
    width: Math.max(r.right, s.right) - x,
    height: Math.max(r.bottom, s.bottom) - y,
  }
  const viewport = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
  // Scrolled out of view or out of its box: no chip, until the selection is back.
  const bounds = visibleBounds(chipClippers.value, viewport)
  return bounds && inBounds(span, bounds) ? line : null
})

/** The items of this page that the filter shows: only they are placed and pinned. */
const pageItems = computed(() =>
  (collection.value?.items ?? []).filter(
    (item) => item.pageKey === page.value && shows(item, filter.value),
  ),
)
const placements = computed(() => {
  // Again after DOM changes, not on every scroll: an element may have been replaced.
  void layout.value
  return placeItems(pageItems.value, live, document)
})
// The scroll containers and clipping boxes around each target: looked up with the
// placements, measured on every frame.
const clippers = computed(() => {
  const found = new Map<string, Element[]>()
  for (const [id, placement] of placements.value) {
    // A selection lies in its element's content: that element's own scrolling clips it.
    found.set(id, clippersOf(placement.el, !!placement.range))
  }
  return found
})
// The pin whose outline is drawn stronger: the pointer rests on it.
const hoveredPin = ref<string | null>(null)
/** The page's placed items while pins are shown, with where each can be seen, now. */
const shown = computed(() => {
  void frame.value
  if (!pinsShown.value) return []
  const viewport = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
  return pageItems.value.flatMap((item) => {
    const placement = placements.value.get(item.id)
    if (!placement) return []
    const bounds = visibleBounds(clippers.value.get(item.id) ?? [], viewport)
    return [{ item, rect: placement.rect(), bounds }]
  })
})
const pins = computed(() => {
  const items = new Map(pageItems.value.map((item) => [item.id, item]))
  const onPage = shown.value.map(({ item, rect, bounds }) => ({ id: item.id, rect, bounds }))
  return pinPositions(onPage).map(({ id, x, y }) => ({
    id,
    number: items.get(id)?.number,
    tone: STATUS_BADGE[toneOf(items.get(id) ?? { status: 'open' })],
    left: `${x}px`,
    top: `${y}px`,
  }))
})
/** Outline colors by tone: drawn fully while its pin is hovered. */
const OUTLINE: Record<Tone, { normal: string; strong: string }> = {
  open: { normal: 'border-blue-600/70', strong: 'border-blue-600' },
  done: { normal: 'border-green-700/70', strong: 'border-green-700' },
  deleted: { normal: 'border-red-600/70', strong: 'border-red-600' },
  draft: { normal: 'border-zinc-500/70', strong: 'border-zinc-500' },
}
// A pin that goes away under the pointer (hidden, scrolled out of its box) gets no mouseleave.
watch(pins, (current) => {
  if (hoveredPin.value && !current.some((pin) => pin.id === hoveredPin.value)) {
    hoveredPin.value = null
  }
})

/**
 * The line around each pinned element or area. Texts are shaded by the browser instead
 * (text-marks.ts). The item being edited has the popover's own marking.
 */
const outlines = computed(() => {
  const editing = draft.value?.edit?.id
  return shown.value.flatMap(({ item, rect, bounds }) => {
    if (item.id === editing || !bounds || item.target.kind === 'text') return []
    const strong = item.id === hoveredPin.value
    const box = outlineBox(rect, bounds)
    if (!box) return []
    const side = (on: boolean) => (on ? '2px' : '0')
    // Moved by its transform: scrolling does not make the browser draw the line again.
    const style = {
      transform: `translate(${box.x}px, ${box.y}px)`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      borderTopWidth: side(box.sides.top),
      borderRightWidth: side(box.sides.right),
      borderBottomWidth: side(box.sides.bottom),
      borderLeftWidth: side(box.sides.left),
    }
    const tone = OUTLINE[toneOf(item)][strong ? 'strong' : 'normal']
    return [{ id: item.id, strong, tone, dashed: item.target.kind === 'area', style }]
  })
})
/** The tone of the pin being edited, now: the panel may change it while its popover is open. */
const editStatus = computed((): Tone | undefined => {
  const edit = draft.value?.edit
  if (!edit) return undefined
  return toneOf(collection.value?.items.find((item) => item.id === edit.id) ?? edit)
})
const highlight = computed(() => {
  void frame.value
  const item = pageItems.value.find((i) => i.id === highlighted.value)
  const placement = item && placements.value.get(item.id)
  const rect = placement?.rect()
  // A target without a box (not rendered) has nothing to outline.
  if (!item || !rect || rect.width === 0 || rect.height === 0) return null
  return { rect, label: `Pin ${item.number}`, status: toneOf(item) }
})

// Pinned texts are shaded by the browser: set again when what is pinned, hovered or edited
// changes (a text found again changes the placements), never while the page scrolls.
const textMarks = createTextMarks(pageSurface(document))
watch(
  [placements, pinsShown, hoveredPin, () => draft.value?.edit?.id],
  () => {
    const marks: Marks = {}
    const editing = draft.value?.edit?.id
    if (pinsShown.value) {
      for (const item of pageItems.value) {
        const range = placements.value.get(item.id)?.range
        // A text not found again has its pin at its container, and no shading.
        if (!range || item.id === editing) continue
        const tone = (marks[toneOf(item)] ??= { normal: [], strong: [] })
        ;(item.id === hoveredPin.value ? tone.strong : tone.normal).push(range)
      }
    }
    textMarks.set(marks)
  },
  { immediate: true },
)

watch(collection, (current) => pruneLive(live, current?.items ?? []))

// Text items without a selection from this session are found again by their text: at once
// when the page's items change (mount, another page), so the pin does not jump from the
// container to the text; while the page changes, at most every REANCHOR_EVERY ms, so a page
// that changes all the time does not keep the overlay searching.
let reanchorTimer: ReturnType<typeof setTimeout> | undefined
function reanchorTexts() {
  for (const item of pageItems.value) {
    const { target } = item
    if (target.kind !== 'text' || isLiveRange(live.get(item.id))) continue
    const container = queryFirst(document, target.container.selector)
    if (!container) continue
    try {
      const range = findText(container, target)
      if (range) live.set(item.id, range)
    } catch {
      // A page in the middle of re-rendering: the next layout change tries again.
    }
  }
}
watch(pageItems, reanchorTexts, { immediate: true })
watch(layout, () => {
  reanchorTimer ??= setTimeout(() => {
    reanchorTimer = undefined
    reanchorTexts()
  }, REANCHOR_EVERY)
})

// Found and missing items of this page, for the panel's mark and the prompt.
const anchors = createAnchorStatus((report) => {
  browser.runtime.sendMessage({ type: 'anchors:report', ...report }).catch(() => undefined)
})
watch(placements, (placed) => {
  const ids = pageItems.value.map((item) => item.id)
  anchors.update(
    page.value,
    ids.filter((id) => placed.has(id)),
    ids.filter((id) => !placed.has(id)),
  )
})

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

watch(hovered, (el) => {
  clearTimeout(hoverTimer)
  if (el && mode.value === 'element' && !components.has(el)) {
    hoverTimer = setTimeout(() => void askComponent(el), HOVER_DWELL)
  }
})

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
  if (!current) unsaved.value = false
})

/**
 * Keeps the open popover while it holds unsaved text: it says why and takes the focus. Only
 * `Esc`, Cancel or Save close it then. True when it stays.
 */
function keepsDraft(): boolean {
  const current = draft.value
  if (!current || !unsaved.value) return false
  draft.value = { ...current, error: KEEP_DRAFT }
  nudge.value++
  return true
}

/** Opens the popover for a new item or an edit. */
function openDraft(next: Omit<Draft, 'key' | 'busy'>): number {
  chip.value = null
  containForComment(next.el)
  const key = ++drafts
  unsaved.value = false
  draft.value = { ...next, key, busy: false }
  return key
}

/**
 * What a new item takes when it is marked: its page, and its code origins, asked for while
 * the comment is written.
 */
function marking(target: Target, elements: Element[]): Pick<Draft, 'origins' | 'marked' | 'page'> {
  return {
    origins: readOrigins(sourcesOf(target, elements)),
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
    el,
    rect: () => boxOf(el),
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
    el: container,
    rect: () => areaIn(boxOf(container), dx, dy, rect.width, rect.height),
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
 * stays while it holds unsaved text ('kept').
 */
function reveal(id: string): 'shown' | 'kept' | 'missing' {
  const placement = placements.value.get(id)
  if (draft.value?.edit?.id === id) {
    placement?.el.scrollIntoView({ block: 'center', inline: 'nearest' })
    nudge.value++
    return 'shown'
  }
  if (keepsDraft()) return 'kept'
  if (!placement) return 'missing'
  placement.el.scrollIntoView({ block: 'center', inline: 'nearest' })
  return openEdit(id) ? 'shown' : 'missing'
}

// A reveal that came before its item was placed (the panel jumped to this page): it happens
// once the item is placed, or not at all after REVEAL_WAIT.
let wanted: string | null = null
let wantedTimer: ReturnType<typeof setTimeout> | undefined

/** The panel's click on an entry: refused only while the open popover holds unsaved text. */
function revealSoon(id: string): Reply {
  clearTimeout(wantedTimer)
  wanted = null
  const shown = reveal(id)
  if (shown === 'kept') return { ok: false, error: UNSAVED_PIN }
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
  reveal(id)
})

/**
 * Offers the chip for the page's selection after the user let go of the mouse or a key: a
 * selection the page makes by script gets none. The check waits a frame, until the
 * selection has settled. Releases inside the overlay reach the window as the host's and are
 * not checked, except over a pin (its own listener): a selection dragged onto a pin.
 */
function onRelease(e: Event) {
  if (!e.isTrusted || e.target === props.host || mode.value !== 'browse' || draft.value) return
  cancelAnimationFrame(chipCheck)
  chipCheck = requestAnimationFrame(() => {
    const range = selectionRange(document)
    const anchor = range && chipAnchor(range)
    chip.value = range && anchor ? { range, anchor, start: firstShownCharacter(range) } : null
  })
}

/** Hides the chip as soon as the selection it was offered for changes. */
function onSelectionChange() {
  const offered = chip.value
  if (!offered) return
  const current = selectionRange(document)
  if (!current || !sameRange(current, offered.range)) chip.value = null
}

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
  const el = rangeContainer(read)
  const rect = () => {
    const r = read.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }
  openDraft({
    kind: 'text',
    el,
    rect,
    range: read,
    target,
    live: read,
    label: labelOf(target, el),
    ...marking(target, [el]),
  })
}

/** Delete or Restore in the popover of an existing item: it closes once the change is saved. */
async function changeStatus(type: 'annotation:remove' | 'annotation:restore') {
  const current = draft.value
  const id = current?.edit?.id
  if (!current || !id || current.busy) return
  draft.value = { ...current, busy: true, error: undefined }
  const message: BackgroundMessage = { type, site, id }
  let reply: Reply | undefined
  try {
    reply = (await browser.runtime.sendMessage(message)) as Reply | undefined
  } catch {
    reply = undefined
  }
  if (draft.value?.key !== current.key) return
  if (reply?.ok) {
    draft.value = null
    return
  }
  const error = reply && !reply.ok ? reply.error : 'Could not save. Reload the page and try again.'
  draft.value = { ...current, busy: false, error }
}

function onPinClick(e: MouseEvent, id: string) {
  if (!e.isTrusted) return
  // Its popover is open already: it stays as it is.
  if (draft.value?.edit?.id === id) nudge.value++
  else if (!keepsDraft()) openEdit(id)
}

function cancel() {
  if (drag.value) drag.value = null
  else draft.value = null
}

async function save(comment: string) {
  const current = draft.value
  if (!current || current.busy) return
  draft.value = { ...current, busy: true, error: undefined }
  const id = current.edit?.id ?? newId()
  let target = current.target
  if (target && current.origins) {
    const waited = performance.now() - (current.marked ?? 0)
    const origins = await within(current.origins, ORIGIN_WAIT - waited)
    if (draft.value?.key !== current.key) return
    if (origins) target = withOrigins(target, origins)
  }
  const message: BackgroundMessage = current.edit
    ? { type: 'annotation:update', site, id, comment }
    : {
        type: 'annotation:add',
        id,
        page: current.page ?? pageInfo(window),
        target: target as Target,
        comment,
      }
  let reply: Reply | undefined
  try {
    reply = (await browser.runtime.sendMessage(message)) as Reply | undefined
  } catch {
    reply = undefined
  }
  if (draft.value?.key !== current.key) return
  if (reply?.ok) {
    if (!current.edit && current.live) live.set(id, current.live)
    draft.value = null
    return
  }
  const error = reply && !reply.ok ? reply.error : 'Could not save. Reload the page and try again.'
  draft.value = { ...current, busy: false, error }
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
      sendResponse(revealSoon(message.id))
      return
    case 'overlay:leave':
      // Go to: the page stays while the open popover holds unsaved text.
      sendResponse(
        (keepsDraft() ? { ok: false, error: UNSAVED_PIN } : { ok: true }) satisfies Reply,
      )
      return
  }
}

/**
 * The panel keeps a line open to every overlay it has shown. When it moves to another tab, its
 * highlight goes; when it closes, the line goes and the page is left to work normally (spec
 * section 8).
 */
const panels = new Set<Browser.runtime.Port>()

/** What the pins point at, by id only: the panel marks the entries (spec section 8). */
function pointedNow(): PinsPointed {
  return {
    type: 'pins:pointed',
    hovered: hoveredPin.value,
    open: draft.value?.edit?.id ?? null,
    popover: draft.value !== null,
  }
}

function tellPanels(message: PinsPointed) {
  for (const port of panels) {
    try {
      port.postMessage(message)
    } catch {
      panels.delete(port)
    }
  }
}

watch([hoveredPin, () => draft.value?.edit?.id ?? null, () => draft.value !== null], () =>
  tellPanels(pointedNow()),
)

const onConnect: Parameters<typeof browser.runtime.onConnect.addListener>[0] = (port) => {
  if (port.name !== 'panel' || port.sender?.id !== browser.runtime.id) return
  panels.add(port)
  port.onMessage.addListener((message) => {
    if (isPanelAway(message)) highlighted.value = null
  })
  port.onDisconnect.addListener(() => {
    panels.delete(port)
    highlighted.value = null
    setMode('browse')
  })
  const now = pointedNow()
  if (now.hovered || now.open || now.popover) tellPanels(now)
}

const RELEASES = ['pointerup', 'mouseup', 'keyup'] as const

onMounted(() => {
  // Capture phase on window: before the page's own bubble-phase shortcut handlers.
  window.addEventListener('keydown', onKeydown, true)
  for (const type of RELEASES) window.addEventListener(type, onRelease, true)
  document.addEventListener('selectionchange', onSelectionChange)
  browser.runtime.onMessage.addListener(onMessage)
  browser.runtime.onConnect.addListener(onConnect)
  notifyPanel()
})

onBeforeUnmount(() => {
  stopView()
  clearTimeout(wantedTimer)
  textMarks.stop()
  clearTimeout(hoverTimer)
  clearTimeout(reanchorTimer)
  anchors.stop()
  window.removeEventListener('keydown', onKeydown, true)
  for (const type of RELEASES) window.removeEventListener(type, onRelease, true)
  document.removeEventListener('selectionchange', onSelectionChange)
  cancelAnimationFrame(chipCheck)
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
    <template v-for="outline in outlines" :key="outline.id">
      <div
        data-testid="overlay-outline"
        :data-strong="outline.strong"
        class="pointer-events-none fixed top-0 left-0 z-[2147483647] rounded-[3px] will-change-transform"
        :class="[outline.dashed ? 'border-dashed' : 'border-solid', outline.tone]"
        :style="outline.style"
      />
    </template>
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
      :class="pin.tone"
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
      :key="draft.key"
      :rect="draftRect"
      :label="draftLabel"
      :initial="draft.edit?.comment"
      :number="draft.edit?.number"
      :status="draft.edit?.status"
      :busy="draft.busy"
      :error="draft.error"
      :frame="frame"
      :nudge="nudge"
      @save="save"
      @cancel="cancel"
      @remove="changeStatus('annotation:remove')"
      @restore="changeStatus('annotation:restore')"
      @unsaved="unsaved = $event"
      @obscured="props.layer.raise()"
    />
  </div>
</template>
