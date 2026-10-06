// The recorder of the offscreen document (spec sections 5 and 9): records the microphone,
// stops at the limit, sends the audio to OpenRouter itself (a service worker is stopped when
// a fetch takes longer than 30 s) and keeps it for Retry. Browser APIs come in as `deps`, so
// the states are tested without a microphone.

import { type TranscribeRequest, VoiceFailure } from './openrouter'
import { LIMIT, type RecorderCommand, type RecorderMessage, type VoiceError } from './protocol'

export interface MediaRecorderLike {
  start(timeslice?: number): void
  stop(): void
  ondataavailable: ((e: BlobEvent) => void) | null
  onstop: ((e: Event) => void) | null
}

export interface RecorderDeps {
  /** The extension origin's microphone permission. */
  permission(): Promise<PermissionState>
  getUserMedia(): Promise<MediaStream>
  record(stream: MediaStream): MediaRecorderLike
  transcribe(audio: Blob, request: TranscribeRequest, signal: AbortSignal): Promise<string>
  emit(message: RecorderMessage): void
}

/** Opus in WebM, which OpenRouter takes; 32 kbit/s is plenty for speech. */
export const createMediaRecorder = (stream: MediaStream): MediaRecorderLike =>
  new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32_000 })

/** A chunk every second, so a stop loses nothing and the audio grows as it is recorded. */
const TIMESLICE = 1000

function micError(error: unknown): VoiceError {
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-mic'
  // Granted to the extension, refused by the system (macOS privacy settings, policies).
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'mic-blocked'
  return 'mic-failed'
}

type Phase = 'idle' | 'starting' | 'recording' | 'stopping' | 'transcribing' | 'held'

export function createRecorder(deps: RecorderDeps) {
  let phase: Phase = 'idle'
  /** Changes on every cancel: work that started before it finds out and stops. */
  let run = 0
  let stream: MediaStream | undefined
  let media: MediaRecorderLike | undefined
  let chunks: Blob[] = []
  let audio: { blob: Blob; atLimit: boolean } | undefined
  let limit: ReturnType<typeof setTimeout> | undefined
  let request: AbortController | undefined

  function release() {
    for (const track of stream?.getTracks() ?? []) track.stop()
    stream = undefined
  }

  /** Ends whatever runs; nothing that was under way reports back. */
  function reset() {
    run++
    clearTimeout(limit)
    if (media) {
      media.onstop = null
      media.ondataavailable = null
      try {
        media.stop()
      } catch {
        // Not recording any more.
      }
    }
    media = undefined
    release()
    request?.abort()
    request = undefined
    chunks = []
    audio = undefined
    phase = 'idle'
  }

  async function start(next: TranscribeRequest) {
    if (phase !== 'idle' && phase !== 'held') return
    reset()
    const mine = run
    phase = 'starting'
    deps.emit({ state: 'starting' })
    const fail = (error: VoiceError) => {
      phase = 'idle'
      deps.emit({ state: 'failed', error, retry: false })
    }
    const permission = await deps.permission().catch(() => 'granted' as const)
    if (mine !== run) return
    // The document cannot show Chrome's prompt; the microphone page asks once instead.
    if (permission === 'prompt') return fail('mic-not-granted')
    if (permission === 'denied') return fail('mic-blocked')
    let granted: MediaStream
    try {
      granted = await deps.getUserMedia()
    } catch (error) {
      if (mine === run) fail(micError(error))
      return
    }
    if (mine !== run) {
      for (const track of granted.getTracks()) track.stop()
      return
    }
    stream = granted
    let stopsAtLimit = false
    try {
      media = deps.record(granted)
      media.ondataavailable = (e) => chunks.push(e.data)
      media.onstop = () => {
        release()
        clearTimeout(limit)
        audio = { blob: new Blob(chunks, { type: 'audio/webm' }), atLimit: stopsAtLimit }
        chunks = []
        media = undefined
        // Audio goes out only after the developer's stop or the limit (spec principle 2). A
        // recording that ended by itself (device gone, permission revoked) waits for Retry.
        if (phase === 'stopping') return void send(next)
        phase = 'held'
        deps.emit({ state: 'failed', error: 'mic-lost', retry: true })
      }
      media.start(TIMESLICE)
    } catch {
      if (media) media.onstop = media.ondataavailable = null
      media = undefined
      release()
      return fail('mic-failed')
    }
    phase = 'recording'
    limit = setTimeout(() => {
      stopsAtLimit = true
      stop()
    }, LIMIT)
    deps.emit({ state: 'recording', limit: LIMIT })
  }

  function stop() {
    if (phase !== 'recording' || !media) return
    clearTimeout(limit)
    phase = 'stopping'
    media.stop()
  }

  async function send(with_: TranscribeRequest) {
    if (!audio) return
    const mine = run
    phase = 'transcribing'
    deps.emit({ state: 'transcribing' })
    request = new AbortController()
    try {
      const text = await deps.transcribe(audio.blob, with_, request.signal)
      if (mine !== run) return
      deps.emit({ state: 'done', text, atLimit: audio.atLimit })
      audio = undefined
      phase = 'idle'
    } catch (error) {
      if (mine !== run) return
      const code = error instanceof VoiceFailure ? error.code : 'failed'
      const retry = code !== 'no-speech'
      if (!retry) audio = undefined
      phase = retry ? 'held' : 'idle'
      deps.emit({
        state: 'failed',
        error: code,
        ...(error instanceof VoiceFailure && error.detail ? { detail: error.detail } : {}),
        retry,
      })
    } finally {
      if (mine === run) request = undefined
    }
  }

  return {
    command(c: RecorderCommand) {
      switch (c.type) {
        case 'start':
          void start(c.request)
          return
        case 'stop':
          stop()
          return
        case 'retry':
          if (phase === 'held') void send(c.request)
          return
        case 'cancel':
          reset()
          deps.emit({ state: 'idle' })
          return
      }
    },
    /** The port is gone: drop everything, report nothing. */
    stop: reset,
  }
}
