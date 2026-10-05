<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const props = defineProps<{ text: string | null }>()
const emit = defineEmits<{ close: [] }>()
const field = useTemplateRef<HTMLTextAreaElement>('field')

watch(
  () => props.text,
  async (text) => {
    if (text === null) return
    await nextTick()
    field.value?.focus()
    field.value?.select()
  },
)
</script>

<template>
  <Dialog :open="text !== null" @update:open="(open) => open || emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Copy the prompt manually</DialogTitle>
        <DialogDescription>
          The clipboard was not available. The text below is selected: press Ctrl+C (⌘C on a Mac).
        </DialogDescription>
      </DialogHeader>
      <textarea
        ref="field"
        data-testid="copy-fallback-text"
        readonly
        rows="12"
        class="w-full resize-none rounded-md border bg-muted/40 p-2 font-mono text-xs"
        :value="text ?? ''"
      />
    </DialogContent>
  </Dialog>
</template>
