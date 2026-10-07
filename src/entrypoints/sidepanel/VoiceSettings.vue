<script setup lang="ts">
import { CircleAlertIcon, CircleCheckIcon, MicOffIcon, Trash2Icon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { browser } from 'wxt/browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import type { KeyTestReply, Reply, VoiceSettingsMessage } from '@/lib/messages'
import { isApiKey, isModelId, LANGUAGES, MODELS } from '@/lib/voice/settings'
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

function setVoice(model: string, language: string) {
  void send({ type: 'voice:set', model, language })
}

const modelChoice = computed({
  get: () => choice.value,
  set(value: unknown) {
    const model = String(value)
    choice.value = model
    modelError.value = ''
    if (model !== 'custom') setVoice(model, voice.value.language)
  },
})

function saveCustom() {
  const model = customModel.value.trim()
  if (!isModelId(model)) {
    modelError.value = 'Use an OpenRouter model id such as vendor/model.'
    return
  }
  modelError.value = ''
  setVoice(model, voice.value.language)
}

const language = computed({
  get: () => voice.value.language,
  set: (value: unknown) => setVoice(voice.value.model, String(value)),
})

function grant() {
  void browser.tabs.create({ url: browser.runtime.getURL('/mic-permission.html') })
}
</script>

<template>
  <section data-testid="voice-settings" class="space-y-4">
    <div class="space-y-1">
      <h3 class="text-xs font-medium text-muted-foreground">Voice</h3>
      <p class="text-xs text-muted-foreground">
        Dictate a comment with the mic button next to Save, or Alt+V; anything else with Rec, which
        copies the text. Only the recording leaves the browser: it goes to OpenRouter with your own
        key, with data collection turned off.
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
          <Button data-testid="voice-mic-grant" variant="outline" size="sm" @click="grant">
            Grant
          </Button>
        </template>
      </div>
    </div>
  </section>
</template>
