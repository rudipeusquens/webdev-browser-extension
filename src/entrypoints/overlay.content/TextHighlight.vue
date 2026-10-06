<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  range: Range
  /** Changes whenever positions may have changed (see use-tracking.ts). */
  frame?: number
}>()

// A selection over a whole page has thousands of lines; the ones on screen are enough.
const MAX_BOXES = 50

const boxes = computed(() => {
  void props.frame
  const height = window.innerHeight
  return [...props.range.getClientRects()]
    .filter((r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < height)
    .slice(0, MAX_BOXES)
    .map((r) => ({
      left: `${r.x}px`,
      top: `${r.y}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    }))
})
</script>

<template>
  <div data-testid="overlay-text-highlight">
    <div
      v-for="(box, i) in boxes"
      :key="i"
      class="pointer-events-none fixed z-[2147483647] bg-blue-600/25"
      :style="box"
    />
  </div>
</template>
