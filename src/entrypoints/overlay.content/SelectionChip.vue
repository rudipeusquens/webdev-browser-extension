<script setup lang="ts">
import { MessageSquarePlusIcon } from '@lucide/vue'
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue'
import type { Rect } from '@/lib/collection/model'
import { chipPosition } from './place'

const props = defineProps<{
  /** The last line of the selection, in viewport coordinates. */
  line: Rect
}>()
const emit = defineEmits<{ comment: [] }>()

const chip = useTemplateRef<HTMLElement>('chip')
const size = ref({ width: 96, height: 28 })
const position = computed(() => {
  const { x, y } = chipPosition(props.line, size.value, {
    width: window.innerWidth,
    height: window.innerHeight,
  })
  return { left: `${x}px`, top: `${y}px` }
})

function onClick(e: MouseEvent) {
  if (e.isTrusted) emit('comment')
}

onMounted(async () => {
  await nextTick()
  if (chip.value) size.value = { width: chip.value.offsetWidth, height: chip.value.offsetHeight }
})
</script>

<template>
  <!-- mousedown is prevented: a click on the chip must not clear the page's selection. -->
  <button
    ref="chip"
    type="button"
    data-testid="overlay-chip"
    class="fixed z-[2147483647] flex items-center gap-1.5 rounded-full border bg-popover px-3 py-1 text-xs font-medium text-popover-foreground shadow-md hover:bg-accent"
    :style="position"
    @mousedown.prevent
    @click="onClick"
  >
    <MessageSquarePlusIcon class="size-3.5" />
    Comment
  </button>
</template>
