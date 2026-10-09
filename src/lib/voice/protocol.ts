// Dictation (spec sections 5 and 9): the messages between popover or panel, background and
// recorder, what can go wrong, and how the popover and the panel say it. Every receiver checks
// shapes with these guards.

import { hasKeys, isAnnotationId, isObject, isText } from '../collection/validate'
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
  | 'lost'

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
  // The browser or the extension restarted while a recording was transcribed.
  lost: 'The transcription was interrupted.',
}

export const VOICE_ERRORS = Object.keys(TEXTS) as VoiceError[]

/** The popover's message; `detail` is OpenRouter's reason for a refused request. */
export function voiceErrorText(error: VoiceError, detail?: string): string {
  return error === 'rejected' && detail ? `Transcription failed: ${detail}` : TEXTS[error]
}

/** What a failed dictation says, and which of Retry, Grant and Open settings help. */
export interface DictationFailure {
  text: string
  retry: boolean
  grant: boolean
  settings: boolean
}

/** For a recording's state, or a pin's or note's stored job (src/lib/voice/jobs.ts). */
export function dictationFailure(now: VoiceState | { state: string }): DictationFailure | null {
  if (now.state !== 'failed') return null
  const { error, detail, retry } = now as Failed
  return {
    text: voiceErrorText(error, detail),
    retry,
    grant: error === 'mic-not-granted' || error === 'mic-blocked',
    // A refused request is most often a model OpenRouter does not know.
    settings: error === 'no-key' || error === 'invalid-key' || error === 'rejected',
  }
}

/** The port to the background: one per overlay, one for the panel's Rec. */
export const VOICE_PORT = 'voice'
/** The offscreen recorder's port to the background. */
export const RECORDER_PORT = 'recorder'
/** Longest transcript a job carries: the recorder cuts what goes beyond it. */
export const MAX_TEXT = 20_000
/** Longest reason from OpenRouter (see openrouter.ts). */
const MAX_DETAIL = 200
/** The limits a recording may pause at, in milliseconds (Settings offers minutes). */
export const MIN_LIMIT = 10_000
export const MAX_LIMIT = 3_600_000

/** Where a stopped recording's text goes: after a pin's comment, or into a new Rec note. */
export type Keep = { pin: string } | { note: true }
/** Where it went: the pin, or the note the background made for it. */
export type HandedTo = { pin: string } | { note: string }

type Failed = { state: 'failed'; error: VoiceError; detail?: string; retry: boolean }

/** The recording, as the recorder reports it: what runs now, never a transcription. */
export type RecordingState =
  | { state: 'idle' }
  | { state: 'starting' }
  /** `limit`: when the recording pauses to ask; `elapsed`: what was recorded before. */
  | { state: 'recording'; limit: number; elapsed: number }
  | { state: 'paused'; elapsed: number }
  /** Before the developer's stop: the microphone, or a recording that ended by itself. */
  | Failed

/**
 * Background → popover or panel. A recording ends in exactly one of `handed` (its audio is a
 * job now, transcribed in the background), `idle` (cancelled, or nothing was recorded) or
 * `failed`. `yield`: another recording wants to start; hand this one over now.
 */
export type VoiceState = RecordingState | { state: 'handed'; to: HandedTo } | { state: 'yield' }

/**
 * Popover or panel → background. Neither names a key, a model or a limit: the background
 * reads them.
 */
export type VoiceCommand = { type: 'start' | 'resume' | 'cancel' } | { type: 'stop'; keep: Keep }

/** Background → recorder: what to record, and the key, model and language of each job. */
export type RecorderCommand =
  | { type: 'start'; limit: number }
  | { type: 'resume' }
  | { type: 'cancel' }
  | { type: 'stop'; job: string; request: TranscribeRequest }
  | { type: 'retry'; job: string; request: TranscribeRequest }
  | { type: 'drop'; job: string }

/** Recorder → background: what became of a stopped recording. */
export type JobEvent =
  | { job: string; state: 'transcribing' }
  | { job: string; state: 'done'; text: string; cut: boolean }
  | ({ job: string } & Failed)

