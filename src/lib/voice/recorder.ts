// The recorder of the offscreen document (spec sections 5 and 9): records the microphone,
// pauses at the limit until the developer answers, and turns each stopped recording into a
// job that it sends to OpenRouter itself (a service worker is stopped when a fetch takes
// longer than 30 s). The next recording may start while jobs are transcribed. A failed job
// keeps its audio for Retry, for a while. Browser APIs come in as `deps`, so the states are
// tested without a microphone.

import { type TranscribeRequest, timeoutFor, VoiceFailure } from './openrouter'
import { MAX_TEXT, type RecorderCommand, type RecorderMessage, type VoiceError } from './protocol'

export interface MediaRecorderLike {
  start(timeslice?: number): void
  stop(): void
  pause(): void
  resume(): void
  ondataavailable: ((e: BlobEvent) => void) | null
  onstop: ((e: Event) => void) | null
}

export interface RecorderDeps {
  /** The extension origin's microphone permission. */
  permission(): Promise<PermissionState>
  getUserMedia(): Promise<MediaStream>
  record(stream: MediaStream): MediaRecorderLike
  transcribe(
    audio: Blob,
    request: TranscribeRequest,
    signal: AbortSignal,
    timeout: number,
  ): Promise<string>
  emit(message: RecorderMessage): void
}

/** Opus in WebM, which OpenRouter takes; 32 kbit/s is plenty for speech. */
export const createMediaRecorder = (stream: MediaStream): MediaRecorderLike =>
  new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32_000 })

/** A chunk every second, so a stop loses nothing and the audio grows as it is recorded. */
const TIMESLICE = 1000
/** How long a failed job keeps its audio for Retry, and how much audio all of them keep. */
export const HOLD_TIME = 10 * 60_000
export const HOLD_BYTES = 20_000_000

function micError(error: unknown): VoiceError {
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-mic'
  // Granted to the extension, refused by the system (macOS privacy settings, policies).
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'mic-blocked'
  return 'mic-failed'
}

/** At most `max` code points. */
function cut(text: string, max: number): { text: string; cut: boolean } {
  const points = [...text]
  return points.length > max
    ? { text: points.slice(0, max).join(''), cut: true }
    : { text, cut: false }
}

type Phase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'held'

interface Job {
  audio: Blob
  /** How long the recording ran: the timeout grows with it. */
  ms: number
  controller?: AbortController
  /** A failure that keeps the audio for Retry, since `at`. */
  held?: { at: number; error: VoiceError; detail?: string }
}

