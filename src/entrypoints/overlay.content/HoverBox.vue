<script setup lang="ts">
import { computed } from 'vue'
import type { Rect } from '@/lib/collection/model'

const props = defineProps<{ rect: Rect; label?: string; tone?: 'hover' | 'selected' }>()

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
    data-testid="overlay-hover"
    class="pointer-events-none fixed z-[2147483647] rounded-[2px] outline-2 outline-blue-600"
    :class="tone === 'selected' ? 'bg-blue-600/5 outline-solid' : 'bg-blue-600/10 outline-solid'"
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