/** Recorder → background: the recording, its jobs, and a heartbeat that keeps it alive. */
export type RecorderMessage = RecordingState | JobEvent | { state: 'alive' }

const isRequest = (x: unknown): x is TranscribeRequest =>
  hasKeys(x, ['key', 'model', 'language']) &&
  isApiKey(x.key) &&
  isModelId(x.model) &&
  isLanguage(x.language)

const isMs = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0
export const isLimit = (x: unknown): x is number =>
  Number.isInteger(x) && (x as number) >= MIN_LIMIT && (x as number) <= MAX_LIMIT

function isFailure(x: Record<string, unknown>, extra: string[] = []): boolean {
  return (
    hasKeys(x, ['state', 'error', 'retry', ...extra], ['detail']) &&
    VOICE_ERRORS.includes(x.error as VoiceError) &&
    typeof x.retry === 'boolean' &&
    (x.detail === undefined || isText(x.detail, MAX_DETAIL, 1))
  )
}

function isRecordingState(x: unknown): x is RecordingState {
  if (!isObject(x)) return false
  switch (x.state) {
    case 'idle':
    case 'starting':
      return hasKeys(x, ['state'])
    case 'recording':
      return (
        hasKeys(x, ['state', 'limit', 'elapsed']) &&
        Number.isInteger(x.limit) &&
        (x.limit as number) > 0 &&
        isMs(x.elapsed)
      )
    case 'paused':
      return hasKeys(x, ['state', 'elapsed']) && isMs(x.elapsed)
    case 'failed':
      return isFailure(x)
    default:
      return false
  }
}

const isHandedTo = (x: unknown): x is HandedTo =>
  (hasKeys(x, ['pin']) && isAnnotationId(x.pin)) || (hasKeys(x, ['note']) && isAnnotationId(x.note))

export function isVoiceState(x: unknown): x is VoiceState {
  if (!isObject(x)) return false
  if (x.state === 'handed') return hasKeys(x, ['state', 'to']) && isHandedTo(x.to)
  if (x.state === 'yield') return hasKeys(x, ['state'])
  return isRecordingState(x)
}

export function isJobEvent(x: unknown): x is JobEvent {
  if (!isObject(x) || !isAnnotationId(x.job)) return false
  switch (x.state) {
    case 'transcribing':
      return hasKeys(x, ['job', 'state'])
    case 'done':
      return (
        hasKeys(x, ['job', 'state', 'text', 'cut']) &&
        isText(x.text, MAX_TEXT) &&
        typeof x.cut === 'boolean'
      )
    case 'failed':
      return isFailure(x, ['job'])
    default:
      return false
  }
}

export function isRecorderMessage(x: unknown): x is RecorderMessage {
  return isRecordingState(x) || isJobEvent(x) || (hasKeys(x, ['state']) && x.state === 'alive')
}

const isKeep = (x: unknown): x is Keep =>
  (hasKeys(x, ['pin']) && isAnnotationId(x.pin)) || (hasKeys(x, ['note']) && x.note === true)

export function isVoiceCommand(x: unknown): x is VoiceCommand {
  if (!isObject(x)) return false
  if (x.type === 'stop') return hasKeys(x, ['type', 'keep']) && isKeep(x.keep)
  return hasKeys(x, ['type']) && (x.type === 'start' || x.type === 'resume' || x.type === 'cancel')
}

export function isRecorderCommand(x: unknown): x is RecorderCommand {
  if (!isObject(x)) return false
  switch (x.type) {
    case 'start':
      return hasKeys(x, ['type', 'limit']) && isLimit(x.limit)
    case 'resume':
    case 'cancel':
      return hasKeys(x, ['type'])
    case 'stop':
    case 'retry':
      return hasKeys(x, ['type', 'job', 'request']) && isAnnotationId(x.job) && isRequest(x.request)
    case 'drop':
      return hasKeys(x, ['type', 'job']) && isAnnotationId(x.job)
    default:
      return false
  }
}
