import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { timeoutFor, type TranscribeRequest, VoiceFailure } from '@/lib/voice/openrouter'
import type { RecorderMessage } from '@/lib/voice/protocol'
import {
  createMediaRecorder,
  createRecorder,
  HOLD_BYTES,
  HOLD_TIME,
  type MediaRecorderLike,
  type RecorderDeps,
} from '@/lib/voice/recorder'

const REQUEST: TranscribeRequest = { key: 'test-key-1', model: 'a/b', language: 'auto' }
const LIMIT = 300_000
const flush = () => vi.advanceTimersByTimeAsync(0)

class FakeTrack {
  stopped = false
  stop() {
    this.stopped = true
  }
}

class FakeMediaRecorder implements MediaRecorderLike {
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  ondataavailable: ((e: BlobEvent) => void) | null = null
  onstop: ((e: Event) => void) | null = null
  timeslice: number | undefined
  start(timeslice?: number) {
    this.state = 'recording'
    this.timeslice = timeslice
  }
  pause() {
    this.state = 'paused'
  }
  resume() {
    this.state = 'recording'
  }
  /** Delivers a chunk, as the browser does every timeslice. */
  chunk(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) } as BlobEvent)
  }
  stop() {
    this.state = 'inactive'
    // The browser hands over the last chunk, then fires `stop`, a task later.
    setTimeout(() => {
      this.chunk('end')
      this.onstop?.(new Event('stop'))
    })
  }
}

function setup(overrides: Partial<RecorderDeps> = {}) {
  const track = new FakeTrack()
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  const media: FakeMediaRecorder[] = []
  const emitted: RecorderMessage[] = []
  const transcribe = vi.fn<RecorderDeps['transcribe']>(async () => 'Make it wider.')
  const deps: RecorderDeps = {
    permission: vi.fn(async () => 'granted' as PermissionState),
    getUserMedia: vi.fn(async () => stream),
    record: () => {
      const m = new FakeMediaRecorder()
      media.push(m)
      return m
    },
    transcribe,
    emit: (m) => emitted.push(m),
    ...overrides,
  }
  const recorder = createRecorder(deps)
  const states = () => emitted.map((m) => ('job' in m ? `${m.job}:${m.state}` : m.state))
  const last = () => emitted.at(-1)
  const start = async (limit = LIMIT) => {
    recorder.command({ type: 'start', limit })
    await flush()
  }
  const stop = async (job = 'j1', request = REQUEST) => {
    recorder.command({ type: 'stop', job, request })
    await flush()
  }
  return { recorder, track, media, emitted, transcribe, deps, states, last, start, stop }
}

