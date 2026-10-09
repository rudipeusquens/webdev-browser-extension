<script setup lang="ts">
import { LoaderCircleIcon, MicIcon, SquareIcon } from '@lucide/vue'
import { computed } from 'vue'
import { Toggle } from '@/components/ui/toggle'
import type { RecordingState } from '@/lib/voice/protocol'

// Rec, beside the modes and as wide as Pins below it: a quiet toggle until it records, then
// red with the clock, also while it waits at the limit. While the microphone starts it only
// looks disabled, so the focus stays on it. In a cell too narrow for its word (the cell is the
// container) it shows its icon only.
const props = defineProps<{ state: RecordingState['state']; clock: string; shortcut: string }>()
const emit = defineEmits<{ toggle: [] }>()

const waiting = computed(() => props.state === 'starting')
const recording = computed(() => props.state === 'recording' || props.state === 'paused')
const label = computed(() => {
  if (recording.value) return `Stop Rec: its text becomes a note and is copied (${props.shortcut})`
  if (props.state === 'starting') return 'Starting the microphone…'
  return `Rec: dictate, then copy the text (${props.shortcut})`
})
</script>

<template>
  <Toggle
    variant="outline"
    size="sm"
    class="w-full gap-1.5 px-2 data-[state=on]:bg-red-600 data-[state=on]:text-white data-[state=on]:hover:bg-red-600/90 data-[state=on]:hover:text-white"
    :class="waiting && 'cursor-default opacity-50 hover:bg-transparent'"
    :model-value="recording"
    :data-dictation="state"
    :aria-label="label"
    :title="label"
    :aria-disabled="waiting || undefined"
    @update:model-value="emit('toggle')"
  >
    <LoaderCircleIcon v-if="waiting" class="animate-spin" />
    <SquareIcon v-else-if="recording" class="size-3 fill-current" />
    <MicIcon v-else />
    <span v-if="recording" class="hidden tabular-nums @min-[4.75rem]:inline">
      {{ clock }}
    </span>
    <span v-else class="hidden @min-[4.75rem]:inline">Rec</span>
  </Toggle>
</template>
