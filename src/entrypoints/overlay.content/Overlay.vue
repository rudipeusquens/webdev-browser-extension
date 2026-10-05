<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowReactive, shallowRef, watch } from 'vue'
import { browser } from 'wxt/browser'
import { useCollection } from '@/composables/use-collection'
import { closestOf, tagOf } from '@/lib/capture/dom'
import { snapshotArea } from '@/lib/capture/area'
import { pageInfo, snapshotElement } from '@/lib/capture/snapshot'
import { rangeContainer, rangeHasText, selectionRange, snapshotRange } from '@/lib/capture/text'
import type { Rect, Target } from '@/lib/collection/model'
import { pageKey } from '@/lib/collection/page-key'
import { truncate } from '@/lib/text'
import {
  type BackgroundMessage,
  isOverlayMessage,
  type Mode,
  type OverlayStatus,
  type Reply,
} from '@/lib/messages'
import CommentPopover from './CommentPopover.vue'
import HoverBox from './HoverBox.vue'
import { newId } from './ids'
import { pageShortcut } from './keys'
import {
  deepActiveElement,
  forwardsWheel,
  isEditable,
  pickAt,
  scrollableAncestor,
  TargetPath,
} from './picker'
import { boxOf, type LiveAnchor, pinPositions, placeItems, pruneLive } from './pins'
import type { Layer } from './top-layer'
import { rectBetween } from './place'
import SelectionChip from './SelectionChip.vue'
import TextHighlight from './TextHighlight.vue'
import { useTracking } from './use-tracking'

const props = defineProps<{ host: HTMLElement; layer: Layer }>()

// Containers that script focus traps (Radix, reka-ui, focus-trap) usually guard.
const TRAP = '[aria-modal="true"], [role="dialog"], [role="alertdialog"]'
const FOCUS_TAKEN = 'This page took the focus. Click into the comment field to continue.'
/** Smaller drags are clicks, not areas. */
const MIN_AREA = 4

interface Draft {
  key: number
  kind: Target['kind']
  /** The element that holds the target: focus traps are looked for around it. */
  el: Element
  /** The target's box in viewport coordinates, now. */
  rect: () => Rect
  /** A selected text, drawn line by line. */
  range?: Range
  label: string
  busy: boolean
  error?: string
  /** A new item: taken when it was marked, what was true at that moment. */
  target?: Target
  /** What to remember for a new item once it is saved: more precise than its selector. */
  live?: LiveAnchor
  /** An existing item being edited. */
  edit?: { id: string; number: number; comment: string }
}

const mode = ref<Mode>('browse')
const path = shallowRef<TargetPath | null>(null)
const hovered = shallowRef<Element | null>(null)
const draft = shallowRef<Draft | null>(null)
const highlighted = ref<string | null>(null)
// The page's selection the Comment chip offers to comment on (browse mode).
const chip = shallowRef<Range | null>(null)
// The rectangle being dragged in area mode, in viewport coordinates.
const drag = shallowRef<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(
  null,
)
const frame = useTracking()
const { collection } = useCollection()
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

const describe = (el: Element, r: Rect) =>
  `${tagOf(el)} · ${Math.round(r.width)}×${Math.round(r.height)}`

const hoverRect = computed(() =>
  hovered.value && mode.value === 'element' && !draft.value ? rectOf(hovered.value) : null,
)
const hoverLabel = computed(() =>
  hovered.value && hoverRect.value ? describe(hovered.value, hoverRect.value) : '',
)
const dragRect = computed(() => drag.value && rectBetween(drag.value.from, drag.value.to))
const draftRect = computed(() => {
  void frame.value
  return draft.value?.rect() ?? null
})
const chipLine = computed(() => {
  void frame.value
  const range = chip.value
  if (!range || mode.value !== 'browse' || draft.value) return null
  const lines = range.getClientRects()
  const last = lines[lines.length - 1] ?? range.getBoundingClientRect()
  return { x: last.x, y: last.y, width: last.width, height: last.height }
})