const text = (blob: Blob | undefined) => blob?.text()

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('the recording', () => {
  it('records, stops into a job, releases the microphone and transcribes', async () => {
    const r = setup()
    await r.start()
    expect(r.states()).toEqual(['starting', 'recording'])
    expect(r.last()).toEqual({ state: 'recording', limit: LIMIT, elapsed: 0 })
    expect(r.media[0]?.timeslice).toBe(1000)
    r.media[0]?.chunk('one ')
    await r.stop('j1')
    expect(r.track.stopped).toBe(true)
    expect(r.transcribe).toHaveBeenCalledTimes(1)
    const [audio, request, signal, timeout] = r.transcribe.mock.calls[0] ?? []
    expect(await text(audio)).toBe('one end')
    expect(request).toEqual(REQUEST)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(timeout).toBe(timeoutFor(0))
    // The background took the recording at its stop: its end says nothing.
    expect(r.states()).toEqual(['starting', 'recording', 'j1:transcribing', 'j1:done'])
    expect(r.last()).toEqual({ job: 'j1', state: 'done', text: 'Make it wider.', cut: false })
  })

  it('pauses at the limit and asks; resumed, it pauses again a whole limit later', async () => {
    const r = setup()
    await r.start(10_000)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(r.media[0]?.state).toBe('recording')
    await vi.advanceTimersByTimeAsync(1)
    expect(r.media[0]?.state).toBe('paused')
    expect(r.last()).toEqual({ state: 'paused', elapsed: 10_000 })
    // Nothing is sent while it waits for the answer.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(r.transcribe).not.toHaveBeenCalled()
    r.recorder.command({ type: 'resume' })
    await flush()
    expect(r.media[0]?.state).toBe('recording')
    expect(r.last()).toEqual({ state: 'recording', limit: 10_000, elapsed: 10_000 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(r.last()).toEqual({ state: 'paused', elapsed: 20_000 })
  })

  it('sends a paused recording when stopped, with a timeout for its length', async () => {
    const r = setup()
    await r.start(120_000)
    await vi.advanceTimersByTimeAsync(120_000)
    await r.stop('j1')
    await flush()
    expect(r.transcribe.mock.calls[0]?.[3]).toBe(timeoutFor(120_000))
    expect(r.last()).toMatchObject({ job: 'j1', state: 'done' })
  })

  it.each([
    ['prompt', 'mic-not-granted'],
    ['denied', 'mic-blocked'],
  ] as const)('asks for nothing when the permission is %s', async (permission, error) => {
    const r = setup({ permission: async () => permission })
    await r.start()
    expect(r.deps.getUserMedia).not.toHaveBeenCalled()
    expect(r.last()).toEqual({ state: 'failed', error, retry: false })
  })

  it.each([
    ['NotFoundError', 'no-mic'],
    ['OverconstrainedError', 'no-mic'],
    ['NotAllowedError', 'mic-blocked'],
    ['NotReadableError', 'mic-failed'],
    ['TypeError', 'mic-failed'],
  ])('maps a microphone %s to %s', async (name, error) => {
    const r = setup({
      getUserMedia: async () => {
        throw new DOMException('no', name)
      },
    })
    await r.start()
    expect(r.last()).toEqual({ state: 'failed', error, retry: false })
  })

  it.each([
    ['creating the recorder', 'record'],
    ['starting it', 'start'],
  ])('fails cleanly and lets the microphone go when %s throws', async (_, where) => {
    const failing = new FakeMediaRecorder()
    failing.start = () => {
      throw new DOMException('no', 'NotSupportedError')
    }
    const r = setup({
      record: () => {
        if (where === 'record') throw new DOMException('no', 'NotSupportedError')
        return failing
      },
    })
    await r.start()
    expect(r.track.stopped).toBe(true)
    expect(r.last()).toEqual({ state: 'failed', error: 'mic-failed', retry: false })
    // Nothing is stuck: a new start records.
    await r.start()
    expect(r.deps.getUserMedia).toHaveBeenCalledTimes(2)
  })

  // Spec principle 2: audio goes out only after the developer stops the recording.
  it('sends nothing when the recording ends by itself; a stop then sends what it holds', async () => {
    const r = setup()
    await r.start()
    r.media[0]?.chunk('voice ')
    // The device went away or the permission was revoked: the browser stops the recorder.
    r.media[0]?.stop()
    await vi.advanceTimersByTimeAsync(1)
    expect(r.transcribe).not.toHaveBeenCalled()
    expect(r.track.stopped).toBe(true)
    expect(r.last()).toEqual({ state: 'failed', error: 'mic-lost', retry: true })
    await r.stop('j1')
    expect(await text(r.transcribe.mock.calls[0]?.[0])).toBe('voice end')
    expect(r.last()).toMatchObject({ job: 'j1', state: 'done' })
  })

  it('cancels a recording: nothing is sent, the microphone is released', async () => {
    const r = setup()
    await r.start()
    r.recorder.command({ type: 'cancel' })
    await flush()
    await vi.advanceTimersByTimeAsync(LIMIT)
    expect(r.track.stopped).toBe(true)
    expect(r.transcribe).not.toHaveBeenCalled()
    expect(r.last()).toEqual({ state: 'idle' })
  })

  it('cancels while the microphone starts', async () => {
    let grant: (stream: MediaStream) => void = () => undefined
    const track = new FakeTrack()
    const r = setup({ getUserMedia: () => new Promise((done) => (grant = done)) })
    await r.start()
    r.recorder.command({ type: 'cancel' })
    grant({ getTracks: () => [track] } as unknown as MediaStream)
    await flush()
    expect(track.stopped).toBe(true)
    expect(r.media).toHaveLength(0)
    expect(r.states()).toEqual(['starting', 'idle'])
  })

  it('ends the job of a stop while the microphone starts: nothing was said', async () => {
    let grant: (stream: MediaStream) => void = () => undefined
    const track = new FakeTrack()
    const r = setup({ getUserMedia: () => new Promise((done) => (grant = done)) })
    await r.start()
    await r.stop('j1')
    grant({ getTracks: () => [track] } as unknown as MediaStream)
    await flush()
    expect(track.stopped).toBe(true)
    expect(r.transcribe).not.toHaveBeenCalled()
    expect(r.states()).toEqual(['starting', 'j1:failed'])
    expect(r.last()).toEqual({ job: 'j1', state: 'failed', error: 'no-speech', retry: false })
  })

  it('ends the job of a stop with nothing recording', async () => {
    const r = setup()
    await r.stop('j1')
    expect(r.emitted).toEqual([{ job: 'j1', state: 'failed', error: 'no-speech', retry: false }])
  })

  it('starts a recording that comes while the last one still stops, right after it', async () => {
    const r = setup()
    await r.start()
    r.media[0]?.chunk('first ')
    // Stop and start in one go: the browser hands over the last chunk a task later.
    r.recorder.command({ type: 'stop', job: 'j1', request: REQUEST })
    r.recorder.command({ type: 'start', limit: LIMIT })
    await flush()
    await flush()
    expect(await text(vi.mocked(r.deps.transcribe).mock.calls[0]?.[0])).toBe('first end')
    expect(r.media).toHaveLength(2)
    expect(r.last()).toEqual({ state: 'recording', limit: LIMIT, elapsed: 0 })
  })

  it('cancels only the waiting start while the last recording still stops', async () => {
    const r = setup()
    await r.start()
    r.recorder.command({ type: 'stop', job: 'j1', request: REQUEST })
    r.recorder.command({ type: 'start', limit: LIMIT })
    r.recorder.command({ type: 'cancel' })
    await flush()
    await flush()
    expect(r.transcribe).toHaveBeenCalledTimes(1)
    expect(r.media).toHaveLength(1)
  })

  it('ends the job of a second stop while the first still stops', async () => {
    const r = setup()
    await r.start()
    r.recorder.command({ type: 'stop', job: 'j1', request: REQUEST })
    r.recorder.command({ type: 'stop', job: 'j2', request: REQUEST })
    await flush()
    await flush()
    expect(r.emitted).toContainEqual({ job: 'j2', state: 'failed', error: 'lost', retry: false })
    expect(r.last()).toMatchObject({ job: 'j1', state: 'done' })
  })

  it('refuses a second start while it records', async () => {
    const r = setup()
    await r.start()
    await r.start()
    expect(r.media).toHaveLength(1)
    expect(r.deps.getUserMedia).toHaveBeenCalledTimes(1)
  })
})

describe('the jobs', () => {
  it('record the next dictation while the last one is transcribed', async () => {
    const answers: ((text: string) => void)[] = []
    const r = setup({
      transcribe: vi.fn<RecorderDeps['transcribe']>(
        () => new Promise<string>((done) => answers.push(done)),
      ),
    })
    await r.start()
    r.media[0]?.chunk('first ')
    await r.stop('j1')
    await r.start()
    r.media[1]?.chunk('second ')
    await r.stop('j2')
    expect(await text(vi.mocked(r.deps.transcribe).mock.calls[1]?.[0])).toBe('second end')
    answers[1]?.('Second.')
    answers[0]?.('First.')
    await flush()
    expect(r.emitted.filter((m) => 'job' in m && m.state === 'done')).toEqual([
      { job: 'j2', state: 'done', text: 'Second.', cut: false },
      { job: 'j1', state: 'done', text: 'First.', cut: false },
    ])
  })

  it('cut a transcript beyond the longest a job carries', async () => {
    const r = setup({ transcribe: vi.fn(async () => '😀'.repeat(20_001)) })
    await r.start()
    await r.stop('j1')
    const done = r.last()
    expect(done).toMatchObject({ job: 'j1', state: 'done', cut: true })
    expect([...((done as { text: string }).text ?? '')]).toHaveLength(20_000)
  })

  it('keep the audio after a failure and send it again with the new request', async () => {
    const transcribe = vi
      .fn<RecorderDeps['transcribe']>()
      .mockRejectedValueOnce(new VoiceFailure('invalid-key'))
      .mockResolvedValueOnce('Second try.')
    const r = setup({ transcribe })
    await r.start()
    r.media[0]?.chunk('voice ')
    await r.stop('j1')
    expect(r.last()).toEqual({ job: 'j1', state: 'failed', error: 'invalid-key', retry: true })
    const fixed = { ...REQUEST, key: 'test-key-2' }
    r.recorder.command({ type: 'retry', job: 'j1', request: fixed })
    await flush()
    expect(transcribe).toHaveBeenCalledTimes(2)
    expect(await text(transcribe.mock.calls[1]?.[0])).toBe('voice end')
    expect(transcribe.mock.calls[1]?.[1]).toEqual(fixed)
    expect(r.last()).toEqual({ job: 'j1', state: 'done', text: 'Second try.', cut: false })
    // Done: nothing is left to retry.
    r.recorder.command({ type: 'retry', job: 'j1', request: fixed })
    await flush()
    expect(transcribe).toHaveBeenCalledTimes(2)
  })

  it("pass OpenRouter's reason on", async () => {
    const r = setup({
      transcribe: async () => {
        throw new VoiceFailure('rejected', 'Model a/b does not exist')
      },
    })
    await r.start()
    await r.stop('j1')
    expect(r.last()).toEqual({
      job: 'j1',
      state: 'failed',
      error: 'rejected',
      detail: 'Model a/b does not exist',
      retry: true,
    })
  })

  it('offer no retry for silence, and treat unknown errors as failed', async () => {
    const silent = setup({
      transcribe: vi.fn(async () => {
        throw new VoiceFailure('no-speech')
      }),
    })
    await silent.start()
    await silent.stop('j1')
    expect(silent.last()).toEqual({ job: 'j1', state: 'failed', error: 'no-speech', retry: false })
    silent.recorder.command({ type: 'retry', job: 'j1', request: REQUEST })
    await flush()
    expect(silent.deps.transcribe).toHaveBeenCalledTimes(1)

    const broken = setup({
      transcribe: async () => {
        throw new Error('boom')
      },
    })
    await broken.start()
    await broken.stop('j1')
    expect(broken.last()).toEqual({ job: 'j1', state: 'failed', error: 'failed', retry: true })
  })

  it('drop a transcription that runs, and its late answer', async () => {
    let answer: (text: string) => void = () => undefined
    const r = setup({
      transcribe: vi.fn<RecorderDeps['transcribe']>(
        () => new Promise<string>((done) => (answer = done)),
      ),
    })
    await r.start()
    await r.stop('j1')
    const signal = vi.mocked(r.deps.transcribe).mock.calls[0]?.[2]
    r.recorder.command({ type: 'drop', job: 'j1' })
    expect(signal?.aborted).toBe(true)
    answer('too late')
    await flush()
    expect(r.states()).toEqual(['starting', 'recording', 'j1:transcribing'])
  })

  it('give up held audio after ten minutes: Retry is gone', async () => {
    const r = setup({
      transcribe: vi.fn(async () => {
        throw new VoiceFailure('offline')
      }),
    })
    await r.start()
    await r.stop('j1')
    expect(r.last()).toMatchObject({ job: 'j1', retry: true })
    await vi.advanceTimersByTimeAsync(HOLD_TIME)
    expect(r.last()).toEqual({ job: 'j1', state: 'failed', error: 'offline', retry: false })
    r.recorder.command({ type: 'retry', job: 'j1', request: REQUEST })
    await flush()
    expect(r.deps.transcribe).toHaveBeenCalledTimes(1)
  })

  it('give up the oldest held audio beyond the byte limit', async () => {
    const r = setup({
      transcribe: vi.fn(async () => {
        throw new VoiceFailure('offline')
      }),
    })
    // Three just pass the limit: the first goes.
    const big = 'x'.repeat(HOLD_BYTES / 3)
    for (const job of ['j1', 'j2', 'j3']) {
      await r.start()
      r.media.at(-1)?.chunk(big)
      await r.stop(job)
      await vi.advanceTimersByTimeAsync(1000)
    }
    const given = r.emitted.filter((m) => 'job' in m && m.state === 'failed' && !m.retry)
    expect(given).toEqual([{ job: 'j1', state: 'failed', error: 'offline', retry: false }])
  })

  it('drop everything when the port goes', async () => {
    let answer: (text: string) => void = () => undefined
    const r = setup({
      transcribe: vi.fn<RecorderDeps['transcribe']>(
        () => new Promise<string>((done) => (answer = done)),
      ),
    })
    await r.start()
    await r.stop('j1')
    const signal = vi.mocked(r.deps.transcribe).mock.calls[0]?.[2]
    await r.start()
    r.recorder.stop()
    await flush()
    answer('too late')
    await vi.advanceTimersByTimeAsync(LIMIT)
    expect(r.track.stopped).toBe(true)
    expect(signal?.aborted).toBe(true)
    expect(r.states()).toEqual([
      'starting',
      'recording',
      'j1:transcribing',
      'starting',
      'recording',
    ])
  })
})

describe('createMediaRecorder', () => {
  it('records Opus in WebM at 32 kbit/s', () => {
    const made: { stream: unknown; options: unknown }[] = []
    vi.stubGlobal(
      'MediaRecorder',
      class {
        constructor(stream: unknown, options: unknown) {
          made.push({ stream, options })
        }
      },
    )
    const stream = {} as MediaStream
    createMediaRecorder(stream)
    expect(made).toEqual([
      { stream, options: { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32_000 } },
    ])
    vi.unstubAllGlobals()
  })
})
