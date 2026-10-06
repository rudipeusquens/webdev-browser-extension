<script setup lang="ts">
import { computed } from 'vue'
import type { Rect } from '@/lib/collection/model'

const props = withDefaults(
  defineProps<{
    rect: Rect
    label?: string
    /** hover: outlined element; selected: the item being commented; area: a dragged area. */
    tone?: 'hover' | 'selected' | 'area'
    testid?: string
  }>(),
  { label: undefined, tone: 'hover', testid: 'overlay-hover' },
)

const box = computed(() => ({
  left: `${props.rect.x}px`,
  top: `${props.rect.y}px`,
  width: `${props.rect.width}px`,
  height: `${props.rect.height}px`,
}))
// The label sits above the box, or inside it when the box touches the top of the viewport.
const labelInside = computed(() => props.rect.y < 24)
</script>

<template>
  <div
    :data-testid="testid"
    class="pointer-events-none fixed z-[2147483647] rounded-[2px] outline-2 outline-blue-600"
    :class="{
      'bg-blue-600/10 outline-solid': tone === 'hover',
      'bg-blue-600/5 outline-solid': tone === 'selected',
      'bg-blue-600/5 outline-dashed': tone === 'area',
    }"
    :style="box"
  >
    <span
      v-if="label"
      data-testid="overlay-hover-label"
      class="absolute left-0 max-w-80 truncate rounded-sm bg-blue-600 px-1.5 py-0.5 font-mono text-xs leading-4 whitespace-nowrap text-white"
      :class="labelInside ? 'top-0.5 left-0.5' : '-top-6'"
      >{{ label }}</span
    >
  </div>
</template>
