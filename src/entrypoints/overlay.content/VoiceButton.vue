<script setup lang="ts">
import { LoaderCircleIcon, MicIcon, SquareIcon } from '@lucide/vue'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import type { VoiceState } from '@/lib/voice/protocol'

// The mic button next to Save: a quiet icon until it records, then a red stop button.
const props = defineProps<{ state: VoiceState['state'] }>()

const waiting = computed(() => props.state === 'starting' || props.state === 'transcribing')
const label = computed(() => {
  if (props.state === 'recording') return 'Stop dictating (Alt+V)'
  if (props.state === 'transcribing') return 'Transcribing…'
  if (props.state === 'starting') return 'Starting the microphone…'
  return 'Dictate (Alt+V)'
})
</script>

<template>
  <Button
    variant="ghost"
    size="icon-sm"
    :aria-label="label"
    :title="label"
    :aria-pressed="state === 'recording'"
    :disabled="waiting"
    :class="
      state === 'recording'
        ? 'bg-red-600 text-white hover:bg-red-600/90 hover:text-white'
        : 'text-muted-foreground'
    "
  >
    <LoaderCircleIcon v-if="waiting" class="animate-spin" />
    <SquareIcon v-else-if="state === 'recording'" class="size-3 fill-current" />
    <MicIcon v-else />
  </Button>
</template>
