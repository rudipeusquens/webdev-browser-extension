<script setup lang="ts">
import { ArchiveRestoreIcon, LoaderCircleIcon, Trash2Icon, XIcon } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { browser } from 'wxt/browser'
import { Button } from '@/components/ui/button'
import type { Rect, Status } from '@/lib/collection/model'
import type { BackgroundMessage, VoiceReadyReply } from '@/lib/messages'
import { currentPlatform, isMacPlatform } from '@/lib/shortcuts'
import type { JobView } from '@/lib/voice/jobs'
import { dictationFailure, type RecordingState } from '@/lib/voice/protocol'
import { CommentGuard } from './comment-guard'
import { popoverKey, spaceKey } from './keys'
import { placeNear } from './place'
import { fieldState, putBack, useFieldSelection } from './use-field-selection'
import { useUnobscured } from './use-unobscured'
import VoiceButton from './VoiceButton.vue'

// The comment popover (spec section 8). It holds the text being written; the overlay holds the
// dictation and stores the pin: the popover asks for both with its events, and the overlay
// reads its text with `snapshot()` when it closes or stops a dictation.

const props = defineProps<{
  /** The target in viewport coordinates. */
  rect: Rect
  /** Short description of the target, e.g. `button · 160×48`. */
  label: string
  /** The comment as stored now; it follows the pin while the field holds no edit of its own. */
  initial?: string
  /** Set when an existing item is edited. */
  number?: number
  /** The status of an existing item: Delete, or Restore for a deleted one. */
  status?: Status
  /** The pin was never saved: grey, and left out of Copy as prompt. */
  draft?: boolean
  error?: string
  busy?: boolean
  /** Changes whenever positions may have changed (see use-tracking.ts). */
  frame?: number
  /** Changes when the field should take the focus again. */
  nudge?: number
  /** The overlay's dictation, and its clock. */
  voice: RecordingState
  clock: string
  /** The pin's last dictation, while it is transcribed, failed or was cut. */
  job?: JobView
}>()

const emit = defineEmits<{
  /** Save or Enter; a running dictation is stopped first, its text follows. */
  save: [comment: string]
  /** Esc or X: closes and keeps the pin as it is (a draft, or the changed comment). */
  close: []
  /** Delete on a new pin: it was never stored and goes. */
  discard: []
  remove: []
  restore: []
  /** Starts a dictation, or stops it (Space, Alt+V, the mic, Stop, Retry of a held one). */
  dictate: []
  /** Esc while a dictation records: it ends, nothing is sent. */
  'voice-cancel': []
  /** Keep at the limit: the recording goes on. */
  resume: []
  /** Retry or Dismiss on the pin's failed or cut dictation. */
  'job-retry': []
  'job-dismiss': []
  /** A click was held back because something of the page lies over the popover. */
  obscured: []
}>()

const guard = new CommentGuard(props.initial ?? '')
const mac = isMacPlatform(currentPlatform())
const selection = useFieldSelection(guard, mac)
const text = ref(guard.verified)
const warning = ref('')
const card = useTemplateRef<HTMLElement>('card')
const field = useTemplateRef<HTMLTextAreaElement>('field')
const size = ref({ width: 288, height: 180 })
/** A key is saved: Space may start a dictation. */
const ready = ref(false)

const recording = computed(
  () => props.voice.state === 'recording' || props.voice.state === 'paused',
)
const voiceBusy = computed(() => recording.value || props.voice.state === 'starting')
/** A recording that ended by itself, held until Retry sends it or Esc drops it. */
const holds = computed(() => {
  const now = props.voice
  return now.state === 'failed' && now.error === 'mic-lost' && now.retry
})
const transcribing = computed(() => props.job?.state === 'transcribing')
// A dictation's stop saves too: its text follows.
const canSave = computed(
  () => (text.value.trim() !== '' || recording.value) && !props.busy && !transcribing.value,
)
const micState = computed(() => (transcribing.value ? 'transcribing' : props.voice.state))
/** What screen readers hear: changes of the dictation, not every second of its clock. */
const spoken = computed(() => {
  if (props.voice.state === 'recording') return 'Recording. Alt+V stops it.'
  if (props.voice.state === 'paused') return 'Recording paused at the limit. Keep recording?'
  if (transcribing.value) return 'Transcribing.'
  return ''
})
const failure = computed(() => dictationFailure(props.voice))
const jobFailure = computed(() => (props.job ? dictationFailure(props.job) : null))