const pageItems = computed(() =>
  collection.value.items.filter((item) => item.pageKey === pageKey(location.href)),
)
const placements = computed(() => {
  // Again after DOM changes: an element may have been replaced.
  void frame.value
  return placeItems(pageItems.value, live, document)
})
const pins = computed(() => {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const numbers = new Map(pageItems.value.map((item) => [item.id, item.number]))
  const onPage = pageItems.value.flatMap((item) => {
    const placement = placements.value.get(item.id)
    return placement ? [{ id: item.id, rect: placement.rect() }] : []
  })
  return pinPositions(onPage, viewport).map(({ id, x, y }) => ({
    id,
    number: numbers.get(id),
    left: `${x}px`,
    top: `${y}px`,
  }))
})
const highlight = computed(() => {
  const item = pageItems.value.find((i) => i.id === highlighted.value)
  const placement = item && placements.value.get(item.id)
  return item && placement ? { rect: placement.rect(), label: `Item ${item.number}` } : null
})

watch(collection, (current) => pruneLive(live, current.items))

function notifyPanel() {
  browser.runtime.sendMessage({ type: 'overlay:changed' }).catch(() => undefined)
}

function hover(el: Element | null) {
  path.value = el ? new TargetPath(el, props.host) : null
  hovered.value = el
}

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
function openDraft(next: Omit<Draft, 'key' | 'busy'>) {
  chip.value = null
  containForComment(next.el)
  draft.value = { ...next, key: ++drafts, busy: false }
}

