<script setup lang="ts">
import { XIcon } from '@lucide/vue'
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { Rect } from '@/lib/collection/model'
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

const text = ref(props.initial ?? '')
const card = useTemplateRef<HTMLElement>('card')
const field = useTemplateRef<InstanceType<typeof Textarea>>('field')
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

function save() {
  if (canSave.value) emit('save', text.value.trim())
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
  ;(field.value?.$el as HTMLTextAreaElement | undefined)?.focus({ preventScroll: true })
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
    <Textarea
      ref="field"
      v-model="text"
      data-testid="overlay-comment"
      rows="3"
      placeholder="What should change?"
      class="max-h-48 resize-none text-sm"
    />
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
