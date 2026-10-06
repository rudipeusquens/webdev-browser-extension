// OpenRouter's speech-to-text API (spec section 9). The only remote calls of the extension:
// the transcription of a recording the developer stopped, and the free key check. Failures
// carry a code and OpenRouter's reason, never the key.

import { clean } from '../text'
import type { VoiceError } from './protocol'

/** The one place the origin is written: test builds rewrite it in a copy of the build. */
export const OPENROUTER = 'https://openrouter.ai'
/** Client timeout per request. */
export const TIMEOUT = 65_000
/** Longest reason from OpenRouter the popover shows. */
const DETAIL = 200

export interface TranscribeRequest {
  key: string
  model: string
  /** `auto`, or an ISO-639-1 code. */
  language: string
}

interface Options {
  signal?: AbortSignal
  fetch?: typeof fetch
}

export class VoiceFailure extends Error {
  override name = 'VoiceFailure'

  constructor(
    readonly code: VoiceError,
    readonly detail?: string,
  ) {
    super(code)
  }
}

/** Base64 of the blob's bytes, in slices: one spread of megabytes overflows the stack. */
async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** OpenRouter's reason, as one line of text without the key. */
function reasonOf(body: unknown, key: string): string | undefined {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message
  if (typeof message !== 'string') return undefined
  return clean(message.split(key).join('…'), DETAIL) || undefined
}

function codeOf(status: number): VoiceError {
  if (status === 401 || status === 403) return 'invalid-key'
  if (status === 402) return 'no-credits'
  if (status === 429) return 'rate-limited'
  if (status === 400 || status === 404 || status === 422) return 'rejected'
  return 'failed'
}

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError'

/**
 * Runs `request` with the client timeout and the caller's signal. A timeout becomes a
 * `timeout` failure, a network error `offline`; the caller's own abort passes through.
 */
async function call(
  path: string,
  init: RequestInit,
  { signal, fetch: fetchFn = globalThis.fetch }: Options,
): Promise<Response> {
  signal?.throwIfAborted()
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, TIMEOUT)
  const forward = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', forward)
  try {
    return await fetchFn(`${OPENROUTER}/api/v1${path}`, { ...init, signal: controller.signal })
  } catch (error) {
    if (timedOut) throw new VoiceFailure('timeout')
    if (signal?.aborted) throw signal.reason
    if (isAbort(error)) throw error
    throw new VoiceFailure('offline')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forward)
  }
}

/** The transcript of `audio` (WebM/Opus), trimmed; a `VoiceFailure` otherwise. */
export async function transcribe(
  audio: Blob,
  request: TranscribeRequest,
  options: Options = {},
): Promise<string> {
  const { key, model, language } = request
  const body = {
    model,
    input_audio: { data: await base64(audio), format: 'webm' },
    ...(language === 'auto' ? {} : { language }),
    provider: { data_collection: 'deny' },
  }
  const res = await call(
    '/audio/transcriptions',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    options,
  )
  const answer: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const code = codeOf(res.status)
    throw new VoiceFailure(code, code === 'rejected' ? reasonOf(answer, key) : undefined)
  }
  const text = (answer as { text?: unknown } | null)?.text
  if (typeof text !== 'string') throw new VoiceFailure('failed')
  const trimmed = text.trim()
  if (!trimmed) throw new VoiceFailure('no-speech')
  return trimmed
}

/** Whether OpenRouter knows the key (`GET /key`, free). */
export async function checkKey(key: string, options: Options = {}): Promise<boolean> {
  const res = await call('/key', { headers: { Authorization: `Bearer ${key}` } }, options)
  if (res.ok) return true
  if (res.status === 401 || res.status === 403) return false
  throw new VoiceFailure('failed')
}
