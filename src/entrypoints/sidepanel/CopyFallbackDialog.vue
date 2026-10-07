<script lang="ts">
/**
 * Text the clipboard did not take: a prompt or a dictation it refused, or a dictation that a
 * copy of pins clicked while it was transcribed got ahead of.
 */
export interface Fallback {
  text: string
  kind: 'prompt' | 'dictation' | 'outdone'
}
</script>

<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const props = defineProps<{ fallback: Fallback | null }>()
const emit = defineEmits<{ close: [] }>()
const field = useTemplateRef<HTMLTextAreaElement>('field')

const SELECTED = 'The text below is selected: press Ctrl+C (⌘C on a Mac).'
const words = computed(() => {
  switch (props.fallback?.kind) {
    case 'dictation':
      return {
        title: 'Copy the dictation manually',
        why: `The clipboard was not available. ${SELECTED}`,
      }
    case 'outdone':
      return {
        title: 'Your dictation',
        why: `Pins copied while it was transcribed keep the clipboard. ${SELECTED}`,
      }
    default:
      return {
        title: 'Copy the prompt manually',
        why: `The clipboard was not available. ${SELECTED}`,
      }
  }
})

watch(
  () => props.fallback,
  async (fallback) => {
    if (fallback === null) return
    await nextTick()
    field.value?.focus()
    field.value?.select()
  },
)
</script>

<template>
  <Dialog :open="fallback !== null" @update:open="(open) => open || emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ words.title }}</DialogTitle>
        <DialogDescription>{{ words.why }}</DialogDescription>
      </DialogHeader>
      <textarea
        ref="field"
        data-testid="copy-fallback-text"
        readonly
        rows="12"
        class="w-full resize-none rounded-md border bg-muted/40 p-2 font-mono text-xs"
        :value="fallback?.text ?? ''"
      />
    </DialogContent>
  </Dialog>
</template>
