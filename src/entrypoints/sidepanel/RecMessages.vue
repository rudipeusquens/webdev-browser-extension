<script setup lang="ts">
import { Button } from '@/components/ui/button'
import type { DictationFailure } from '@/lib/voice/protocol'
import { openMicPermission } from './open-mic-permission'

// Rec's messages above the footer's buttons: its question at the limit, and why it failed with
// what helps. Both are siblings of the panel's other messages, so this has no element of its
// own. Grant opens the microphone's page itself; the rest is the panel's to do.
defineProps<{ paused: boolean; clock: string; failure: DictationFailure | null }>()
const emit = defineEmits<{ keep: []; toggle: []; settings: [] }>()
</script>

<template>
  <div
    v-if="paused"
    data-testid="rec-limit"
    role="alert"
    class="flex flex-wrap items-center gap-x-2 gap-y-1"
  >
    <span class="min-w-0 flex-1 basis-40">Rec paused at {{ clock }}. Keep recording?</span>
    <Button data-testid="rec-keep" variant="outline" size="xs" @click="emit('keep')"> Keep </Button>
    <Button data-testid="rec-stop" variant="outline" size="xs" @click="emit('toggle')">
      Stop
    </Button>
  </div>
  <div
    v-if="failure"
    data-testid="rec-message"
    role="alert"
    class="flex flex-wrap items-center gap-x-2 gap-y-1 text-destructive"
  >
    <span class="min-w-0 flex-1 basis-40">{{ failure.text }}</span>
    <Button
      v-if="failure.grant"
      data-testid="rec-grant"
      variant="outline"
      size="xs"
      @click="openMicPermission"
    >
      Grant
    </Button>
    <Button
      v-if="failure.settings"
      data-testid="rec-settings"
      variant="outline"
      size="xs"
      @click="emit('settings')"
    >
      Open settings
    </Button>
    <Button
      v-if="failure.retry"
      data-testid="rec-retry"
      variant="outline"
      size="xs"
      @click="emit('toggle')"
    >
      Retry
    </Button>
  </div>
</template>
