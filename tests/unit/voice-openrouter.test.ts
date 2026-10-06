import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkKey,
  OPENROUTER,
  TIMEOUT,
  transcribe,
  type TranscribeRequest,
  VoiceFailure,
} from '@/lib/voice/openrouter'
import { voiceErrorText } from '@/lib/voice/protocol'

// A well-formed but fake key, assembled at runtime so this file never contains one.
const KEY = 'sk-or-v1-' + 'ef56'.repeat(16)
const REQUEST: TranscribeRequest = {
  key: KEY,
  model: 'openai/gpt-4o-mini-transcribe',
  language: 'auto',
}
const AUDIO = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])], { type: 'audio/webm' })

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function fakeFetch(answer: Response | (() => Promise<Response>)) {
  return vi.fn<typeof fetch>(async () => (typeof answer === 'function' ? answer() : answer.clone()))
}

/** A fetch that answers only when its signal aborts, like a server that never replies. */
const hangingFetch = () =>
  vi.fn<typeof fetch>(
    (_, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      }),
  )

async function failure(promise: Promise<unknown>): Promise<VoiceFailure> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(VoiceFailure)
  return error as VoiceFailure
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('transcribe', () => {
  it('posts the audio as the spec says', async () => {
    const fetch = fakeFetch(json({ text: 'Make it wider.' }))
    expect(await transcribe(AUDIO, REQUEST, { fetch })).toBe('Make it wider.')
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(OPENROUTER).toBe('https://openrouter.ai')
    expect(String(url)).toBe('https://openrouter.ai/api/v1/audio/transcriptions')
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toBe(`Bearer ${KEY}`)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'openai/gpt-4o-mini-transcribe',
      input_audio: { data: 'GkXfowECAw==', format: 'webm' },
      provider: { data_collection: 'deny' },
    })
  })

  it('names the language only when it is not automatic', async () => {
    const fetch = fakeFetch(json({ text: 'Hallo.' }))
    await transcribe(AUDIO, { ...REQUEST, language: 'de' }, { fetch })
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ language: 'de' })
  })

  it('trims the text', async () => {
    const fetch = fakeFetch(json({ text: '  Make it wider. \n' }))
    expect(await transcribe(AUDIO, REQUEST, { fetch })).toBe('Make it wider.')
  })

  it.each([
    [{ text: '' }, 'no-speech'],
    [{ text: ' \n ' }, 'no-speech'],
    [{ text: 42 }, 'failed'],
    [{}, 'failed'],
  ])('maps the answer %j to %s', async (body, code) => {
    expect((await failure(transcribe(AUDIO, REQUEST, { fetch: fakeFetch(json(body)) }))).code).toBe(
      code,
    )
  })

  it.each([
    [401, 'invalid-key'],
    [403, 'invalid-key'],
    [402, 'no-credits'],
    [429, 'rate-limited'],
    [500, 'failed'],
    [502, 'failed'],
    [503, 'failed'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const fetch = fakeFetch(json({ error: { message: 'Something', code: status } }, status))
    expect((await failure(transcribe(AUDIO, REQUEST, { fetch }))).code).toBe(code)
  })

  it.each([400, 404, 422])("passes OpenRouter's reason for HTTP %i on", async (status) => {
    const fetch = fakeFetch(
      json({ error: { message: 'Model a/b does not exist', code: 400 } }, status),
    )
    const error = await failure(transcribe(AUDIO, REQUEST, { fetch }))
    expect(error.code).toBe('rejected')
    expect(error.detail).toBe('Model a/b does not exist')
  })

  it('keeps that reason to one short line of text', async () => {
    const message = `First line\n\n<b>second</b>\t${'x'.repeat(400)}`
    const fetch = fakeFetch(json({ error: { message } }, 400))
    const { detail } = await failure(transcribe(AUDIO, REQUEST, { fetch }))
    expect(detail).toMatch(/^First line <b>second<\/b> x+…$/)
    expect([...(detail ?? '')].length).toBeLessThanOrEqual(200)
  })

  it('gives no reason when OpenRouter sends none', async () => {
    const fetch = fakeFetch(new Response('<html>Bad gateway</html>', { status: 400 }))
    const error = await failure(transcribe(AUDIO, REQUEST, { fetch }))
    expect(error.code).toBe('rejected')
    expect(error.detail).toBeUndefined()
  })

  it('maps a network failure to offline and malformed JSON to failed', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect((await failure(transcribe(AUDIO, REQUEST, { fetch: offline }))).code).toBe('offline')
    const garbage = fakeFetch(new Response('not json', { status: 200 }))
    expect((await failure(transcribe(AUDIO, REQUEST, { fetch: garbage }))).code).toBe('failed')
  })

  it('gives up after 65 seconds', async () => {
    vi.useFakeTimers()
    expect(TIMEOUT).toBe(65_000)
    const result = failure(transcribe(AUDIO, REQUEST, { fetch: hangingFetch() }))
    await vi.advanceTimersByTimeAsync(64_999)
    let settled = false
    void result.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect((await result).code).toBe('timeout')
  })

  it('stops when the caller cancels, without calling it a failure', async () => {
    const cancel = new AbortController()
    const result = transcribe(AUDIO, REQUEST, { fetch: hangingFetch(), signal: cancel.signal })
    cancel.abort()
    const error = await result.then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(error).not.toBeInstanceOf(VoiceFailure)
    expect((error as Error).name).toBe('AbortError')
  })

  it('does not start when cancelled before', async () => {
    const fetch = fakeFetch(json({ text: 'x' }))
    const cancel = new AbortController()
    cancel.abort()
    await expect(
      transcribe(AUDIO, REQUEST, { fetch, signal: cancel.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('never carries the key in a failure, even when OpenRouter quotes it', async () => {
    const answers = [
      json({ error: { message: `Key ${KEY} is not valid` } }, 400),
      json({ error: { message: `Key ${KEY} is not valid` } }, 401),
      new Response(`oops ${KEY}`, { status: 500 }),
    ]
    for (const answer of answers) {
      const error = await failure(transcribe(AUDIO, REQUEST, { fetch: fakeFetch(answer) }))
      for (const text of [
        error.message,
        error.detail ?? '',
        String(error),
        JSON.stringify(error),
      ]) {
        expect(text).not.toContain(KEY)
      }
    }
    const offline = vi.fn(async () => {
      throw new TypeError(`Failed to fetch with ${KEY}`)
    })
    const error = await failure(transcribe(AUDIO, REQUEST, { fetch: offline }))
    expect(`${error.message} ${String(error)} ${error.detail ?? ''}`).not.toContain(KEY)
  })

  it('encodes two minutes of audio in one go', async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024).map((_, i) => (i * 7) & 0xff)
    const fetch = fakeFetch(json({ text: 'ok' }))
    await transcribe(new Blob([bytes]), REQUEST, { fetch })
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      input_audio: { data: string }
    }
    expect(body.input_audio.data).toBe(Buffer.from(bytes).toString('base64'))
  })
})

