// Dictation (spec sections 5 and 9): the messages between popover or panel, background and
// recorder, what can go wrong, and how the popover and the panel say it. Every receiver checks
// shapes with these guards.

import { hasKeys, isObject, isText } from '../collection/validate'
import type { TranscribeRequest } from './openrouter'
import { isApiKey, isLanguage, isModelId } from './settings'

export type VoiceError =
  | 'no-key'
  | 'mic-not-granted'
  | 'mic-blocked'
  | 'no-mic'
  | 'mic-failed'
  | 'invalid-key'
  | 'no-credits'
  | 'rate-limited'
  | 'rejected'
  | 'failed'
  | 'timeout'
  | 'offline'
  | 'no-speech'
  | 'interrupted'
  | 'taken'
  | 'mic-lost'

const TEXTS: Record<VoiceError, string> = {
  'no-key': 'Add an OpenRouter API key in settings.',
  'mic-not-granted': 'Allow the microphone first.',
  'mic-blocked': 'The microphone is blocked for this extension.',
  'no-mic': 'No microphone found.',
  'mic-failed': 'The microphone could not start.',
  'invalid-key': 'Invalid API key.',
  'no-credits': 'Out of credits.',
  'rate-limited': 'Rate limited, try again.',
  rejected: 'Transcription failed.',
  failed: 'Transcription failed.',
  timeout: 'Transcription timed out.',
  offline: 'Could not reach OpenRouter.',
  'no-speech': 'No speech detected.',
  interrupted: 'Recording stopped unexpectedly.',
  // Also a recording held for Retry ends when another dictation starts.
  taken: 'Another dictation started, this one ended.',
  'mic-lost': 'The microphone stopped. Retry sends what was recorded.',
}

export const VOICE_ERRORS = Object.keys(TEXTS) as VoiceError[]

/** The popover's message; `detail` is OpenRouter's reason for a refused request. */
export function voiceErrorText(error: VoiceError, detail?: string): string {
  return error === 'rejected' && detail ? `Transcription failed: ${detail}` : TEXTS[error]
}

/** The port to the background: one per comment popover that dictates, one for the panel's Rec. */
export const VOICE_PORT = 'voice'
/** The offscreen recorder's port to the background. */
export const RECORDER_PORT = 'recorder'
/** Recordings stop by themselves after two minutes. */
export const LIMIT = 120_000
/** Longest transcript a state carries; two minutes of speech are far below it. */
const MAX_TEXT = 20_000
/** Longest reason from OpenRouter (see openrouter.ts). */
const MAX_DETAIL = 200

/** Background → popover or panel, and recorder → background. */
export type VoiceState =
  | { state: 'idle' }
  | { state: 'starting' }
  | { state: 'recording'; limit: number }
  | { state: 'transcribing' }
  | { state: 'done'; text: string; atLimit: boolean }
  | { state: 'failed'; error: VoiceError; detail?: string; retry: boolean }

/**
 * Popover or panel → background. Neither names a key or a model: the background reads them.
 */
export type VoiceCommand = { type: 'start' | 'stop' | 'cancel' | 'retry' }

/** Background → recorder: what to record, and with which key, model and language. */
export type RecorderCommand =
  | { type: 'start'; request: TranscribeRequest }
  | { type: 'stop' }
  | { type: 'cancel' }
  | { type: 'retry'; request: TranscribeRequest }

/** Recorder → background: its states, and a heartbeat that keeps the service worker alive. */
export type RecorderMessage = VoiceState | { state: 'alive' }

const isRequest = (x: unknown): x is TranscribeRequest =>
  hasKeys(x, ['key', 'model', 'language']) &&
  isApiKey(x.key) &&
  isModelId(x.model) &&
  isLanguage(x.language)

export function isVoiceState(x: unknown): x is VoiceState {
  if (!isObject(x)) return false
  switch (x.state) {
    case 'idle':
    case 'starting':
    case 'transcribing':
      return hasKeys(x, ['state'])
    case 'recording':
      return hasKeys(x, ['state', 'limit']) && Number.isInteger(x.limit) && (x.limit as number) > 0
    case 'done':
      return (
        hasKeys(x, ['state', 'text', 'atLimit']) &&
        isText(x.text, MAX_TEXT) &&
        typeof x.atLimit === 'boolean'
      )
    case 'failed':
      return (
        hasKeys(x, ['state', 'error', 'retry'], ['detail']) &&
        VOICE_ERRORS.includes(x.error as VoiceError) &&
        typeof x.retry === 'boolean' &&
        (x.detail === undefined || isText(x.detail, MAX_DETAIL, 1))
      )
    default:
      return false
  }
}

export function isRecorderMessage(x: unknown): x is RecorderMessage {
  return isVoiceState(x) || (hasKeys(x, ['state']) && x.state === 'alive')
}

export function isVoiceCommand(x: unknown): x is VoiceCommand {
  return (
    hasKeys(x, ['type']) &&
    (x.type === 'start' || x.type === 'stop' || x.type === 'cancel' || x.type === 'retry')
  )
}

export function isRecorderCommand(x: unknown): x is RecorderCommand {
  if (!isObject(x)) return false
  switch (x.type) {
    case 'start':
    case 'retry':
      return hasKeys(x, ['type', 'request']) && isRequest(x.request)
    case 'stop':
    case 'cancel':
      return hasKeys(x, ['type'])
    default:
      return false
  }
}
