<script setup lang="ts">
import { CircleAlertIcon, CircleCheckIcon, MicOffIcon, Trash2Icon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { browser } from 'wxt/browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { KeyTestReply, Reply, VoiceSettingsMessage } from '@/lib/messages'
import {
  DEFAULT_PROMPT,
  isApiKey,
  isModelId,
  isPrompt,
  LANGUAGES,
  LIMIT_CHOICES,
  MAX_PROMPT,
  MODELS,
  type VoiceSettings,
} from '@/lib/voice/settings'
import { openMicPermission } from './open-mic-permission'
import { useVoiceSettings } from './use-voice-settings'

// Settings → Voice (spec section 8). The panel reads the key only to show it masked; every
// change goes through the background, the single writer.

const { voice, maskedKey, microphone } = useVoiceSettings()

const draftKey = ref('')
const keyError = ref('')
const keyResult = ref<{ ok: boolean; text: string } | null>(null)
const testing = ref(false)

/** A model of the list, or `custom` with its id in the field below. */
const choice = ref('')
const customModel = ref('')
const modelError = ref('')

watch(
  () => voice.value.model,
  (model) => {
    const listed = MODELS.some((m) => m.id === model)
    choice.value = listed ? model : 'custom'
    customModel.value = listed ? '' : model
    modelError.value = ''
  },
  { immediate: true },
)
watch(maskedKey, () => (keyResult.value = null))

const send = <T,>(message: VoiceSettingsMessage) =>
  browser.runtime.sendMessage(message).catch(() => undefined) as Promise<T | undefined>

async function saveKey() {
  const key = draftKey.value.trim()
  if (!key) return
  if (!isApiKey(key)) {
    keyError.value = 'That does not look like an OpenRouter API key.'
    return
  }
  keyError.value = ''
  const reply = await send<Reply>({ type: 'voice:key:save', key })
  if (reply?.ok) draftKey.value = ''
  else keyError.value = reply?.error ?? 'Could not save the key.'
}

async function testKey() {
  testing.value = true
  const reply = await send<KeyTestReply>({ type: 'voice:key:test' })
  testing.value = false
  if (!reply) keyResult.value = { ok: false, text: 'Could not test the key.' }
  else if (!reply.ok) keyResult.value = { ok: false, text: reply.error }
  else
    keyResult.value = reply.valid
      ? { ok: true, text: 'Key works.' }
      : { ok: false, text: 'Invalid API key.' }
}

function removeKey() {
  void send({ type: 'voice:key:remove' })
}

/**
 * Only the field that changed: the others as shown come from storage, which may not hold a
 * change made just before yet, and would undo it.
 */
function setVoice(change: Partial<VoiceSettings>) {
  void send({ type: 'voice:set', ...change })
}

const modelChoice = computed({
  get: () => choice.value,
  set(value: unknown) {
    const model = String(value)
    choice.value = model
    modelError.value = ''
    if (model !== 'custom') setVoice({ model })
  },
})

function saveCustom() {
  const model = customModel.value.trim()
  if (!isModelId(model)) {
    modelError.value = 'Use an OpenRouter model id such as vendor/model.'
    return
  }
  modelError.value = ''
  setVoice({ model })
}

const language = computed({
  get: () => voice.value.language,
  set: (value: unknown) => setVoice({ language: String(value) }),
})

/** The limits of the list, and the stored one when it is not among them (set elsewhere). */
const limits = computed(() =>
  LIMIT_CHOICES.includes(voice.value.limit) ? LIMIT_CHOICES : [...LIMIT_CHOICES, voice.value.limit],
)
const minutes = (ms: number) =>
  ms % 60_000 === 0
    ? `${ms / 60_000} minute${ms === 60_000 ? '' : 's'}`
    : `${Math.round(ms / 1000)} seconds`

const limit = computed({
  get: () => String(voice.value.limit),
  set: (value: unknown) => setVoice({ limit: Number.parseInt(String(value), 10) }),
})

/** The correction's model and instructions as typed; stored on Save. */
const correctModel = ref('')
const correctModelError = ref('')
const prompt = ref('')
const promptError = ref('')
watch(
  () => voice.value.correctModel,
  (model) => {
    correctModel.value = model
    correctModelError.value = ''
  },
  { immediate: true },
)
watch(
  () => voice.value.correctPrompt,
  (stored) => {
    prompt.value = stored
    promptError.value = ''
  },
  { immediate: true },
)

function saveCorrectModel() {
  const model = correctModel.value.trim()
  if (!isModelId(model)) {
    correctModelError.value = 'Use an OpenRouter model id such as vendor/model.'
    return
  }
  correctModelError.value = ''
  setVoice({ correctModel: model })
}

function savePrompt() {
  if (!isPrompt(prompt.value)) {
    promptError.value = `Write some instructions, at most ${MAX_PROMPT} characters.`
    return
  }
  promptError.value = ''
  setVoice({ correctPrompt: prompt.value })
}

function resetPrompt() {
  prompt.value = DEFAULT_PROMPT
  promptError.value = ''
  setVoice({ correctPrompt: DEFAULT_PROMPT })
}
</script>

<template>
  <section data-testid="voice-settings" class="space-y-4">
    <div class="space-y-1">
      <h3 class="text-xs font-medium text-muted-foreground">Voice</h3>
      <p class="text-xs text-muted-foreground">
        Dictate a comment with Space in an empty comment, Alt+V or the mic button; anything else
        with Rec, which keeps the text as a note and copies it. Only the recording and its
        transcript leave the browser: they go to OpenRouter with your own key, with data collection
        turned off.
      </p>
    </div>

    <div class="space-y-1.5">
      <Label for="voice-key" class="text-xs">OpenRouter API key</Label>
      <div v-if="maskedKey" class="flex items-center gap-2">
        <code
          data-testid="voice-key-masked"
          class="min-w-0 flex-1 truncate rounded-md border px-3 py-1.5 font-mono text-xs"
          >{{ maskedKey }}</code
        >
        <Button
          data-testid="voice-key-test"
          variant="outline"
          size="sm"
          :disabled="testing"
          @click="testKey"
        >
          Test
        </Button>
        <Button
          data-testid="voice-key-remove"
          variant="ghost"
          size="icon-sm"
          class="text-muted-foreground"
          aria-label="Remove the API key"
          @click="removeKey"
        >
          <Trash2Icon />
        </Button>
      </div>
      <div v-else class="flex items-center gap-2">
        <Input
          id="voice-key"
          v-model="draftKey"
          data-testid="voice-key-input"
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="sk-or-v1-…"
          class="h-8 font-mono text-xs"
          :aria-invalid="keyError ? true : undefined"
          @keydown.enter.prevent="saveKey"
        />
        <Button data-testid="voice-key-save" size="sm" :disabled="!draftKey" @click="saveKey">
          Save
        </Button>
      </div>
      <p v-if="keyError" class="text-xs text-destructive" role="alert">{{ keyError }}</p>
      <p
        v-else-if="keyResult"
        data-testid="voice-key-result"
        class="text-xs"
        :class="keyResult.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'"
        role="status"
      >
        {{ keyResult.text }}
      </p>
      <p v-else-if="!maskedKey" class="text-xs text-muted-foreground">
        Create one at
        <a
          href="https://openrouter.ai/settings/keys"
          target="_blank"
          rel="noopener noreferrer"
          class="underline underline-offset-2"
          >openrouter.ai/settings/keys</a
        >. It stays in this browser and is shown masked once saved.
      </p>
    </div>

    <div class="space-y-1.5 [&_[data-slot=native-select-wrapper]]:w-full">
      <Label for="voice-model" class="text-xs">Model</Label>
      <NativeSelect
        id="voice-model"
        v-model="modelChoice"
        data-testid="voice-model"
        class="h-8 text-xs"
      >
        <NativeSelectOption v-for="model in MODELS" :key="model.id" :value="model.id">
          {{ model.label }}
        </NativeSelectOption>
        <NativeSelectOption value="custom">Custom model…</NativeSelectOption>
      </NativeSelect>
      <div v-if="choice === 'custom'" class="flex items-center gap-2">
        <Input
          v-model="customModel"
          data-testid="voice-custom-model"
          aria-label="Custom model id"
          placeholder="vendor/model"
          spellcheck="false"
          class="h-8 font-mono text-xs"
          :aria-invalid="modelError ? true : undefined"
          @keydown.enter.prevent="saveCustom"
        />
        <Button data-testid="voice-custom-save" variant="outline" size="sm" @click="saveCustom">
          Save
        </Button>
      </div>
      <p v-if="modelError" class="text-xs text-destructive" role="alert">{{ modelError }}</p>
    </div>

    <div class="space-y-1.5 [&_[data-slot=native-select-wrapper]]:w-full">
      <Label for="voice-language" class="text-xs">Language</Label>
      <NativeSelect
        id="voice-language"
        v-model="language"
        data-testid="voice-language"
        class="h-8 text-xs"
      >
        <NativeSelectOption v-for="option in LANGUAGES" :key="option.code" :value="option.code">
          {{ option.label }}
        </NativeSelectOption>
      </NativeSelect>
    </div>

    <div class="space-y-1.5 [&_[data-slot=native-select-wrapper]]:w-full">
      <Label for="voice-limit" class="text-xs">Recording limit</Label>
      <NativeSelect id="voice-limit" v-model="limit" data-testid="voice-limit" class="h-8 text-xs">
        <NativeSelectOption v-for="ms in limits" :key="ms" :value="String(ms)">
          {{ minutes(ms) }}
        </NativeSelectOption>
      </NativeSelect>
      <p class="text-xs text-muted-foreground">
        A recording pauses there and asks whether to go on; without an answer it stops after a
        minute.
      </p>
    </div>

    <div data-testid="voice-correct" class="space-y-3">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1 space-y-1">
          <label for="voice-correct-on" class="text-xs font-medium">Correct transcripts</label>
          <p class="text-xs text-muted-foreground">
            A language model reads each transcript and fixes what the transcription misheard, such
            as names. The transcript goes to OpenRouter for it, with the same key and data
            collection turned off. If it fails, the transcript is kept as it came.
          </p>
        </div>
        <Switch
          id="voice-correct-on"
          data-testid="voice-correct-on"
          class="mt-0.5"
          :model-value="voice.correct"
          @update:model-value="(value: boolean) => setVoice({ correct: value })"
        />
      </div>
      <template v-if="voice.correct">
        <div class="space-y-1.5">
          <Label for="voice-correct-model" class="text-xs">Correction model</Label>
          <div class="flex items-center gap-2">
            <Input
              id="voice-correct-model"
              v-model="correctModel"
              data-testid="voice-correct-model"
              placeholder="vendor/model"
              spellcheck="false"
              class="h-8 font-mono text-xs"
              :aria-invalid="correctModelError ? true : undefined"
              @keydown.enter.prevent="saveCorrectModel"
            />
            <Button
              data-testid="voice-correct-model-save"
              variant="outline"
              size="sm"
              :disabled="correctModel.trim() === voice.correctModel"
              @click="saveCorrectModel"
            >
              Save
            </Button>
          </div>
          <p v-if="correctModelError" class="text-xs text-destructive" role="alert">
            {{ correctModelError }}
          </p>
        </div>
        <div class="space-y-1.5">
          <Label for="voice-correct-prompt" class="text-xs">Instructions</Label>
          <Textarea
            id="voice-correct-prompt"
            v-model="prompt"
            data-testid="voice-correct-prompt"
            spellcheck="false"
            class="max-h-80 min-h-40 text-xs md:text-xs"
            :aria-invalid="promptError ? true : undefined"
          />
          <p class="text-xs text-muted-foreground">
            Add the words and names the transcription gets wrong at the end, spelled correctly.
          </p>
          <div class="flex items-center gap-2">
            <Button
              data-testid="voice-correct-prompt-save"
              size="sm"
              :disabled="prompt === voice.correctPrompt"
              @click="savePrompt"
            >
              Save
            </Button>
            <Button
              data-testid="voice-correct-prompt-reset"
              variant="ghost"
              size="sm"
              class="text-muted-foreground"
              :disabled="voice.correctPrompt === DEFAULT_PROMPT && prompt === DEFAULT_PROMPT"
              title="Put the instructions back as they came"
              @click="resetPrompt"
            >
              Reset
            </Button>
            <span
              data-testid="voice-correct-prompt-length"
              class="ml-auto text-xs text-muted-foreground tabular-nums"
              :class="prompt.length > MAX_PROMPT && 'text-destructive'"
              >{{ prompt.length }} / {{ MAX_PROMPT }}</span
            >
          </div>
          <p v-if="promptError" class="text-xs text-destructive" role="alert">
            {{ promptError }}
          </p>
        </div>
      </template>
    </div>

    <div data-testid="voice-mic" class="space-y-1.5">
      <p class="text-xs font-medium">Microphone</p>
      <div class="flex items-center gap-2 text-xs">
        <template v-if="microphone === 'granted'">
          <CircleCheckIcon class="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
          <span>Allowed</span>
        </template>
        <template v-else>
          <CircleAlertIcon
            v-if="microphone === 'denied'"
            class="size-4 shrink-0 text-destructive"
            aria-hidden="true"
          />
          <MicOffIcon v-else class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            {{
              microphone === 'denied'
                ? 'Blocked for this extension. Grant shows how to allow it.'
                : 'Not allowed yet. Chrome asks once, in a tab.'
            }}
          </span>
          <Button
            data-testid="voice-mic-grant"
            variant="outline"
            size="sm"
            @click="openMicPermission"
          >
            Grant
          </Button>
        </template>
      </div>
    </div>
  </section>
</template>