export function createRecorder(deps: RecorderDeps) {
  let phase: Phase = 'idle'
  /** Changes whenever the recording ends: work that started before it finds out and stops. */
  let run = 0
  let stream: MediaStream | undefined
  let media: MediaRecorderLike | undefined
  let chunks: Blob[] = []
  let limit = 0
  let limitTimer: ReturnType<typeof setTimeout> | undefined
  /** Recorded before the stretch that runs now, and when that stretch began. */
  let elapsed = 0
  let since = 0
  /** Where the recording goes once the browser hands over its last chunk. */
  let stopping: { job: string; request: TranscribeRequest } | undefined
  /** A recording that ended by itself, until a stop sends it or a start or cancel drops it. */
  let held: { audio: Blob; ms: number } | undefined
  const jobs = new Map<string, Job>()
  let expiry: ReturnType<typeof setTimeout> | undefined

  const recorded = () => elapsed + (phase === 'recording' ? Date.now() - since : 0)

  function release() {
    for (const track of stream?.getTracks() ?? []) track.stop()
    stream = undefined
  }

  /** Ends the recording; nothing that was under way for it reports back. */
  function endRecording() {
    run++
    clearTimeout(limitTimer)
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
    chunks = []
    stopping = undefined
    held = undefined
    elapsed = 0
    phase = 'idle'
  }

  function armLimit() {
    clearTimeout(limitTimer)
    limitTimer = setTimeout(pause, limit)
  }

  /** A stopped recording becomes the job `id`, transcribed now. */
  function hand(id: string, audio: Blob, ms: number, request: TranscribeRequest) {
    phase = 'idle'
    elapsed = 0
    deps.emit({ state: 'idle' })
    jobs.set(id, { audio, ms })
    void send(id, request)
  }

  async function start(next: number) {
    if (phase !== 'idle' && phase !== 'held') return
    endRecording()
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
    try {
      const recording = deps.record(granted)
      media = recording
      recording.ondataavailable = (e) => chunks.push(e.data)
      recording.onstop = () => {
        const ms = recorded()
        release()
        clearTimeout(limitTimer)
        const audio = new Blob(chunks, { type: 'audio/webm' })
        chunks = []
        media = undefined
        // Audio goes out only after the developer's stop (spec principle 2). A recording
        // that ended by itself (device gone, permission revoked) waits for a stop or a cancel.
        const to = stopping
        stopping = undefined
        if (phase === 'stopping' && to) return hand(to.job, audio, ms, to.request)
        held = { audio, ms }
        phase = 'held'
        deps.emit({ state: 'failed', error: 'mic-lost', retry: true })
      }
      recording.start(TIMESLICE)
    } catch {
      if (media) media.onstop = media.ondataavailable = null
      media = undefined
      release()
      return fail('mic-failed')
    }
    phase = 'recording'
    limit = next
    elapsed = 0
    since = Date.now()
    armLimit()
    deps.emit({ state: 'recording', limit, elapsed: 0 })
  }

  /** The limit: the recording waits for the developer's answer (resume, stop or cancel). */
  function pause() {
    if (phase !== 'recording' || !media) return
    elapsed = recorded()
    phase = 'paused'
    media.pause()
    deps.emit({ state: 'paused', elapsed })
  }

  function resume() {
    if (phase !== 'paused' || !media) return
    media.resume()
    since = Date.now()
    phase = 'recording'
    armLimit()
    deps.emit({ state: 'recording', limit, elapsed })
  }

  function stop(job: string, request: TranscribeRequest) {
    if ((phase === 'recording' || phase === 'paused') && media) {
      elapsed = recorded()
      clearTimeout(limitTimer)
      phase = 'stopping'
      stopping = { job, request }
      media.stop()
      return
    }
    if (phase === 'held' && held) {
      const { audio, ms } = held
      held = undefined
      return hand(job, audio, ms, request)
    }
    if (phase === 'stopping') return
    // Nothing recorded yet (the microphone still starts) or nothing at all: the job ends now.
    endRecording()
    deps.emit({ state: 'idle' })
    deps.emit({ job, state: 'failed', error: 'no-speech', retry: false })
  }

  async function send(id: string, request: TranscribeRequest) {
    const job = jobs.get(id)
    if (!job) return
    job.held = undefined
    job.controller?.abort()
    const controller = new AbortController()
    job.controller = controller
    deps.emit({ job: id, state: 'transcribing' })
    const current = () => jobs.get(id) === job && job.controller === controller
    try {
      const answer = await deps.transcribe(
        job.audio,
        request,
        controller.signal,
        timeoutFor(job.ms),
      )
      if (!current()) return
      jobs.delete(id)
      deps.emit({ job: id, state: 'done', ...cut(answer, MAX_TEXT) })
    } catch (error) {
      if (!current()) return
      job.controller = undefined
      const code = error instanceof VoiceFailure ? error.code : 'failed'
      const detail = error instanceof VoiceFailure ? error.detail : undefined
      const retry = code !== 'no-speech'
      if (retry) job.held = { at: Date.now(), error: code, ...(detail ? { detail } : {}) }
      else jobs.delete(id)
      deps.emit({ job: id, state: 'failed', error: code, ...(detail ? { detail } : {}), retry })
      if (retry) keepHeld()
    }
  }

  /** Held audio within its time and size: the rest gives up its Retry, oldest first. */
  function keepHeld() {
    clearTimeout(expiry)
    const now = Date.now()
    const holding = [...jobs]
      .filter(([, job]) => job.held)
      .sort(([, a], [, b]) => (a.held?.at ?? 0) - (b.held?.at ?? 0))
    let bytes = holding.reduce((sum, [, job]) => sum + job.audio.size, 0)
    for (const [id, job] of holding) {
      const { at = 0, error = 'failed', detail } = job.held ?? {}
      if (now - at < HOLD_TIME && bytes <= HOLD_BYTES) continue
      bytes -= job.audio.size
      jobs.delete(id)
      deps.emit({ job: id, state: 'failed', error, ...(detail ? { detail } : {}), retry: false })
    }
    const next = [...jobs.values()].reduce(
      (soonest, job) => (job.held ? Math.min(soonest, job.held.at + HOLD_TIME) : soonest),
      Infinity,
    )
    if (next !== Infinity) expiry = setTimeout(keepHeld, Math.max(0, next - now))
  }

  function drop(id: string) {
    const job = jobs.get(id)
    if (!job) return
    job.controller?.abort()
    jobs.delete(id)
  }

  return {
    command(c: RecorderCommand) {
      switch (c.type) {
        case 'start':
          void start(c.limit)
          return
        case 'resume':
          resume()
          return
        case 'stop':
          stop(c.job, c.request)
          return
        case 'cancel':
          endRecording()
          deps.emit({ state: 'idle' })
          return
        case 'retry':
          if (jobs.get(c.job)?.held) void send(c.job, c.request)
          return
        case 'drop':
          drop(c.job)
          return
      }
    },
    /** The port is gone: drop everything, report nothing. */
    stop() {
      endRecording()
      clearTimeout(expiry)
      for (const id of [...jobs.keys()]) drop(id)
    },
  }
}