/** Focuses the field with the selection the user left in it. */
function focusField() {
  const el = field.value
  if (!el) return
  el.focus({ preventScroll: true })
  // A page's focus listener may have moved it.
  putBack(el, guard.selection)
}

watch(() => props.nudge, focusField)

// A dictation filled the pin meanwhile: the field follows. An edit of its own keeps, and gets
// what the dictation appended after it, so storing the field later loses neither.
watch(
  () => props.initial,
  (now, before) => {
    if (now === undefined || now === before) return
    const was = before ?? ''
    let next: string
    if (text.value === was) next = now
    else if (now.startsWith(was)) next = text.value + now.slice(was.length)
    else return
    const el = field.value
    text.value = next
    if (el) el.value = next
    guard.accept(next, next.length)
  },
)

const position = computed(() => {
  void props.frame
  const { x, y } = placeNear(props.rect, size.value, {
    width: window.innerWidth,
    height: window.innerHeight,
  })
  return { left: `${x}px`, top: `${y}px` }
})

/** Puts the user's own text back after the page edited the field. */
function restore(el: HTMLTextAreaElement) {
  el.value = guard.verified
  putBack(el, guard.selection)
  text.value = guard.verified
  warning.value = 'This page tried to change your comment. Your text was restored.'
}

// The edit is announced for the selection the user made; put back if the page moved it.
function onBeforeInput(e: Event) {
  const el = e.target as HTMLTextAreaElement
  const edit = e as InputEvent
  // A selection set while an input method writes would end what it writes.
  if (!edit.isComposing) selection.settle(el)
  const moved = guard.beforeInput(edit, fieldState(el))
  if (!edit.isComposing) putBack(el, moved)
}

function onCompositionStart(e: CompositionEvent) {
  const el = e.target as HTMLTextAreaElement
  selection.settle(el)
  putBack(el, guard.compositionStart(e, fieldState(el)))
}

function onFieldPointer(e: PointerEvent) {
  selection.pointerdown(e, e.target as HTMLTextAreaElement)
}

function onInput(e: Event) {
  const el = e.target as HTMLTextAreaElement
  if (guard.input(e as InputEvent, el.value)) text.value = el.value
  else restore(el)
}

/** The user's text as it stands: what a page changed is put back first. */
function snapshot(): string {
  const el = field.value
  if (el && !guard.matches(el.value)) restore(el)
  return guard.verified
}

defineExpose({ snapshot })

// Sent inside the trusted click: the background may open the panel only within it.
function ask(message: BackgroundMessage) {
  browser.runtime.sendMessage(message).catch(() => undefined)
}

function save() {
  const comment = snapshot().trim()
  if (canSave.value) emit('save', comment)
}

function onKeydown(e: KeyboardEvent) {
  const el = field.value
  if (el && e.target === el) {
    selection.keydown(e, el)
    const space = spaceKey(e, {
      empty: el.value.trim() === '',
      ready: ready.value,
      recording: recording.value,
      starting: props.voice.state === 'starting',
      blocked: transcribing.value || el.readOnly,
    })
    if (space) {
      e.preventDefault()
      if (space === 'dictate') emit('dictate')
      return
    }
  }
  const action = popoverKey(e)
  // Enter saves from the field; on a focused button it presses that button.
  if (!action || (action === 'save' && e.target !== el)) return
  e.preventDefault()
  if (action === 'save') save()
  else if (action === 'voice') {
    if (!transcribing.value) emit('dictate')
  }
  // Escape ends a running dictation first, then closes and keeps the pin.
  else if (voiceBusy.value || holds.value) emit('voice-cancel')
  else emit('close')
}