function select(el: Element | null) {
  if (!el) return
  let target: Target
  try {
    target = { kind: 'element', element: snapshotElement(el) }
  } catch {
    return
  }
  openDraft({
    kind: 'element',
    el,
    rect: () => boxOf(el),
    target,
    live: el,
    label: describe(el, boxOf(el)),
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
  const { container, target } = snapshot
  // The area keeps its place inside the container, as its pin will later.
  const at = boxOf(container)
  const dx = rect.x - at.x
  const dy = rect.y - at.y
  openDraft({
    kind: 'area',
    el: container,
    rect: () => {
      const box = boxOf(container)
      return { x: box.x + dx, y: box.y + dy, width: rect.width, height: rect.height }
    },
    target,
    live: container,
    label: labelOf(target, container, rect),
  })
}

/** Short description of an item's target for the popover header. */
function labelOf(target: Target, el: Element, rect: Rect): string {
  switch (target.kind) {
    case 'element':
      return describe(el, rect)
    case 'text':
      return `"${truncate(target.selected, 24)}"`
    case 'area':
      return `area · ${Math.round(rect.width)}×${Math.round(rect.height)}`
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
    label: labelOf(item.target, el, rect()),
    edit: { id, number: item.number, comment: item.comment },
  })
  return true
}

function reveal(id: string): boolean {
  const placement = placements.value.get(id)
  if (!placement) return false
  placement.el.scrollIntoView({ block: 'center', inline: 'nearest' })
  return openEdit(id)
}

/**
 * Offers the chip for the page's selection after the user let go of the mouse or a key: a
 * selection the page makes by script gets none. The check waits a frame, until the
 * selection has settled.
 */
function onRelease(e: Event) {
  if (!e.isTrusted || e.target === props.host || mode.value !== 'browse' || draft.value) return
  cancelAnimationFrame(chipCheck)
  chipCheck = requestAnimationFrame(() => {
    const range = selectionRange(document)
    chip.value = range && rangeHasText(range) ? range : null
  })
}

/** Hides the chip as soon as the selection it was offered for changes. */
function onSelectionChange() {
  const offered = chip.value
  if (!offered) return
  const current = selectionRange(document)
  try {
    if (
      current &&
      current.compareBoundaryPoints(Range.START_TO_START, offered) === 0 &&
      current.compareBoundaryPoints(Range.END_TO_END, offered) === 0
    ) {
      return
    }
  } catch {
    // Ranges in different trees: not the same selection.
  }
  chip.value = null
}

/** The chip was clicked: comment on what is selected now. */
function commentOnSelection() {
  chip.value = null
  const range = selectionRange(document)
  if (!range) return
  let target: Target | null
  try {
    target = snapshotRange(range)
  } catch {
    target = null
  }
  if (!target) return
  const rect = () => {
    const r = range.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }
  openDraft({
    kind: 'text',
    el: rangeContainer(range),
    rect,
    range,
    target,
    live: range,
    label: labelOf(target, rangeContainer(range), rect()),
  })
}

function onPinClick(e: MouseEvent, id: string) {
  if (e.isTrusted) openEdit(id)
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
  const message: BackgroundMessage = current.edit
    ? { type: 'annotation:update', id, comment }
    : {
        type: 'annotation:add',
        id,
        page: pageInfo(window),
        target: current.target as Target,
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

function onWheel(e: WheelEvent) {
  if (!e.isTrusted || !forwardsWheel(e)) return
  // The glass takes the pointer, so scroll what lies under it ourselves.
  const vertical = Math.abs(e.deltaY) >= Math.abs(e.deltaX)
  const target = scrollableAncestor(pickAt(document, e.clientX, e.clientY, props.host), vertical)
  if (!target) return
  e.preventDefault()
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
  target.scrollBy({ left: e.deltaX * unit, top: e.deltaY * unit })
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
  else if (action === 'cancel') cancel()
  else if (walk && action === 'up') hovered.value = walk.up()
  else if (walk && action === 'down') hovered.value = walk.down()
  else if (walk && action === 'select') select(walk.current)
}

const status = (): OverlayStatus => ({
  host: location.host || location.protocol.replace(':', ''),
  pageKey: pageKey(location.href),
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
    case 'overlay:highlight':
      highlighted.value = message.id
      sendResponse({ ok: true } satisfies Reply)
      return
    case 'overlay:reveal':
      sendResponse(
        (reveal(message.id)
          ? { ok: true }
          : { ok: false, error: 'Not found on this page.' }) satisfies Reply,
      )
      return
  }
}

const RELEASES = ['pointerup', 'mouseup', 'keyup'] as const

onMounted(() => {
  // Capture phase on window: before the page's own bubble-phase shortcut handlers.
  window.addEventListener('keydown', onKeydown, true)
  for (const type of RELEASES) window.addEventListener(type, onRelease, true)
  document.addEventListener('selectionchange', onSelectionChange)
  browser.runtime.onMessage.addListener(onMessage)
  notifyPanel()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  for (const type of RELEASES) window.removeEventListener(type, onRelease, true)
  document.removeEventListener('selectionchange', onSelectionChange)
  cancelAnimationFrame(chipCheck)
  browser.runtime.onMessage.removeListener(onMessage)
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
    <HoverBox v-if="hoverRect" :rect="hoverRect" :label="hoverLabel" />
    <HoverBox
      v-if="highlight && !draft"
      :rect="highlight.rect"
      :label="highlight.label"
      testid="overlay-highlight"
    />
    <button
      v-for="pin in pins"
      :key="pin.id"
      type="button"
      data-testid="overlay-pin"
      class="fixed z-[2147483647] flex size-5 items-center justify-center rounded-full bg-blue-600 text-xs leading-none font-semibold text-white shadow-md ring-2 ring-white"
      :style="{ left: pin.left, top: pin.top }"
      :aria-label="`Edit item ${pin.number}`"
      @click="onPinClick($event, pin.id)"
    >
      {{ pin.number }}
    </button>
    <TextHighlight v-if="draft?.range" :range="draft.range" :frame="frame" />
    <HoverBox
      v-else-if="draftRect"
      :rect="draftRect"
      :tone="draft?.kind === 'area' ? 'area' : 'selected'"
    />
    <HoverBox
      v-if="dragRect"
      :rect="dragRect"
      :label="`${Math.round(dragRect.width)}×${Math.round(dragRect.height)}`"
      tone="area"
      testid="overlay-area"
    />
    <SelectionChip v-if="chipLine" :line="chipLine" @comment="commentOnSelection" />
    <CommentPopover
      v-if="draft && draftRect"
      :key="draft.key"
      :rect="draftRect"
      :label="draft.label"
      :initial="draft.edit?.comment"
      :number="draft.edit?.number"
      :busy="draft.busy"
      :error="draft.error"
      :frame="frame"
      @save="save"
      @cancel="cancel"
    />
  </div>
</template>
