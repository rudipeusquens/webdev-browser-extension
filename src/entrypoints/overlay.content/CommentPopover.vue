<script setup lang="ts">
import { ArchiveRestoreIcon, LoaderCircleIcon, Trash2Icon, XIcon } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { browser } from 'wxt/browser'
import { Button } from '@/components/ui/button'
import { LIMITS, type Rect, type Status } from '@/lib/collection/model'
import type { BackgroundMessage } from '@/lib/messages'
import { currentPlatform, isMacPlatform, panelKey } from '@/lib/shortcuts'
import { voiceErrorText } from '@/lib/voice/protocol'
import { CommentGuard } from './comment-guard'
import { popoverKey } from './keys'
import { placeNear } from './place'
import { insertTranscript } from './transcript'
import { useUnobscured } from './use-unobscured'
import { useVoice } from './use-voice'
import VoiceButton from './VoiceButton.vue'

const props = defineProps<{
  /** The target in viewport coordinates. */
  rect: Rect
  /** Short description of the target, e.g. `button · 160×48`. */
  label: string
  initial?: string
  /** Set when an existing item is edited. */
  number?: number
  /** The status of an existing item: Delete, or Restore for a deleted one. */
  status?: Status
  error?: string
  busy?: boolean
  /** Changes whenever positions may have changed (see use-tracking.ts). */
  frame?: number
  /** Changes when the overlay keeps this popover open for its unsaved text: the field takes the focus. */
  nudge?: number
}>()

const emit = defineEmits<{
  save: [comment: string]
  cancel: []
  remove: []
  restore: []
  /** Whether closing now would lose something: a changed comment, or a dictation. */
  unsaved: [unsaved: boolean]
  /** A click was held back because something of the page lies over the popover. */
  obscured: []
}>()

const guard = new CommentGuard(props.initial ?? '')
const text = ref(guard.verified)
const warning = ref('')
const card = useTemplateRef<HTMLElement>('card')
const field = useTemplateRef<HTMLTextAreaElement>('field')
const size = ref({ width: 288, height: 180 })

const voice = useVoice()
/** What the last dictation needs to say besides its text. */
const notice = ref('')

// Save waits for a running dictation: its text would otherwise be lost.
const canSave = computed(() => text.value.trim() !== '' && !props.busy && !voice.busy.value)
const clock = computed(() => {
  const s = voice.seconds.value
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})
/** What screen readers hear: changes of the dictation, not every second of its clock. */
const spoken = computed(() => {
  const now = voice.state.value.state
  if (now === 'recording') return 'Recording. Alt+V stops it.'
  if (now === 'transcribing') return 'Transcribing.'
  return ''
})
const failure = computed(() => {
  const now = voice.state.value
  if (now.state !== 'failed') return null
  return {
    text: voiceErrorText(now.error, now.detail),
    retry: now.retry,
    grant: now.error === 'mic-not-granted' || now.error === 'mic-blocked',
    // A refused request is most often a model OpenRouter does not know.
    settings: now.error === 'no-key' || now.error === 'invalid-key' || now.error === 'rejected',
  }
})
// Spaces at the ends are not saved, so they change nothing.
const unsaved = computed(() => {
  const now = voice.state.value
  const held = now.state === 'failed' && now.retry
  return text.value.trim() !== (props.initial ?? '').trim() || voice.busy.value || held
})
watch(unsaved, (now) => emit('unsaved', now), { immediate: true })
watch(
  () => props.nudge,
  () => field.value?.focus({ preventScroll: true }),
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
  text.value = guard.verified
  warning.value = 'This page tried to change your comment. Your text was restored.'
}

function onBeforeInput(e: Event) {
  const el = e.target as HTMLTextAreaElement
  guard.beforeInput(e as InputEvent, {
    value: el.value,
    start: el.selectionStart,
    end: el.selectionEnd,
  })
}

function onInput(e: Event) {
  const el = e.target as HTMLTextAreaElement
  if (guard.input(e as InputEvent, el.value)) text.value = el.value
  else restore(el)
}

/**
 * The field before and after the last dictation, while nothing else changed it: Ctrl+Z (⌘Z)
 * takes the dictated text out, Ctrl+Shift+Z puts it back. The text is set as a whole, not as
 * an edit of the field: a page sees the input events of edits, and would read what was
 * dictated. So the browser's own undo does not know it.
 */
let dictated: { before: string; after: string; from: number; caret: number } | null = null
const mac = isMacPlatform(currentPlatform())

/** Sets the field to `value` as the overlay's own edit, with the caret at `caret`. */
function setText(el: HTMLTextAreaElement, value: string, caret: number) {
  el.value = value
  guard.accept(value)
  text.value = value
  el.setSelectionRange(caret, caret)
}

function undoDictation(e: KeyboardEvent): boolean {
  const el = field.value
  if (!e.isTrusted || !dictated || !el || e.target !== el) return false
  const key = panelKey(e, mac)
  if (key === 'undo' && el.value === dictated.after) setText(el, dictated.before, dictated.from)
  else if (key === 'redo' && el.value === dictated.before)
    setText(el, dictated.after, dictated.caret)
  else return false
  e.preventDefault()
  return true
}

