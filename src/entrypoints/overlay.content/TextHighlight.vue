<script setup lang="ts">
import { computed } from 'vue'
import type { Rect } from '@/lib/collection/model'
import { STATUS_MARK, type Tone } from '@/lib/status'

// The lines of the text being commented, measured beforehand (pins.ts, linesOf): measuring
// here, while the overlay is being written, would force a layout on every frame. Saved texts
// are shaded by the browser instead (text-marks.ts).
const props = withDefaults(
  defineProps<{
    /** The lines to shade, in viewport coordinates. */
    boxes: Rect[]
    /** The tone of the pin being edited: its color. A new one is open. */
    status?: Tone
  }>(),
  { status: 'open' },
)

// The lines move as one: when the page scrolls, only the block's transform changes and the
// lines inside keep their places, so the browser moves them without drawing them again.
const origin = computed(() => ({
  x: Math.min(...props.boxes.map((b) => b.x)),
  y: Math.min(...props.boxes.map((b) => b.y)),
}))
const lines = computed(() =>
  props.boxes.map((b) => ({
    left: `${b.x - origin.value.x}px`,
    top: `${b.y - origin.value.y}px`,
    width: `${b.width}px`,
    height: `${b.height}px`,
  })),
)
</script>

<template>
  <div
    v-if="boxes.length"
    data-testid="overlay-text-highlight"
    class="pointer-events-none fixed top-0 left-0 z-[2147483647] will-change-transform"
    :style="{ transform: `translate(${origin.x}px, ${origin.y}px)` }"
  >
    <div
      v-for="(line, i) in lines"
      :key="i"
      class="absolute"
      :class="STATUS_MARK[status].lines"
      :style="line"
    />
  </div>
</template>
