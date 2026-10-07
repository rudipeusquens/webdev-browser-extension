<script setup lang="ts">
import { ArchiveRestoreIcon, LoaderCircleIcon, Trash2Icon, XIcon } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { browser } from 'wxt/browser'
import { Button } from '@/components/ui/button'
import { LIMITS, type Rect, type Status } from '@/lib/collection/model'
import type { BackgroundMessage } from '@/lib/messages'
import { currentPlatform, isMacPlatform, panelKey } from '@/lib/shortcuts'
import { dictationFailure } from '@/lib/voice/protocol'
import { CommentGuard } from './comment-guard'
import { popoverKey } from './keys'
import { placeNear } from './place'
import { insertTranscript } from './transcript'
import { fieldState, putBack, useFieldSelection } from './use-field-selection'
import { useUnobscured } from './use-unobscured'
import { useVoice } from '@/composables/use-voice'
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
const mac = isMacPlatform(currentPlatform())
const selection = useFieldSelection(guard, mac)
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
/** What screen readers hear: changes of the dictation, not every second of its clock. */
const spoken = computed(() => {
  const now = voice.state.value.state
  if (now === 'recording') return 'Recording. Alt+V stops it.'
  if (now === 'transcribing') return 'Transcribing.'
  return ''
})
const failure = computed(() => dictationFailure(voice.state.value))
// Spaces at the ends are not saved, so they change nothing.
const unsaved = computed(() => {
  const now = voice.state.value
  const held = now.state === 'failed' && now.retry
  return text.value.trim() !== (props.initial ?? '').trim() || voice.busy.value || held
})
watch(unsaved, (now) => emit('unsaved', now), { immediate: true })
/** Focuses the field with the selection the user left in it. */
function focusField() {
  const el = field.value
  if (!el) return
  el.focus({ preventScroll: true })
  // A page's focus listener may have moved it.
  putBack(el, guard.selection)
}

watch(() => props.nudge, focusField)
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

/**
 * The field before and after the last dictation, while nothing else changed it: Ctrl+Z (⌘Z)
 * takes the dictated text out, Ctrl+Shift+Z puts it back. The text is set as a whole, not as
 * an edit of the field: a page sees the input events of edits, and would read what was
 * dictated. So the browser's own undo does not know it.
 */
let dictated: { before: string; after: string; from: number; caret: number } | null = null

/** Sets the field to `value` as the overlay's own edit, with the caret at `caret`. */
function setText(el: HTMLTextAreaElement, value: string, caret: number) {
  el.value = value
  guard.accept(value, caret)
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

/**
 * The dictated text goes in at the caret the user left, wherever a page moved the field's;
 * the field keeps what was typed meanwhile.
 */
voice.onText((transcript, atLimit) => {
  const el = field.value
  if (!el) return
  const before = guard.verified
  const at = guard.selection ?? { start: el.selectionStart, end: el.selectionEnd }
  const from = Math.min(at.start, before.length)
  const { value, caret, cut } = insertTranscript(before, at.start, at.end, transcript)
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
  focusField()
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
  if (field.value && e.target === field.value) selection.keydown(e, field.value)
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
          <span class="font-medium text-foreground tabular-nums">{{ voice.clock.value }}</span>
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