// Covered: the overlay puts itself on top again, at most once a second (top-layer.ts).
const unobscured = useUnobscured(card, () => emit('obscured'))
const COVERED = 'Something on this page covers the overlay. Try again in a moment.'
watch(unobscured, (now) => {
  if (now && warning.value === COVERED) warning.value = ''
})

/** A button acts on a trusted click once the popover was seen with nothing over it. */
function onButton(e: MouseEvent, action: () => void) {
  if (!e.isTrusted) return
  if (!unobscured.value) {
    warning.value = COVERED
    emit('obscured')
    return
  }
  action()
  // The focus goes back to the field, not to the page, where Escape closes the comment.
  focusField()
}

function measure() {
  if (card.value) size.value = { width: card.value.offsetWidth, height: card.value.offsetHeight }
}

// The card grows with the comment, a warning or an error: placed again, Save stays visible.
const resizes = new ResizeObserver(measure)

onMounted(async () => {
  // Only whether a key is saved: the key itself never reaches the page's world.
  void browser.runtime
    .sendMessage({ type: 'voice:ready' } satisfies BackgroundMessage)
    .then((reply: VoiceReadyReply | undefined) => (ready.value = reply?.ready === true))
    .catch(() => undefined)
  await nextTick()
  measure()
  if (card.value) resizes.observe(card.value)
  const el = field.value
  if (!el) return
  el.focus({ preventScroll: true })
  // The caret at the end, set after the focus: a page's focus listener may have moved it.
  selection.set(el, el.value.length)
})

onBeforeUnmount(() => {
  resizes.disconnect()
  selection.stop()
})
</script>

