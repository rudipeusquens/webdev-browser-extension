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

/** An answer read whole: its status and its body parsed as JSON (null when it is not). */
interface Answer {
  ok: boolean
  status: number
  body: unknown
}

/**
 * Sends the request and reads the whole answer within the client timeout and the caller's
 * signal: a server that sends its headers and then stalls times out as well. A timeout becomes
 * a `timeout` failure, a network error `offline`; the caller's own abort passes through.
 */
async function call(
  path: string,
  init: RequestInit,
  { signal, fetch: fetchFn = globalThis.fetch }: Options,
): Promise<Answer> {
  signal?.throwIfAborted()
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, TIMEOUT)
  const forward = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', forward)
  // Settles when the request is aborted, whether or not fetch and the body notice.
  const aborted = new Promise<never>((_, reject) =>
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason)),
  )
  aborted.catch(() => undefined)
  try {
    const res = await Promise.race([
      fetchFn(`${OPENROUTER}/api/v1${path}`, {
        ...init,
        // To OpenRouter only, as asked: a redirect elsewhere fails instead of taking the key and
        // the audio along; no cookies, no referrer, nothing cached.
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      }),
      aborted,
    ])
    const text = await Promise.race([res.text(), aborted])
    let body: unknown = null
    try {
      body = JSON.parse(text)
    } catch {
      // Not JSON: no body to read.
    }
    return { ok: res.ok, status: res.status, body }
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
  const answer = await call(
    '/audio/transcriptions',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    options,
  )
  if (!answer.ok) {
    const code = codeOf(answer.status)
    throw new VoiceFailure(code, code === 'rejected' ? reasonOf(answer.body, key) : undefined)
  }
  const text = (answer.body as { text?: unknown } | null)?.text
  if (typeof text !== 'string') throw new VoiceFailure('failed')
  const trimmed = text.trim()
  if (!trimmed) throw new VoiceFailure('no-speech')
  return trimmed
}

/** Whether OpenRouter knows the key (`GET /key`, free). */
export async function checkKey(key: string, options: Options = {}): Promise<boolean> {
  const answer = await call('/key', { headers: { Authorization: `Bearer ${key}` } }, options)
  if (answer.ok) return true
  if (answer.status === 401 || answer.status === 403) return false
  throw new VoiceFailure('failed')
}
