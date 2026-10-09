<script setup lang="ts">
import { computed } from 'vue'
import type { Rect } from '@/lib/collection/model'
import { STATUS_MARK, type Tone } from '@/lib/status'

const props = withDefaults(
  defineProps<{
    rect: Rect
    label?: string
    /** hover: outlined element; selected: the item being commented; area: a dragged area. */
    tone?: 'hover' | 'selected' | 'area'
    /** The tone of the pin it marks: its color. Without one (a new target), open. */
    status?: Tone
    testid?: string
  }>(),
  { label: undefined, tone: 'hover', status: 'open', testid: 'overlay-hover' },
)
const mark = computed(() => STATUS_MARK[props.status])

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
    class="pointer-events-none fixed z-[2147483647] rounded-[2px] outline-2"
    :class="[
      mark.line,
      tone === 'hover' ? mark.fill : mark.soft,
      tone === 'area' ? 'outline-dashed' : 'outline-solid',
    ]"
    :style="box"
  >
    <span
      v-if="label"
      data-testid="overlay-hover-label"
      class="absolute left-0 max-w-80 truncate rounded-sm px-1.5 py-0.5 font-mono text-xs leading-4 whitespace-nowrap text-white"
      :class="[mark.label, labelInside ? 'top-0.5 left-0.5' : '-top-6']"
      >{{ label }}</span
    >
  </div>
</template>
