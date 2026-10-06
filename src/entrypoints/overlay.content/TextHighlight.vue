<script setup lang="ts">
import { computed } from 'vue'
import type { Rect } from '@/lib/collection/model'

// Draws lines measured beforehand (pins.ts, linesOf): measuring here, while the overlay is
// being written, would force a layout on every frame.
const props = withDefaults(
  defineProps<{
    /** The lines to shade, in viewport coordinates. */
    boxes: Rect[]
    /** selected: the text being commented; pin: a saved item; strong: its pin is hovered. */
    tone?: 'selected' | 'pin' | 'strong'
    testid?: string
    /** Test id of each line box. */
    lineTestid?: string
  }>(),
  { tone: 'selected', testid: 'overlay-text-highlight', lineTestid: undefined },
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
    :data-testid="testid"
    class="pointer-events-none fixed top-0 left-0 z-[2147483647] will-change-transform"
    :style="{ transform: `translate(${origin.x}px, ${origin.y}px)` }"
  >
    <div
      v-for="(line, i) in lines"
      :key="i"
      :data-testid="lineTestid"
      :data-strong="tone === 'strong'"
      class="absolute"
      :class="tone === 'pin' ? 'bg-blue-600/15' : 'bg-blue-600/25'"
      :style="line"
    />
  </div>
</template>
