<script setup lang="ts">
import { computed } from 'vue'
import type { Rect } from '@/lib/collection/model'
import { clipBoxes } from './pins'

const props = withDefaults(
  defineProps<{
    range: Range
    /** Changes whenever positions may have changed (see use-tracking.ts). */
    frame?: number
    /** Where the text can be seen: lines are cut to it, as pins are (none: the viewport). */
    bounds?: Rect | null
    /** selected: the text being commented; pin: a saved item; strong: its pin is hovered. */
    tone?: 'selected' | 'pin' | 'strong'
    testid?: string
    /** Test id of each line box. */
    lineTestid?: string
  }>(),
  {
    frame: undefined,
    bounds: undefined,
    tone: 'selected',
    testid: 'overlay-text-highlight',
    lineTestid: undefined,
  },
)

// A selection over a whole page has thousands of lines; the ones on screen are enough.
const MAX_BOXES = 50

const boxes = computed(() => {
  void props.frame
  const height = window.innerHeight
  const lines = [...props.range.getClientRects()]
    .filter((r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < height)
    .slice(0, MAX_BOXES)
    .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }))
  return (props.bounds ? clipBoxes(lines, props.bounds) : lines).map((r) => ({
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  }))
})
</script>

<template>
  <div :data-testid="testid">
    <div
      v-for="(box, i) in boxes"
      :key="i"
      :data-testid="lineTestid"
      :data-strong="tone === 'strong'"
      class="pointer-events-none fixed z-[2147483647]"
      :class="tone === 'pin' ? 'bg-blue-600/15' : 'bg-blue-600/25'"
      :style="box"
    />
  </div>
</template>
