<script setup lang="ts">
import { XIcon } from '@lucide/vue'
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue'
import { Button } from '@/components/ui/button'
import type { Rect } from '@/lib/collection/model'
import { CommentGuard } from './comment-guard'
import { popoverKey } from './keys'
import { placeNear } from './place'

const props = defineProps<{
  /** The target in viewport coordinates. */
  rect: Rect
  /** Short description of the target, e.g. `button · 160×48`. */
  label: string
  initial?: string
  /** Set when an existing item is edited. */
  number?: number
  error?: string
  busy?: boolean
  /** Changes whenever positions may have changed (see use-tracking.ts). */
  frame?: number
}>()

const emit = defineEmits<{ save: [comment: string]; cancel: [] }>()

const guard = new CommentGuard(props.initial ?? '')
const text = ref(guard.verified)
const warning = ref('')
const card = useTemplateRef<HTMLElement>('card')
const field = useTemplateRef<HTMLTextAreaElement>('field')
const size = ref({ width: 288, height: 180 })

const canSave = computed(() => text.value.trim() !== '' && !props.busy)
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

function onInput(e: Event) {
  const el = e.target as HTMLTextAreaElement
  if (guard.input(e as InputEvent, el.value)) text.value = el.value
  else restore(el)
}

function save() {
  const el = field.value
  if (el && !guard.matches(el.value)) restore(el)
  if (canSave.value) emit('save', guard.verified.trim())
}

function onKeydown(e: KeyboardEvent) {
  const action = popoverKey(e)
  if (!action) return
  e.preventDefault()
  if (action === 'save') save()
  else emit('cancel')
}

function onButton(e: MouseEvent, action: () => void) {
  if (e.isTrusted) action()
}

onMounted(async () => {
  await nextTick()
  if (card.value) size.value = { width: card.value.offsetWidth, height: card.value.offsetHeight }
  field.value?.focus({ preventScroll: true })
})
</script>

<template>
  <div
    ref="card"
    data-testid="overlay-popover"
    role="dialog"
    :aria-label="number ? `Edit item ${number}` : 'Comment'"
    class="fixed z-[2147483647] flex w-72 flex-col gap-2 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
    :style="position"
    @keydown="onKeydown"
  >
    <div class="flex items-center justify-between gap-2">
      <p class="min-w-0 truncate font-medium">
        {{ number ? `Item ${number}` : 'Comment' }}
        <span class="font-mono text-xs font-normal text-muted-foreground">{{ label }}</span>
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
      @beforeinput="guard.beforeInput($event as InputEvent)"
      @input="onInput"
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
    <div class="flex items-center justify-between gap-2">
      <p class="text-xs whitespace-nowrap text-muted-foreground" title="Shift+Enter adds a line">
        Enter to save
      </p>
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
</template>
