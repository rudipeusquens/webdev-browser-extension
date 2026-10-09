<script setup lang="ts">
import { CopyIcon, LoaderCircleIcon, MicIcon, Trash2Icon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import type { Note } from '@/lib/notes/model'
import { dictationFailure } from '@/lib/voice/protocol'

// The Rec notes (spec section 8), above the pages: what Rec dictated, the newest first, the
// same on every site. Each has its own Copy and Delete; nothing else in the panel touches them.
// A click on a note shows all of its text, another shows two lines again.

const props = defineProps<{ notes: Note[] }>()
const emit = defineEmits<{
  copy: [id: string]
  remove: [id: string]
  retry: [id: string]
  settings: []
}>()

const newest = computed(() => [...props.notes].reverse())
const expanded = ref(new Set<string>())

function toggle(id: string) {
  const next = new Set(expanded.value)
  if (!next.delete(id)) next.add(id)
  expanded.value = next
}

/** When it was dictated: the time today, the day and time before. */
function when(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const time = at.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  if (at.toDateString() === new Date().toDateString()) return time
  return `${at.toLocaleDateString('en', { day: 'numeric', month: 'short' })}, ${time}`
}
</script>

<template>
  <section data-testid="notes" class="border-b pb-3">
    <h2
      class="sticky top-0 z-10 flex min-h-8 items-center gap-1.5 bg-background/95 px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground backdrop-blur"
    >
      <MicIcon class="size-3" /> Rec
    </h2>
    <ul>
      <li
        v-for="note in newest"
        :key="note.id"
        data-testid="note"
        :data-note-id="note.id"
        class="px-2 hover:bg-muted/60"
      >
        <div class="flex items-start gap-1">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-start gap-3 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-expanded="expanded.has(note.id)"
            :title="expanded.has(note.id) ? 'Show less' : 'Show all of it'"
            @click="toggle(note.id)"
          >
            <span
              class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <MicIcon class="size-3" />
            </span>
            <span class="min-w-0 flex-1">
              <span
                v-if="note.text"
                data-testid="note-text"
                class="break-words whitespace-pre-line"
                :class="!expanded.has(note.id) && 'line-clamp-2'"
                >{{ note.text }}</span
              >
              <span
                v-if="note.job?.state === 'transcribing'"
                data-testid="note-transcribing"
                class="flex items-center gap-1.5 text-muted-foreground"
              >
                <LoaderCircleIcon class="size-3 shrink-0 animate-spin" aria-hidden="true" />
                Transcribing…
              </span>
              <span class="mt-0.5 block text-xs text-muted-foreground tabular-nums">{{
                when(note.createdAt)
              }}</span>
            </span>
          </button>
          <Button
            v-if="note.text"
            data-testid="note-copy"
            variant="ghost"
            size="icon-sm"
            class="mt-1 shrink-0 text-muted-foreground"
            aria-label="Copy the note"
            title="Copy its text as it is"
            @click="emit('copy', note.id)"
          >
            <CopyIcon />
          </Button>
          <Button
            data-testid="note-delete"
            variant="ghost"
            size="icon-sm"
            class="mt-1 shrink-0 text-muted-foreground"
            aria-label="Delete the note"
            title="Delete for good"
            @click="emit('remove', note.id)"
          >
            <Trash2Icon />
          </Button>
        </div>
        <div
          v-if="note.job?.state === 'failed'"
          data-testid="note-job"
          role="status"
          class="flex flex-wrap items-center gap-x-2 gap-y-1 pr-2 pb-2 pl-10 text-xs"
        >
          <span class="min-w-0 flex-1 basis-32 text-destructive">{{
            dictationFailure(note.job)?.text
          }}</span>
          <Button
            v-if="dictationFailure(note.job)?.settings"
            data-testid="note-settings"
            variant="outline"
            size="xs"
            @click="emit('settings')"
          >
            Open settings
          </Button>
          <Button
            v-if="dictationFailure(note.job)?.retry"
            data-testid="note-retry"
            variant="outline"
            size="xs"
            @click="emit('retry', note.id)"
          >
            Retry
          </Button>
        </div>
      </li>
    </ul>
  </section>
</template>
