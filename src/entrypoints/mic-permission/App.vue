<script setup lang="ts">
import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon, MicIcon } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { browser } from 'wxt/browser'
import { Button } from '@/components/ui/button'
import { askMicrophone, type MicAnswer } from './ask'

/** Long enough to read the confirmation, then back to the page the developer came from. */
const CLOSE_AFTER = 1500

const answer = ref<MicAnswer | 'asking'>('asking')
let closing: ReturnType<typeof setTimeout> | undefined

async function ask() {
  answer.value = 'asking'
  answer.value = await askMicrophone()
  if (answer.value === 'allowed') closing = setTimeout(() => void closeTab(), CLOSE_AFTER)
}

async function closeTab() {
  const tab = await browser.tabs.getCurrent().catch(() => undefined)
  if (tab?.id !== undefined) await browser.tabs.remove(tab.id).catch(() => undefined)
}

onMounted(ask)
onBeforeUnmount(() => clearTimeout(closing))
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
    <section class="w-full max-w-md space-y-4 rounded-lg border p-6 shadow-sm">
      <div class="flex items-center gap-3">
        <span class="flex size-9 items-center justify-center rounded-full bg-muted">
          <MicIcon class="size-5" />
        </span>
        <h1 class="text-lg font-semibold">Microphone for dictation</h1>
      </div>
      <p class="text-sm text-muted-foreground">
        Webdev Browser Extension records only while you dictate a comment, after you click the mic
        button or press Alt+V. The recording goes to OpenRouter for transcription and is not kept.
      </p>

      <p
        data-testid="mic-status"
        class="flex items-start gap-2 rounded-md border p-3 text-sm"
        role="status"
        aria-live="polite"
      >
        <template v-if="answer === 'asking'">
          <LoaderCircleIcon class="mt-0.5 size-4 shrink-0 animate-spin" />
          <span>Chrome asks for access to your microphone.</span>
        </template>
        <template v-else-if="answer === 'allowed'">
          <CircleCheckIcon class="mt-0.5 size-4 shrink-0 text-emerald-600" />
          <span>Microphone allowed. You can close this tab.</span>
        </template>
        <template v-else>
          <CircleAlertIcon class="mt-0.5 size-4 shrink-0 text-destructive" />
          <span v-if="answer === 'blocked'">
            Chrome did not allow the microphone. Click Try again; if Chrome does not ask any more,
            allow the microphone in the site settings of this extension (the icon left of the
            address bar) and, on macOS, for Chrome in the system's privacy settings.
          </span>
          <span v-else-if="answer === 'missing'">
            No microphone found. Connect one and click Try again.
          </span>
          <span v-else
            >The microphone could not start. Close other apps that use it and try again.</span
          >
        </template>
      </p>

      <div class="flex justify-end gap-2">
        <Button v-if="answer === 'allowed'" variant="outline" @click="closeTab">Close tab</Button>
        <Button v-else-if="answer !== 'asking'" data-testid="mic-retry" @click="ask">
          Try again
        </Button>
      </div>
    </section>
  </main>
</template>
