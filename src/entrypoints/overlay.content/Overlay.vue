<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowReactive, shallowRef, watch } from 'vue'
import { browser } from 'wxt/browser'
import { useCollection } from '@/composables/use-collection'
import { pageInfo, snapshotElement } from '@/lib/capture/snapshot'
import type { ElementSnapshot, Rect } from '@/lib/collection/model'
import { pageKey } from '@/lib/collection/page-key'
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
import { deepActiveElement, isEditable, pickAt, scrollableAncestor, TargetPath } from './picker'
import { pinPosition, resolveTargets } from './pins'
import { useTracking } from './use-tracking'

const props = defineProps<{ host: HTMLElement }>()

interface Draft {
  key: number
  el: Element
  label: string
  busy: boolean
  error?: string
  /** A new item: taken when the element was picked, what was true at the moment of marking. */
  snapshot?: ElementSnapshot
  /** An existing item being edited. */
  edit?: { id: string; number: number; comment: string }
}

const mode = ref<Mode>('browse')
const path = shallowRef<TargetPath | null>(null)
const hovered = shallowRef<Element | null>(null)
const draft = shallowRef<Draft | null>(null)
const highlighted = ref<string | null>(null)
const frame = useTracking()
const { collection } = useCollection()
// Elements marked in this session, by item id: more precise than the stored selector.
const live = shallowReactive(new Map<string, Element>())
let pointed: Element | null = null
let lastPointer: { x: number; y: number } | null = null
let drafts = 0

function rectOf(el: Element): Rect {
  void frame.value
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

const describe = (el: Element, r: Rect) =>
  `${el.localName} · ${Math.round(r.width)}×${Math.round(r.height)}`

const hoverRect = computed(() =>
  hovered.value && mode.value === 'element' && !draft.value ? rectOf(hovered.value) : null,
)
const hoverLabel = computed(() =>
  hovered.value && hoverRect.value ? describe(hovered.value, hoverRect.value) : '',
)
const draftRect = computed(() => (draft.value ? rectOf(draft.value.el) : null))

const pageItems = computed(() =>
  collection.value.items.filter((item) => item.pageKey === pageKey(location.href)),
)
const targets = computed(() => {
  // Re-resolve after DOM changes: an element may have been replaced.
  void frame.value
  return resolveTargets(pageItems.value, live, document)
})
const pins = computed(() => {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  return pageItems.value.flatMap((item) => {
    const el = targets.value.get(item.id)
    const at = el && pinPosition(rectOf(el), viewport)
    return at ? [{ id: item.id, number: item.number, left: `${at.x}px`, top: `${at.y}px` }] : []
  })
})
const highlight = computed(() => {
  const item = pageItems.value.find((i) => i.id === highlighted.value)
  const el = item && targets.value.get(item.id)
  return item && el ? { rect: rectOf(el), label: `Item ${item.number}` } : null
})

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
  pointed = null
  lastPointer = null
  hover(null)
  notifyPanel()
}

function select(el: Element | null) {
  if (!el) return
  let snapshot: ElementSnapshot
  try {
    snapshot = snapshotElement(el)
  } catch {
    return
  }
  draft.value = { key: ++drafts, el, snapshot, label: describe(el, rectOf(el)), busy: false }
}

/** Opens the popover of an existing item; false when its element is not on the page. */
function openEdit(id: string): boolean {
  const item = pageItems.value.find((i) => i.id === id)
  const el = targets.value.get(id)
  if (!item || !el) return false
  const edit = { id, number: item.number, comment: item.comment }
  draft.value = { key: ++drafts, el, label: describe(el, rectOf(el)), busy: false, edit }
  return true
}

function reveal(id: string): boolean {
  const el = targets.value.get(id)
  if (!el) return false
  el.scrollIntoView({ block: 'center', inline: 'nearest' })
  return openEdit(id)
}

function onPinClick(e: MouseEvent, id: string) {
  if (e.isTrusted) openEdit(id)
}

function cancel() {
  draft.value = null
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
        target: { kind: 'element', element: current.snapshot as ElementSnapshot },
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
    if (!current.edit) live.set(id, current.el)
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
  if (e.isTrusted && !draft.value) pointAt(e.clientX, e.clientY)
}

// Scrolling and layout changes move elements under a pointer that stands still.
watch(frame, () => {
  if (mode.value === 'element' && !draft.value && lastPointer) {
    pointAt(lastPointer.x, lastPointer.y)
  }
})

function onGlassClick(e: MouseEvent) {
  e.preventDefault()
  if (!e.isTrusted || draft.value) return
  pointAt(e.clientX, e.clientY)
  select(path.value?.current ?? null)
}

function onWheel(e: WheelEvent) {
  if (!e.isTrusted) return
  // The glass takes the pointer, so scroll what lies under it ourselves.
  const vertical = Math.abs(e.deltaY) >= Math.abs(e.deltaX)
  const target = scrollableAncestor(pickAt(document, e.clientX, e.clientY, props.host), vertical)
  if (!target) return
  e.preventDefault()
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
  target.scrollBy({ left: e.deltaX * unit, top: e.deltaY * unit })
}

function onKeydown(e: KeyboardEvent) {
  const action = pageShortcut(e, {
    mode: mode.value,
    hovering: path.value !== null,
    drafting: draft.value !== null,
    editableFocus: isEditable(deepActiveElement(document)),
  })
  if (!action) return
  e.preventDefault()
  e.stopImmediatePropagation()
  const current = path.value
  if (typeof action === 'object') setMode(action.mode)
  else if (action === 'cancel') cancel()
  else if (current && action === 'up') hovered.value = current.up()
  else if (current && action === 'down') hovered.value = current.down()
  else if (current && action === 'select') select(current.current)
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

onMounted(() => {
  // Capture phase on window: before the page's own bubble-phase shortcut handlers.
  window.addEventListener('keydown', onKeydown, true)
  browser.runtime.onMessage.addListener(onMessage)
  notifyPanel()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  browser.runtime.onMessage.removeListener(onMessage)
})
</script>

<template>
  <!-- Every positioned layer has the maximum z-index: pages use it too. -->
  <div data-testid="overlay-root" class="font-sans text-sm text-foreground">
    <div
      v-if="mode === 'element'"
      data-testid="overlay-glass"
      class="fixed inset-0 z-[2147483647] cursor-crosshair"
      @pointermove="onPointerMove"
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
    <HoverBox v-if="draftRect" :rect="draftRect" tone="selected" />
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