describe('checkKey', () => {
  it('asks OpenRouter about the key at no cost', async () => {
    const fetch = fakeFetch(json({ data: {} }))
    expect(await checkKey(KEY, { fetch })).toBe(true)
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(String(url)).toBe('https://openrouter.ai/api/v1/key')
    expect(init?.method ?? 'GET').toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${KEY}`)
  })

  it.each([401, 403])('calls the key invalid on HTTP %i', async (status) => {
    expect(await checkKey(KEY, { fetch: fakeFetch(json({}, status)) })).toBe(false)
  })

  it('fails when OpenRouter fails or cannot be reached', async () => {
    expect((await failure(checkKey(KEY, { fetch: fakeFetch(json({}, 500)) }))).code).toBe('failed')
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect((await failure(checkKey(KEY, { fetch: offline }))).code).toBe('offline')
  })
})

describe('voiceErrorText', () => {
  it.each([
    ['no-key', 'Add an OpenRouter API key in settings.'],
    ['mic-not-granted', 'Allow the microphone first.'],
    ['mic-blocked', 'The microphone is blocked for this extension.'],
    ['no-mic', 'No microphone found.'],
    ['mic-failed', 'The microphone could not start.'],
    ['invalid-key', 'Invalid API key.'],
    ['no-credits', 'Out of credits.'],
    ['rate-limited', 'Rate limited, try again.'],
    ['rejected', 'Transcription failed.'],
    ['failed', 'Transcription failed.'],
    ['timeout', 'Transcription timed out.'],
    ['offline', 'Could not reach OpenRouter.'],
    ['no-speech', 'No speech detected.'],
    ['interrupted', 'Recording stopped unexpectedly.'],
    ['taken', 'Recording stopped: another one started.'],
  ] as const)('says %s as the spec does', (error, text) => {
    expect(voiceErrorText(error)).toBe(text)
  })

  it("adds OpenRouter's reason to a refused request", () => {
    expect(voiceErrorText('rejected', 'Model a/b does not exist')).toBe(
      'Transcription failed: Model a/b does not exist',
    )
  })
})
