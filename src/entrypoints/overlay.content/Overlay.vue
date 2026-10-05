<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { browser } from 'wxt/browser'
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
import { useTracking } from './use-tracking'

const props = defineProps<{ host: HTMLElement }>()

interface Draft {
  key: number
  el: Element
  /** Taken when the element was picked: what was true at the moment of marking. */
  snapshot: ElementSnapshot
  label: string
  busy: boolean
  error?: string
}

const mode = ref<Mode>('browse')
const path = shallowRef<TargetPath | null>(null)
const hovered = shallowRef<Element | null>(null)
const draft = shallowRef<Draft | null>(null)
const frame = useTracking()
let pointed: Element | null = null
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

function cancel() {
  draft.value = null
}

async function save(comment: string) {
  const current = draft.value
  if (!current || current.busy) return
  draft.value = { ...current, busy: true, error: undefined }
  const message: BackgroundMessage = {
    type: 'annotation:add',
    id: newId(),
    page: pageInfo(window),
    target: { kind: 'element', element: current.snapshot },
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
    draft.value = null
    return
  }
  const error = reply && !reply.ok ? reply.error : 'Could not save. Reload the page and try again.'
  draft.value = { ...current, busy: false, error }
}

function onPointerMove(e: PointerEvent) {
  if (!e.isTrusted || draft.value) return
  const el = pickAt(document, e.clientX, e.clientY, props.host)
  // Only a new element under the pointer resets a path walked with ↑/↓.
  if (el === pointed) return
  pointed = el
  hover(el)
}

function onGlassClick(e: MouseEvent) {
  e.preventDefault()
  if (!e.isTrusted || draft.value) return
  select(path.value?.current ?? pickAt(document, e.clientX, e.clientY, props.host))
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
    <HoverBox v-if="draftRect" :rect="draftRect" tone="selected" />
    <CommentPopover
      v-if="draft && draftRect"
      :key="draft.key"
      :rect="draftRect"
      :label="draft.label"
      :busy="draft.busy"
      :error="draft.error"
      :frame="frame"
      @save="save"
      @cancel="cancel"
    />
  </div>
</template>
