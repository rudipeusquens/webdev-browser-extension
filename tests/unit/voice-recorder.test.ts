import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceFailure, type TranscribeRequest } from '@/lib/voice/openrouter'
import { LIMIT, type RecorderMessage } from '@/lib/voice/protocol'
import {
  createMediaRecorder,
  createRecorder,
  type MediaRecorderLike,
  type RecorderDeps,
} from '@/lib/voice/recorder'

const REQUEST: TranscribeRequest = { key: 'test-key-1', model: 'a/b', language: 'auto' }
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
  const states = () => emitted.map((m) => m.state)
  const last = () => emitted.at(-1)
  return { recorder, track, media, emitted, transcribe, deps, states, last }
}

const text = (blob: Blob | undefined) => blob?.text()

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('the recorder', () => {
  it('records, stops, releases the microphone and transcribes', async () => {
    const r = setup()
    r.recorder.command({ type: 'start', request: REQUEST })
    await flush()
    expect(r.states()).toEqual(['starting', 'recording'])
    expect(r.last()).toEqual({ state: 'recording', limit: LIMIT })
    expect(r.media[0]?.timeslice).toBe(1000)
    r.media[0]?.chunk('one ')
    r.recorder.command({ type: 'stop' })
    await flush()
    expect(r.track.stopped).toBe(true)
    expect(r.transcribe).toHaveBeenCalledTimes(1)
    const [audio, request, signal] = r.transcribe.mock.calls[0] ?? []
    expect(await text(audio)).toBe('one end')
    expect(request).toEqual(REQUEST)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(r.states()).toEqual(['starting', 'recording', 'transcribing', 'done'])
    expect(r.last()).toEqual({ state: 'done', text: 'Make it wider.', atLimit: false })
  })

  it('stops by itself after two minutes and says so', async () => {
    const r = setup()
    r.recorder.command({ type: 'start', request: REQUEST })
    await flush()
    await vi.advanceTimersByTimeAsync(LIMIT - 1)
    expect(r.transcribe).not.toHaveBeenCalled()
    // The limit stops the recorder, whose last chunk and `stop` follow a task later.
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(r.track.stopped).toBe(true)
    expect(r.last()).toEqual({ state: 'done', text: 'Make it wider.', atLimit: true })
  })

  it.each([
    ['prompt', 'mic-not-granted'],
    ['denied', 'mic-blocked'],
  ] as const)('asks for nothing when the permission is %s', async (permission, error) => {
    const r = setup({ permission: async () => permission })
    r.recorder.command({ type: 'start', request: REQUEST })
    await flush()
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
    r.recorder.command({ type: 'start', request: REQUEST })
    await flush()
    expect(r.last()).toEqual({ state: 'failed', error, retry: false })
  })

  it('cancels a recording: nothing is sent, the microphone is released', async () => {
    const r = setup()
    r.recorder.command({ type: 'start', request: REQUEST })
    await flush()
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
    r.recorder.command({ type: 'start', request: REQUEST })
    await flush()
    r.recorder.command({ type: 'cancel' })
    grant({ getTracks: () => [track] } as unknown as MediaStream)
    await flush()
    expect(track.stopped).toBe(true)
    expect(r.media).toHaveLength(0)
    expect(r.states()).toEqual(['starting', 'idle'])
  })

  it('cancels a transcription and drops its late answer', async () => {
    let answer: (text: string) => void = () => undefined
    const r = setup({
      transcribe: vi.fn<RecorderDeps['transcribe']>(
        () => new Promise<string>((done) => (answer = done)),
      ),
    })
    r.recorder.command({ type: 'start', request: REQUEST })
    await flush()
    r.recorder.command({ type: 'stop' })
    await flush()
    const signal = vi.mocked(r.deps.transcribe).mock.calls[0]?.[2]
    r.recorder.command({ type: 'cancel' })
    expect(signal?.aborted).toBe(true)
    answer('too late')
    await flush()
    expect(r.states()).toEqual(['starting', 'recording', 'transcribing', 'idle'])
  })

  it('keeps the audio after a failure and sends it again with the new request', async () => {
    const transcribe = vi
      .fn<RecorderDeps['transcribe']>()
      .mockRejectedValueOnce(new VoiceFailure('invalid-key'))
      .mockResolvedValueOnce('Second try.')
    const r = setup({ transcribe })
    r.recorder.command({ type: 'start', request: REQUEST })
    await flush()
    r.media[0]?.chunk('voice ')
    r.recorder.command({ type: 'stop' })
    await flush()
    expect(r.last()).toEqual({ state: 'failed', error: 'invalid-key', retry: true })
    const fixed = { ...REQUEST, key: 'test-key-2' }
    r.recorder.command({ type: 'retry', request: fixed })
    await flush()
    expect(transcribe).toHaveBeenCalledTimes(2)
    expect(await text(transcribe.mock.calls[1]?.[0])).toBe('voice end')
    expect(transcribe.mock.calls[1]?.[1]).toEqual(fixed)
    expect(r.last()).toEqual({ state: 'done', text: 'Second try.', atLimit: false })
    expect(r.media).toHaveLength(1)
  })

  it("passes OpenRouter's reason on", async () => {
    const r = setup({
      transcribe: async () => {
        throw new VoiceFailure('rejected', 'Model a/b does not exist')
      },
    })
    r.recorder.command({ type: 'start', request: REQUEST })
    await flush()
    r.recorder.command({ type: 'stop' })
    await flush()
    expect(r.last()).toEqual({
      state: 'failed',
      error: 'rejected',
      detail: 'Model a/b does not exist',
      retry: true,
    })
  })

  it('offers no retry for silence, and treats unknown errors as failed', async () => {
    const silent = setup({
      transcribe: vi.fn(async () => {
        throw new VoiceFailure('no-speech')
      }),
    })
    silent.recorder.command({ type: 'start', request: REQUEST })
    await flush()
    silent.recorder.command({ type: 'stop' })
    await flush()
    expect(silent.last()).toEqual({ state: 'failed', error: 'no-speech', retry: false })
    silent.recorder.command({ type: 'retry', request: REQUEST })
    await flush()
    expect(silent.deps.transcribe).toHaveBeenCalledTimes(1)

    const broken = setup({
      transcribe: async () => {
        throw new Error('boom')
      },
    })
    broken.recorder.command({ type: 'start', request: REQUEST })
    await flush()
    broken.recorder.command({ type: 'stop' })
    await flush()
    expect(broken.last()).toEqual({ state: 'failed', error: 'failed', retry: true })
  })

  it('refuses a second start while busy, and starts afresh after a failure', async () => {
    const transcribe = vi
      .fn<RecorderDeps['transcribe']>()
      .mockRejectedValueOnce(new VoiceFailure('offline'))
      .mockResolvedValue('Fresh.')
    const r = setup({ transcribe })
    r.recorder.command({ type: 'start', request: REQUEST })
    await flush()
    r.recorder.command({ type: 'start', request: REQUEST })
    await flush()
    expect(r.media).toHaveLength(1)
    expect(r.deps.getUserMedia).toHaveBeenCalledTimes(1)
    r.recorder.command({ type: 'stop' })
    await flush()
    expect(r.last()).toMatchObject({ state: 'failed', error: 'offline' })
    r.recorder.command({ type: 'start', request: REQUEST })
    await flush()
    r.media[1]?.chunk('new ')
    r.recorder.command({ type: 'stop' })
    await flush()
    expect(await text(transcribe.mock.calls[1]?.[0])).toBe('new end')
  })

  it('ignores stop and retry when there is nothing to stop or retry', async () => {
    const r = setup()
    r.recorder.command({ type: 'stop' })
    r.recorder.command({ type: 'retry', request: REQUEST })
    await flush()
    expect(r.emitted).toEqual([])
    expect(r.transcribe).not.toHaveBeenCalled()
  })

  it('drops everything when its port goes', async () => {
    const r = setup()
    r.recorder.command({ type: 'start', request: REQUEST })
    await flush()
    r.recorder.stop()
    await flush()
    await vi.advanceTimersByTimeAsync(LIMIT)
    expect(r.track.stopped).toBe(true)
    expect(r.transcribe).not.toHaveBeenCalled()
    expect(r.states()).toEqual(['starting', 'recording'])
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
