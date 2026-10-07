<script setup lang="ts">
import { MapPinPlusIcon } from '@lucide/vue'
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue'
import type { Rect } from '@/lib/collection/model'
import { chipPosition } from './place'
import { useUnobscured } from './use-unobscured'

const props = defineProps<{
  /** The last line of the selection, in viewport coordinates. */
  line: Rect
}>()
const emit = defineEmits<{ comment: []; obscured: [] }>()

const chip = useTemplateRef<HTMLElement>('chip')
const size = ref({ width: 96, height: 28 })
const position = computed(() => {
  const { x, y } = chipPosition(props.line, size.value, {
    width: window.innerWidth,
    height: window.innerHeight,
  })
  return { left: `${x}px`, top: `${y}px` }
})

const unobscured = useUnobscured(chip)

/** A trusted click while nothing of the page lies over the chip. */
function onClick(e: MouseEvent) {
  if (!e.isTrusted) return
  if (unobscured.value) emit('comment')
  else emit('obscured')
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
    title="Pin this text"
    @mousedown.prevent
    @click="onClick"
  >
    <MapPinPlusIcon class="size-3.5" />
    Pin
  </button>
</template>