<template>
  <div
    ref="card"
    data-testid="overlay-popover"
    :data-covered="unobscured ? undefined : ''"
    :data-voice-ready="ready ? '' : undefined"
    role="dialog"
    :aria-label="number ? `Edit pin ${number}` : 'New pin'"
    class="fixed z-[2147483647] flex w-72 flex-col gap-2 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
    :style="position"
    @keydown="onKeydown"
  >
    <div class="flex items-center justify-between gap-2">
      <!-- The label cuts itself: an ellipsis takes the color of the element that cuts. -->
      <p class="flex min-w-0 items-baseline gap-1 font-medium">
        <span class="shrink-0">{{ number ? `Pin ${number}` : 'New pin' }}</span>
        <span v-if="draft" class="shrink-0 font-normal text-muted-foreground">· Draft</span>
        <span class="min-w-0 truncate font-mono text-xs font-normal text-muted-foreground">{{
          label
        }}</span>
      </p>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Close"
        title="Close, keeping the pin (Esc)"
        @click="onButton($event, () => emit('close'))"
      >
        <XIcon class="size-4" />
      </Button>
    </div>
    <!-- Not v-model: every edit goes through the guard first. -->
    <textarea
      ref="field"
      data-testid="overlay-comment"
      rows="3"
      placeholder="What should change? Space dictates."
      :value="text"
      :readonly="transcribing"
      class="field-sizing-content max-h-48 min-h-16 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground read-only:opacity-60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      @pointerdown="onFieldPointer"
      @beforeinput="onBeforeInput"
      @input="onInput"
      @compositionstart="onCompositionStart"
      @compositionend="guard.compositionEnd($event)"
    />
    <p
      v-if="warning"
      data-testid="overlay-warning"
      class="text-xs text-amber-700 dark:text-amber-400"
      role="alert"
    >
      {{ warning }}
    </p>
    <p v-if="error" class="text-xs text-destructive" role="alert">{{ error }}</p>
    <div
      v-if="voice.state === 'paused'"
      data-testid="overlay-voice-limit"
      class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
      role="alert"
    >
      <span class="min-w-0 flex-1 basis-40">Paused at {{ clock }}. Keep recording?</span>
      <Button
        data-testid="overlay-voice-keep"
        variant="outline"
        size="xs"
        @click="onButton($event, () => emit('resume'))"
      >
        Keep
      </Button>
      <Button
        data-testid="overlay-voice-stop"
        variant="outline"
        size="xs"
        @click="onButton($event, () => emit('dictate'))"
      >
        Stop
      </Button>
    </div>
    <div
      v-for="shown in [failure, jobFailure].filter((f) => f !== null)"
      :key="shown.text"
      data-testid="overlay-voice-message"
      class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-destructive"
      role="alert"
    >
      <span class="min-w-0 flex-1 basis-40">{{ shown.text }}</span>
      <Button
        v-if="shown.grant"
        data-testid="overlay-voice-grant"
        variant="outline"
        size="xs"
        @click="onButton($event, () => ask({ type: 'voice:grant' }))"
      >
        Grant
      </Button>
      <Button
        v-if="shown.settings"
        data-testid="overlay-voice-settings"
        variant="outline"
        size="xs"
        @click="onButton($event, () => ask({ type: 'voice:settings' }))"
      >
        Open settings
      </Button>
      <Button
        v-if="shown.retry"
        data-testid="overlay-voice-retry"
        variant="outline"
        size="xs"
        @click="onButton($event, () => (shown === failure ? emit('dictate') : emit('job-retry')))"
      >
        Retry
      </Button>
      <Button
        v-if="shown === jobFailure"
        data-testid="overlay-voice-dismiss"
        variant="outline"
        size="xs"
        @click="onButton($event, () => emit('job-dismiss'))"
      >
        Dismiss
      </Button>
    </div>
    <div
      v-if="job?.state === 'cut'"
      data-testid="overlay-voice-notice"
      class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
      role="status"
    >
      <span class="min-w-0 flex-1 basis-40">
        The dictation was too long for a pin: the full text is in Rec.
      </span>
      <Button
        data-testid="overlay-voice-dismiss"
        variant="outline"
        size="xs"
        @click="onButton($event, () => emit('job-dismiss'))"
      >
        Dismiss
      </Button>
    </div>
    <div class="flex items-center justify-between gap-2">
      <Button
        v-if="status !== 'deleted' && !voiceBusy"
        data-testid="overlay-delete"
        variant="ghost"
        size="sm"
        class="-ml-2 text-muted-foreground hover:text-destructive"
        :aria-label="number ? `Delete pin ${number}` : 'Delete this new pin'"
        @click="onButton($event, () => (number ? emit('remove') : emit('discard')))"
      >
        <Trash2Icon /> Delete
      </Button>
      <Button
        v-else-if="number && status === 'deleted' && !voiceBusy"
        data-testid="overlay-restore"
        variant="ghost"
        size="sm"
        class="-ml-2 text-muted-foreground"
        :aria-label="`Restore pin ${number}`"
        @click="onButton($event, () => emit('restore'))"
      >
        <ArchiveRestoreIcon /> Restore
      </Button>
      <p
        data-testid="overlay-voice-status"
        class="flex min-w-0 flex-1 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground"
      >
        <template v-if="voice.state === 'recording'">
          <span class="size-2 shrink-0 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
          <span class="font-medium text-foreground tabular-nums">{{ clock }}</span>
          <span class="truncate">· {{ text.trim() === '' ? 'Space' : 'Alt+V' }} to stop</span>
        </template>
        <template v-else-if="transcribing">
          <LoaderCircleIcon class="size-3 shrink-0 animate-spin" aria-hidden="true" />
          Transcribing…
        </template>
        <template v-else-if="voice.state === 'starting'"> Starting the microphone… </template>
      </p>
      <span class="sr-only" role="status" aria-live="polite">{{ spoken }}</span>
      <div class="flex shrink-0 items-center gap-1.5">
        <VoiceButton
          data-testid="overlay-mic"
          :state="micState"
          @click="onButton($event, () => !transcribing && emit('dictate'))"
        />
        <Button
          data-testid="overlay-save"
          size="sm"
          :disabled="!canSave"
          @click="onButton($event, save)"
        >
          Save
        </Button>
      </div>
    </div>
  </div>
</template>
