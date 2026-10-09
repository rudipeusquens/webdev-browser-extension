// The recorder of the offscreen document (spec sections 5 and 9): records the microphone,
// pauses at the limit until the developer answers (each stretch between limits is sent on its
// own: a model's answer has a length limit, about twelve minutes of speech for the default
// one), and turns each stopped recording into a job that it sends to OpenRouter itself (a service worker is stopped when a fetch takes
// longer than 30 s). The next recording may start while jobs are transcribed. A failed job
// keeps its audio for Retry, for a while. Browser APIs come in as `deps`, so the states are
// tested without a microphone.

import { type TranscribeRequest, timeoutFor, VoiceFailure } from './openrouter'
import { MAX_TEXT, type RecorderCommand, type RecorderMessage, type VoiceError } from './protocol'

export interface MediaRecorderLike {
  start(timeslice?: number): void
  stop(): void
  ondataavailable: ((e: BlobEvent) => void) | null
  onstop: ((e: Event) => void) | null
}

/** The microphone's level, for the pauses where a long recording is cut into parts. */
export interface LevelMonitor {
  /** RMS of the last moment, 0 to 1. */
  level(): number
  stop(): void
}

export interface RecorderDeps {
  /** Watches the microphone's level; without it, parts are cut at PART_HARD. */
  monitor?(stream: MediaStream): LevelMonitor
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

/** A stretch of one recording, up to a limit: a model transcribes it in one go. */
interface Segment {
  audio: Blob
  ms: number
}

interface Job {
  segments: Segment[]
  controller?: AbortController
  /** A failure that keeps the audio for Retry, since `at`. */
  held?: { at: number; error: VoiceError; detail?: string }
}

const sizeOf = (segments: Segment[]) => segments.reduce((sum, s) => sum + s.audio.size, 0)

/**
 * A part is cut in the first pause after PART_SOFT, and at PART_HARD at the latest: a model
 * answers with a limited length (2048 tokens for the default one: a 10-minute German recording
 * lost its last minute and a half in a live check on 2026-10-09), so no part is sent longer.
 */
export const PART_SOFT = 4 * 60_000
export const PART_HARD = 5 * 60_000
/** Quieter than this (RMS, 0 to 1) for QUIET_FOR is a pause. */
const QUIET_LEVEL = 0.02
const QUIET_FOR = 400
const WATCH_EVERY = 200

export function createRecorder(deps: RecorderDeps) {
  let phase: Phase = 'idle'
  /** Changes whenever the recording ends: work that started before it finds out and stops. */
  let run = 0
  let stream: MediaStream | undefined
  let monitor: LevelMonitor | undefined
  /** The media recorder of the part that records, or finishes at a limit or a stop, now. */
  let media: MediaRecorderLike | undefined
  /**
   * The recording's parts in order, each slot filled once its media recorder handed over its
   * last chunk; `pending` of them are not filled yet.
   */
  let parts: (Segment | undefined)[] = []
  let pending = 0
  /** When a part that was cut (not at a limit or a stop) ended. */
  const cutAt = new WeakMap<MediaRecorderLike, number>()
  let limit = 0
  let limitTimer: ReturnType<typeof setTimeout> | undefined
  let watch: ReturnType<typeof setInterval> | undefined
  /** Since when the microphone has been quiet, while a part may be cut. */
  let quietSince: number | undefined
  /** Recorded before the stretch that runs now, and when that stretch began. */
  let elapsed = 0
  let since = 0
  /** Keep came while the part the limit ended still handed over its last chunk. */
  let resumeWaits = false
  /** Where the recording goes once every part handed over its last chunk. */
  let stopping: { job: string; request: TranscribeRequest } | undefined
  /** A start that came while the last recording still stopped: its limit. */
  let queued: number | undefined
  const jobs = new Map<string, Job>()
  let expiry: ReturnType<typeof setTimeout> | undefined

  const recorded = () => elapsed + (phase === 'recording' ? Date.now() - since : 0)

  function release() {
    clearInterval(watch)
    watch = undefined
    monitor?.stop()
    monitor = undefined
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
    parts = []
    pending = 0
    stopping = undefined
    resumeWaits = false
    quietSince = undefined
    elapsed = 0
    phase = 'idle'
  }

  function armLimit() {
    clearTimeout(limitTimer)
    limitTimer = setTimeout(pause, limit)
  }

  /** Cuts a part in the first pause after PART_SOFT, at PART_HARD at the latest. */
  function watchParts() {
    clearInterval(watch)
    quietSince = undefined
    watch = setInterval(() => {
      if (phase !== 'recording' || !media) return
      const from = parts.length ? partStart : 0
      const length = recorded() - from
      if (length >= PART_HARD) return splitPart()
      if (length < PART_SOFT || (monitor?.level() ?? 1) >= QUIET_LEVEL) {
        quietSince = undefined
        return
      }
      quietSince ??= Date.now()
      if (Date.now() - quietSince >= QUIET_FOR) splitPart()
    }, WATCH_EVERY)
  }

  /** Where the part that records now began, in recorded time. */
  let partStart = 0

  /**
   * A stopped recording becomes the job `id`, transcribed now. The recording's end says
   * nothing: the background took it already, and the next recording may be someone else's.
   */
  function hand(id: string, recorded: Segment[], request: TranscribeRequest) {
    phase = 'idle'
    elapsed = 0
    parts = []
    release()
    jobs.set(id, { segments: recorded })
    void send(id, request)
    const next = queued
    queued = undefined
    if (next !== undefined) void start(next)
  }

  /** Records a part on the open stream, from `from` in recorded time; false when refused. */
  function record(from: number): boolean {
    if (!stream) return false
    let recording: MediaRecorderLike | undefined
    try {
      recording = deps.record(stream)
      const chunks: Blob[] = []
      recording.ondataavailable = (e) => chunks.push(e.data)
      recording.start(TIMESLICE)
      const slot = parts.push(undefined) - 1
      pending++
      const mine = recording
      const current = run
      recording.onstop = () => {
        if (current === run) partEnded(mine, slot, chunks, from)
      }
      media = recording
      partStart = from
      return true
    } catch {
      if (recording) recording.onstop = recording.ondataavailable = null
      return false
    }
  }

  /** The next part starts before this one ends: nothing between them is lost. */
  function splitPart() {
    const old = media
    if (!old) return
    const at = recorded()
    if (!record(at)) return
    cutAt.set(old, at)
    quietSince = undefined
    try {
      old.stop()
    } catch {
      // Gone already: its last chunks are lost, the rest is kept.
    }
  }

  /** A part handed over its last chunk: cut, at the limit, at a stop, or by itself. */
  function partEnded(recording: MediaRecorderLike, slot: number, chunks: Blob[], from: number) {
    pending--
    const ownEnd = phase === 'paused' ? elapsed : recorded()
    const end = cutAt.get(recording) ?? ownEnd
    parts[slot] = { audio: new Blob(chunks, { type: 'audio/webm' }), ms: Math.max(0, end - from) }
    if (media === recording) {
      media = undefined
      if (phase === 'paused') {
        // Keep came before this part was done.
        if (resumeWaits) {
          resumeWaits = false
          resume()
        }
      } else if (phase !== 'stopping') {
        // Audio goes out only after the developer's stop (spec principle 2). A recording
        // that ended by itself (device gone, permission revoked) waits for a stop or a cancel.
        clearTimeout(limitTimer)
        release()
        phase = 'held'
        deps.emit({ state: 'failed', error: 'mic-lost', retry: true })
      }
    }
    finish()
  }

  /** A stop hands the recording over once every part is there. */
  function finish() {
    const to = stopping
    if (!to || pending > 0) return
    stopping = undefined
    hand(
      to.job,
      parts.filter((part): part is Segment => part !== undefined),
      to.request,
    )
  }

  async function start(next: number) {
    // The last recording still hands over its last chunk: this one starts right after.
    if (phase === 'stopping') {
      queued = next
      return
    }
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
    elapsed = 0
    if (!record(0)) {
      release()
      return fail('mic-failed')
    }
    try {
      monitor = deps.monitor?.(granted)
    } catch {
      // No level: parts are cut at PART_HARD only.
    }
    phase = 'recording'
    limit = next
    since = Date.now()
    armLimit()
    watchParts()
    deps.emit({ state: 'recording', limit, elapsed: 0 })
  }

  /**
   * The limit: the part ends, and the microphone stays open for the developer's answer
   * (resume, stop or cancel).
   */
  function pause() {
    if (phase !== 'recording' || !media) return
    elapsed = recorded()
    phase = 'paused'
    clearInterval(watch)
    media.stop()
    deps.emit({ state: 'paused', elapsed })
  }

  function resume() {
    if (phase !== 'paused') return
    if (media) {
      resumeWaits = true
      return
    }
    if (!record(elapsed)) {
      // The microphone went while the question waited: what was recorded waits for Retry.
      clearTimeout(limitTimer)
      release()
      phase = 'held'
      deps.emit({ state: 'failed', error: 'mic-lost', retry: true })
      return
    }
    since = Date.now()
    phase = 'recording'
    armLimit()
    watchParts()
    deps.emit({ state: 'recording', limit, elapsed })
  }

  function stop(job: string, request: TranscribeRequest) {
    if (phase === 'recording' || phase === 'paused' || phase === 'held') {
      elapsed = recorded()
      clearTimeout(limitTimer)
      clearInterval(watch)
      resumeWaits = false
      stopping = { job, request }
      const running = media
      phase = 'stopping'
      if (running) running.stop()
      else finish()
      return
    }
    // The recording is already on its way into another job: this one has nothing.
    if (phase === 'stopping') {
      deps.emit({ job, state: 'failed', error: 'lost', retry: false })
      return
    }
    // Nothing recorded yet (the microphone still starts) or nothing at all: the job ends now.
    endRecording()
    deps.emit({ job, state: 'failed', error: 'no-speech', retry: false })
  }

  /** The job's stretches one after another; silence in one leaves it out. */
  async function transcribeAll(job: Job, request: TranscribeRequest, signal: AbortSignal) {
    const texts: string[] = []
    for (const { audio, ms } of job.segments) {
      try {
        texts.push(await deps.transcribe(audio, request, signal, timeoutFor(ms)))
      } catch (error) {
        if (!(error instanceof VoiceFailure && error.code === 'no-speech')) throw error
      }
    }
    if (texts.length === 0) throw new VoiceFailure('no-speech')
    return texts.join(' ')
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
      const answer = await transcribeAll(job, request, controller.signal)
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
    let bytes = holding.reduce((sum, [, job]) => sum + sizeOf(job.segments), 0)
    for (const [id, job] of holding) {
      const { at = 0, error = 'failed', detail } = job.held ?? {}
      if (now - at < HOLD_TIME && bytes <= HOLD_BYTES) continue
      bytes -= sizeOf(job.segments)
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
          // While the last recording stops, only the start that waits for it is cancelled.
          if (phase === 'stopping') queued = undefined
          else endRecording()
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
