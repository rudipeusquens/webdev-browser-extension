<script setup lang="ts">
import type { Rect } from '@/lib/collection/model'

// Draws lines measured beforehand (pins.ts, linesOf): measuring here, while the overlay is
// being written, would force a layout on every frame.
withDefaults(
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
      :style="{
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      }"
    />
  </div>
</template>