/** The dictated text goes in at the caret; the field keeps what was typed meanwhile. */
voice.onText((transcript, atLimit) => {
  const el = field.value
  if (!el) return
  const before = guard.verified
  const from = Math.min(el.selectionStart, before.length)
  const { value, caret, cut } = insertTranscript(
    before,
    el.selectionStart,
    el.selectionEnd,
    transcript,
  )
  el.focus({ preventScroll: true })
  setText(el, value, caret)
  dictated = value === before ? null : { before, after: value, from, caret }
  notice.value = [
    atLimit ? 'Recording stopped after 2 minutes.' : '',
    cut
      ? `Part of it did not fit: a comment holds ${LIMITS.comment.toLocaleString('en')} characters.`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
})

function dictate() {
  if (voice.state.value.state !== 'recording') notice.value = ''
  voice.toggle()
}

/** Retry goes away once clicked: the focus goes to the field, not to the page. */
function retry() {
  voice.retry()
  field.value?.focus({ preventScroll: true })
}

// Sent inside the trusted click: the background may open the panel only within it.
function ask(message: BackgroundMessage) {
  browser.runtime.sendMessage(message).catch(() => undefined)
}

function save() {
  const el = field.value
  if (el && !guard.matches(el.value)) restore(el)
  if (canSave.value) emit('save', guard.verified.trim())
}

function onKeydown(e: KeyboardEvent) {
  if (undoDictation(e)) return
  const action = popoverKey(e)
  // Enter saves from the field; on a focused button it presses that button.
  if (!action || (action === 'save' && e.target !== field.value)) return
  e.preventDefault()
  if (action === 'save') save()
  else if (action === 'voice') dictate()
  // Escape ends a running dictation first, then the comment.
  else if (voice.busy.value) voice.cancel()
  else emit('cancel')
}

const unobscured = useUnobscured(card)

/** A button acts on a trusted click while nothing of the page lies over the popover. */
function onButton(e: MouseEvent, action: () => void) {
  if (!e.isTrusted) return
  if (!unobscured.value) {
    warning.value = 'Something on this page covers the overlay. Try again in a moment.'
    emit('obscured')
    return
  }
  action()
}

function measure() {
  if (card.value) size.value = { width: card.value.offsetWidth, height: card.value.offsetHeight }
}

// The card grows with the comment, a warning or an error: placed again, Save stays visible.
const resizes = new ResizeObserver(measure)

onMounted(async () => {
  await nextTick()
  measure()
  if (card.value) resizes.observe(card.value)
  field.value?.focus({ preventScroll: true })
})

onBeforeUnmount(() => resizes.disconnect())
</script>

<template>
  <div
    ref="card"
    data-testid="overlay-popover"
    :data-covered="unobscured ? undefined : ''"
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
        <span class="min-w-0 truncate font-mono text-xs font-normal text-muted-foreground">{{
          label
        }}</span>
      </p>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Cancel"
        @click="onButton($event, () => emit('cancel'))"
      >
        <XIcon class="size-4" />
      </Button>
    </div>
    <!-- Not v-model: every edit goes through the guard first. -->
    <textarea
      ref="field"
      data-testid="overlay-comment"
      rows="3"
      placeholder="What should change?"
      :value="text"
      class="field-sizing-content max-h-48 min-h-16 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      @beforeinput="onBeforeInput"
      @input="onInput"
      @compositionstart="guard.compositionStart($event)"
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
      v-if="failure"
      data-testid="overlay-voice-message"
      class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-destructive"
      role="alert"
    >
      <span class="min-w-0 flex-1 basis-40">{{ failure.text }}</span>
      <Button
        v-if="failure.grant"
        data-testid="overlay-voice-grant"
        variant="outline"
        size="xs"
        @click="onButton($event, () => ask({ type: 'voice:grant' }))"
      >
        Grant
      </Button>
      <Button
        v-if="failure.settings"
        data-testid="overlay-voice-settings"
        variant="outline"
        size="xs"
        @click="onButton($event, () => ask({ type: 'voice:settings' }))"
      >
        Open settings
      </Button>
      <Button
        v-if="failure.retry"
        data-testid="overlay-voice-retry"
        variant="outline"
        size="xs"
        @click="onButton($event, retry)"
      >
        Retry
      </Button>
    </div>
    <p
      v-if="notice"
      data-testid="overlay-voice-notice"
      class="text-xs text-muted-foreground"
      role="status"
    >
      {{ notice }}
    </p>
    <div class="flex items-center justify-between gap-2">
      <Button
        v-if="number && status !== 'deleted' && !voice.busy.value"
        data-testid="overlay-delete"
        variant="ghost"
        size="sm"
        class="-ml-2 text-muted-foreground hover:text-destructive"
        :aria-label="`Delete pin ${number}`"
        @click="onButton($event, () => emit('remove'))"
      >
        <Trash2Icon /> Delete
      </Button>
      <Button
        v-else-if="number && status === 'deleted' && !voice.busy.value"
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
        <template v-if="voice.state.value.state === 'recording'">
          <span class="size-2 shrink-0 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
          <span class="font-medium text-foreground tabular-nums">{{ clock }}</span>
          <span class="truncate">· Alt+V to stop</span>
        </template>
        <template v-else-if="voice.state.value.state === 'transcribing'">
          <LoaderCircleIcon class="size-3 shrink-0 animate-spin" aria-hidden="true" />
          Transcribing…
        </template>
        <template v-else-if="voice.state.value.state === 'starting'">
          Starting the microphone…
        </template>
      </p>
      <span class="sr-only" role="status" aria-live="polite">{{ spoken }}</span>
      <div class="flex shrink-0 items-center gap-1.5">
        <VoiceButton
          data-testid="overlay-mic"
          :state="voice.state.value.state"
          @click="onButton($event, dictate)"
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
