// Dictation settings (spec section 9), under their own storage key: each malformed or missing
// field falls back to its default without touching the others or the remembered sites. Only
// the background writes them.

import { browser } from 'wxt/browser'
import { hasKeys, isObject } from '../collection/validate'
import { isLimit } from './protocol'

export interface VoiceSettings {
  /** OpenRouter model id, `vendor/name`. */
  model: string
  /** `auto` (detected by the model), or an ISO-639-1 code. */
  language: string
  /** Milliseconds a recording runs before it pauses to ask whether to go on. */
  limit: number
}

export const VOICE_KEY = 'voice'
export const DEFAULT_MODEL = 'openai/gpt-4o-mini-transcribe'
export const DEFAULT_LIMIT = 300_000
/** The limits Settings offers, in milliseconds: 1, 2, 3, 5, 10 and 15 minutes. */
export const LIMIT_CHOICES: readonly number[] = [1, 2, 3, 5, 10, 15].map((m) => m * 60_000)

/** The short list of the settings, the default first (spec section 9). */
export const MODELS: readonly { id: string; label: string }[] = [
  { id: DEFAULT_MODEL, label: 'GPT-4o mini Transcribe (default)' },
  { id: 'openai/gpt-4o-transcribe', label: 'GPT-4o Transcribe' },
  { id: 'openai/whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo' },
  { id: 'mistralai/voxtral-mini-transcribe', label: 'Voxtral Mini Transcribe' },
]

export const LANGUAGES: readonly { code: string; label: string }[] = [
  { code: 'auto', label: 'Detect automatically' },
  { code: 'en', label: 'English' },
  { code: 'de', label: 'German' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'cs', label: 'Czech' },
  { code: 'sv', label: 'Swedish' },
  { code: 'da', label: 'Danish' },
  { code: 'no', label: 'Norwegian' },
  { code: 'fi', label: 'Finnish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ru', label: 'Russian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
]

const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i

export const isModelId = (x: unknown): x is string =>
  typeof x === 'string' && x.length <= 100 && MODEL_ID.test(x)

export const isLanguage = (x: unknown): x is string =>
  x === 'auto' || (typeof x === 'string' && /^[a-z]{2}$/.test(x))

/** An OpenRouter key as far as its shape goes: visible ASCII, no spaces. */
export const isApiKey = (x: unknown): x is string =>
  typeof x === 'string' && /^[\x21-\x7e]{8,256}$/.test(x)

export function isVoiceSettings(x: unknown): x is VoiceSettings {
  return (
    hasKeys(x, ['model', 'language', 'limit']) &&
    isModelId(x.model) &&
    isLanguage(x.language) &&
    isLimit(x.limit)
  )
}

export const defaultVoiceSettings = (): VoiceSettings => ({
  model: DEFAULT_MODEL,
  language: 'auto',
  limit: DEFAULT_LIMIT,
})

/** Each field as stored when it is well-formed, else its default. */
function parse(value: unknown): VoiceSettings {
  const fields = isObject(value) ? value : {}
  return {
    model: isModelId(fields.model) ? fields.model : DEFAULT_MODEL,
    language: isLanguage(fields.language) ? fields.language : 'auto',
    limit: isLimit(fields.limit) ? fields.limit : DEFAULT_LIMIT,
  }
}

export async function loadVoiceSettings(): Promise<VoiceSettings> {
  const stored = await browser.storage.local.get(VOICE_KEY)
  return parse(stored[VOICE_KEY])
}

/** Calls `cb` with the new voice settings whenever they change; returns a function that stops. */
export function watchVoiceSettings(cb: (settings: VoiceSettings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const change = changes[VOICE_KEY]
    if (area === 'local' && change) cb(parse(change.newValue))
  }
  browser.storage.onChanged.addListener(listener)
  return () => browser.storage.onChanged.removeListener(listener)
}
