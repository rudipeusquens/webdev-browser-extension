// The jobs of the offscreen recorder (recorder.ts, spec section 5): each stopped recording is
// transcribed here, its parts one after another, while the next recording may already run. A
// failed job keeps its audio for Retry, for a while.

import { type TranscribeRequest, timeoutFor, VoiceFailure } from './openrouter'
import { type JobEvent, MAX_TEXT, type VoiceError } from './protocol'

export interface JobDeps {
  transcribe(
    audio: Blob,
    request: TranscribeRequest,
    signal: AbortSignal,
    timeout: number,
  ): Promise<string>
  emit(message: JobEvent): void
}

/** How long a failed job keeps its audio for Retry, and how much audio all of them keep. */
export const HOLD_TIME = 10 * 60_000
export const HOLD_BYTES = 20_000_000

/** At most `max` code points. */
function cut(text: string, max: number): { text: string; cut: boolean } {
  const points = [...text]
  return points.length > max
    ? { text: points.slice(0, max).join(''), cut: true }
    : { text, cut: false }
}

/** A stretch of one recording, up to a limit: a model transcribes it in one go. */
export interface Segment {
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

export function createJobs(deps: JobDeps) {
  const jobs = new Map<string, Job>()
  let expiry: ReturnType<typeof setTimeout> | undefined

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
      if (retry) job.held = { at: Date.now(), error: code, detail }
      else jobs.delete(id)
      failed(id, code, detail, retry)
      if (retry) keepHeld()
    }
  }

  /** A job's failure; `detail` goes along only when OpenRouter gave a reason. */
  function failed(job: string, error: VoiceError, detail: string | undefined, retry: boolean) {
    deps.emit({ job, state: 'failed', error, ...(detail ? { detail } : {}), retry })
  }

  /** Held audio within its time and size: the rest gives up its Retry, oldest first. */
  function keepHeld() {
    clearTimeout(expiry)
    const now = Date.now()
    const holding = [...jobs]
      .flatMap(([id, job]) => (job.held ? [{ id, job, held: job.held }] : []))
      .sort((a, b) => a.held.at - b.held.at)
    let bytes = holding.reduce((sum, { job }) => sum + sizeOf(job.segments), 0)
    // Since when the first job that keeps its audio holds it: the oldest runs out first.
    let oldest: number | undefined
    for (const { id, job, held } of holding) {
      if (now - held.at < HOLD_TIME && bytes <= HOLD_BYTES) {
        oldest ??= held.at
        continue
      }
      bytes -= sizeOf(job.segments)
      jobs.delete(id)
      failed(id, held.error, held.detail, false)
    }
    if (oldest !== undefined) expiry = setTimeout(keepHeld, Math.max(0, oldest + HOLD_TIME - now))
  }

  function drop(id: string) {
    const job = jobs.get(id)
    if (!job) return
    job.controller?.abort()
    jobs.delete(id)
  }

  return {
    /** A stopped recording becomes the job `id`, transcribed now. */
    add(id: string, segments: Segment[], request: TranscribeRequest) {
      jobs.set(id, { segments })
      void send(id, request)
    },
    /** A held job goes out again, with the background's request of now. */
    retry(id: string, request: TranscribeRequest) {
      if (jobs.get(id)?.held) void send(id, request)
    },
    drop,
    /** Every job goes, and none reports back. */
    dropAll() {
      clearTimeout(expiry)
      for (const id of [...jobs.keys()]) drop(id)
    },
  }
}
