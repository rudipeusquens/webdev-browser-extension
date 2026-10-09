import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import background from '@/entrypoints/background'
import { YIELD_WAIT } from '@/lib/background/voice'
import { addAnnotation, emptyCollection } from '@/lib/collection/ops'
import { collectionKey, loadSite } from '@/lib/collection/store'
import { NOTES_KEY } from '@/lib/notes/model'
import { jobsKey } from '@/lib/voice/jobs'
import { deleteKey, storeKey } from '@/lib/voice/key'
import { DEFAULT_MODEL, VOICE_KEY } from '@/lib/voice/settings'
import { elementInput } from './helpers/collection'
import { fakeContextMenus } from './helpers/fake-context-menus'
import {
  type FakePort,
  fakePort,
  fakePorts,
  overlaySender,
  panelSender,
  recorderSender,
} from './helpers/fake-ports'
import { fakeSites } from './helpers/fake-sites'

// Well-formed but fake keys, assembled at runtime so this file never contains one.
const KEY = 'sk-or-v1-' + '0a1b'.repeat(16)
const OTHER_KEY = 'sk-or-v1-' + '9f8e'.repeat(16)
const SITE = 'http://localhost:3000'
const PAGE = `${SITE}/settings`
const REQUEST = { key: KEY, model: DEFAULT_MODEL, language: 'auto' }

/** Lets pending work settle: IndexedDB's tasks run on real setImmediate, timers are fake. */
async function flush() {
  for (let i = 0; i < 20; i++) {
    await new Promise((done) => setImmediate(done))
    await vi.advanceTimersByTimeAsync(0)
  }
}

/** The top frame of a tab on PAGE, as the sender of an overlay's port or message. */
const overlayAt = (tabId = 5, url = PAGE) => ({ ...overlaySender(tabId), url })

/** Delivers `message` to the background's onMessage listeners; resolves with the reply. */
async function send(message: unknown, sender: object): Promise<unknown> {
  let reply: unknown
  const responded = new Promise<void>((done) => {
    void fakeBrowser.runtime.onMessage
      .trigger(message, sender, (value: unknown) => {
        reply = value
        done()
      })
      .then((results: unknown[]) => {
        if (!results.includes(true)) done()
      })
  })
  await responded
  return reply
}

const stored = async (key: string) => (await fakeBrowser.storage.local.get(key))[key]

describe('background: dictation', () => {
  let ports: ReturnType<typeof fakePorts>

  beforeEach(async () => {
    // IndexedDB (fake-indexeddb) schedules its work with setImmediate: that stays real.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    fakeBrowser.reset()
    fakeSites()
    fakeContextMenus()
    ports = fakePorts()
    background.main()
    await storeKey(KEY)
    await flush()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** An overlay's port from the top frame of tab `tabId`. */
  function overlay(tabId = 5): FakePort {
    const port = fakePort('voice', overlayAt(tabId))
    ports.connect(port)
    return port
  }

  function panel(): FakePort {
    const port = fakePort('voice', panelSender())
    ports.connect(port)
    return port
  }

  /** Lets the recorder document load and connect. */
  async function loaded() {
    await flush()
    await vi.advanceTimersByTimeAsync(100)
    await flush()
  }

  async function started(client = overlay()) {
    client.receive({ type: 'start' })
    await loaded()
    const recorder = ports.recorder as FakePort
    recorder.receive({ state: 'recording', limit: 300_000, elapsed: 0 })
    return { client, recorder }
  }

  /** The job id the recorder was told to record into last. */
  const lastJob = (recorder: FakePort) =>
    (recorder.posted.findLast((m) => (m as { job?: string }).job) as { job: string }).job

  /** A draft pin `id` of SITE, as the overlay keeps it before it hands its dictation over. */
  async function storeDraft(id = 'd1', comment = '') {
    const c = addAnnotation(
      emptyCollection(SITE),
      { ...elementInput(id, PAGE, comment), draft: true },
      'T0',
    )
    await fakeBrowser.storage.local.set({ [collectionKey(SITE)]: c })
  }

  it('asks for a key before it opens anything', async () => {
    await deleteKey()
    const client = overlay()
    client.receive({ type: 'start' })
    await flush()
    expect(client.posted).toEqual([{ state: 'failed', error: 'no-key', retry: false }])
    expect(ports.created).toEqual([])
  })

  it('opens a recorder and starts it with the limit of Settings', async () => {
    await fakeBrowser.storage.local.set({
      [VOICE_KEY]: { model: 'a/b', language: 'de', limit: 10_000 },
    })
    const { recorder } = await started()
    expect(ports.created).toEqual([
      {
        url: expect.stringMatching(/^offscreen\.html\?/),
        reasons: ['USER_MEDIA'],
        justification: expect.stringMatching(/microphone/i),
      },
    ])
    expect(recorder.posted).toEqual([{ type: 'start', limit: 10_000 }])
  })

  it("relays the recording's states, but not the heartbeat, and never the key", async () => {
    const { client, recorder } = await started()
    recorder.receive({ state: 'alive' })
    recorder.receive({ state: 'paused', elapsed: 300_000 })
    recorder.receive({ state: 'failed', error: 'mic-lost', retry: true })
    expect(client.posted).toEqual([
      { state: 'recording', limit: 300_000, elapsed: 0 },
      { state: 'paused', elapsed: 300_000 },
      { state: 'failed', error: 'mic-lost', retry: true },
    ])
    expect(JSON.stringify(client.posted)).not.toContain(KEY)
  })

  it('ignores malformed messages from either side', async () => {
    const { client, recorder } = await started()
    recorder.receive({ job: 'j', state: 'done', text: 42, cut: false })
    recorder.receive({ state: 'failed', error: 'oops', retry: true })
    client.receive({ type: 'start', limit: 10_000 })
    client.receive({ type: 'stop' })
    client.receive({ type: 'retry' })
    client.receive('stop')
    await flush()
    expect(client.posted).toHaveLength(1)
    expect(recorder.posted).toHaveLength(1)
  })

  it('passes resume and cancel on', async () => {
    const { client, recorder } = await started()
    client.receive({ type: 'resume' })
    client.receive({ type: 'cancel' })
    await flush()
    expect(recorder.posted.slice(1)).toEqual([{ type: 'resume' }, { type: 'cancel' }])
    expect(client.posted.at(-1)).toEqual({ state: 'idle' })
  })

  describe("a pin's dictation", () => {
    it('is handed over to a job for the pin, with the key and settings as they are now', async () => {
      const { client, recorder } = await started()
      await storeKey(OTHER_KEY)
      await fakeBrowser.storage.local.set({
        [VOICE_KEY]: { model: 'c/d', language: 'fr', limit: 60_000 },
      })
      client.receive({ type: 'stop', keep: { pin: 'd1' } })
      await flush()
      expect(recorder.posted.at(-1)).toEqual({
        type: 'stop',
        job: expect.any(String),
        request: { key: OTHER_KEY, model: 'c/d', language: 'fr' },
      })
      expect(client.posted.at(-1)).toEqual({ state: 'handed', to: { pin: 'd1' } })
      expect(await stored(jobsKey(SITE))).toEqual({ d1: { state: 'transcribing' } })
    })

    it('fills its text into the pin, also after the port went', async () => {
      await storeDraft('d1', 'Typed')
      const { client, recorder } = await started()
      client.receive({ type: 'stop', keep: { pin: 'd1' } })
      await flush()
      client.close()
      const job = lastJob(recorder)
      recorder.receive({ state: 'idle' })
      recorder.receive({ job, state: 'transcribing' })
      recorder.receive({ job, state: 'done', text: 'and dictated.', cut: false })
      await flush()
      const item = (await loadSite(SITE)).items[0]
      expect(item?.comment).toBe('Typed and dictated.')
      expect(Object.keys(item ?? {})).not.toContain('draft')
      expect(await stored(jobsKey(SITE))).toBeUndefined()
      // Nothing is left: the document goes.
      expect(ports.exists).toBe(false)
    })

    it('keeps what the pin cannot hold as a Rec note: the pin is gone', async () => {
      const { client, recorder } = await started()
      client.receive({ type: 'stop', keep: { pin: 'gone' } })
      await flush()
      recorder.receive({ job: lastJob(recorder), state: 'done', text: 'Lost words.', cut: false })
      await flush()
      expect(await stored(NOTES_KEY)).toEqual({
        version: 1,
        items: [{ id: expect.any(String), text: 'Lost words.', createdAt: expect.any(String) }],
      })
      expect(await stored(jobsKey(SITE))).toBeUndefined()
    })

    it('puts what fits into the pin, the whole text into a note, and says it was cut', async () => {
      await storeDraft('d1')
      const { client, recorder } = await started()
      client.receive({ type: 'stop', keep: { pin: 'd1' } })
      await flush()
      const long = 'word '.repeat(1200).trim()
      recorder.receive({ job: lastJob(recorder), state: 'done', text: long, cut: false })
      await flush()
      expect([...((await loadSite(SITE)).items[0]?.comment ?? '')].length).toBeLessThanOrEqual(5000)
      expect((await stored(NOTES_KEY)) as { items: { text: string }[] }).toMatchObject({
        items: [{ text: long }],
      })
      expect(await stored(jobsKey(SITE))).toEqual({ d1: { state: 'cut' } })
    })

    it('shows a failure, sends the held audio again on Retry, and drops it on Dismiss', async () => {
      const { client, recorder } = await started()
      client.receive({ type: 'stop', keep: { pin: 'd1' } })
      await flush()
      const job = lastJob(recorder)
      recorder.receive({ job, state: 'failed', error: 'rate-limited', retry: true })
      await flush()
      expect(await stored(jobsKey(SITE))).toEqual({
        d1: { state: 'failed', error: 'rate-limited', retry: true },
      })
      // The document keeps the audio.
      expect(ports.exists).toBe(true)
      expect(await send({ type: 'dictation:retry', site: SITE, id: 'd1' }, panelSender())).toEqual({
        ok: true,
      })
      expect(recorder.posted.at(-1)).toEqual({ type: 'retry', job, request: REQUEST })
      recorder.receive({ job, state: 'failed', error: 'rate-limited', retry: true })
      await flush()
      expect(await send({ type: 'dictation:dismiss', site: SITE, id: 'd1' }, overlayAt())).toEqual({
        ok: true,
      })
      expect(recorder.posted.at(-1)).toEqual({ type: 'drop', job })
      expect(await stored(jobsKey(SITE))).toBeUndefined()
      expect(ports.exists).toBe(false)
    })

    it('says a Retry is too late once the audio is gone', async () => {
      const { client, recorder } = await started()
      client.receive({ type: 'stop', keep: { pin: 'd1' } })
      await flush()
      recorder.receive({
        job: lastJob(recorder),
        state: 'failed',
        error: 'no-speech',
        retry: false,
      })
      await flush()
      expect(
        await send({ type: 'dictation:retry', site: SITE, id: 'd1' }, panelSender()),
      ).toMatchObject({ ok: false, error: expect.stringMatching(/no longer kept/) })
    })

    it('records the next dictation while the last one is transcribed, in the same document', async () => {
      const first = await started()
      first.client.receive({ type: 'stop', keep: { pin: 'd1' } })
      await flush()
      first.recorder.receive({ state: 'idle' })
      await flush()
      first.client.receive({ type: 'start' })
      await loaded()
      expect(ports.created).toHaveLength(1)
      expect(first.recorder.posted.at(-1)).toEqual({ type: 'start', limit: 300_000 })
    })

    it('is refused from the panel, and a note from an overlay: the recording is cancelled', async () => {
      const fromPanel = await started(panel())
      fromPanel.client.receive({ type: 'stop', keep: { pin: 'd1' } })
      await flush()
      expect(fromPanel.client.posted.at(-1)).toEqual({ state: 'idle' })
      expect(fromPanel.recorder.posted.at(-1)).toEqual({ type: 'cancel' })
      const fromOverlay = overlay()
      fromOverlay.receive({ type: 'start' })
      await loaded()
      fromOverlay.receive({ type: 'stop', keep: { note: true } })
      await flush()
      expect(fromOverlay.posted.at(-1)).toEqual({ state: 'idle' })
      expect(await stored(NOTES_KEY)).toBeUndefined()
    })

    it('answers a stop before the recorder started with idle', async () => {
      const client = overlay()
      client.receive({ type: 'start' })
      await flush()
      client.receive({ type: 'stop', keep: { pin: 'd1' } })
      await loaded()
      expect(client.posted).toEqual([{ state: 'idle' }])
      expect(ports.recorder?.posted ?? []).toEqual([])
    })
  })

  describe('review findings', () => {
    it("does not take the ack of one recording's cancel for the next one's end", async () => {
      // A job keeps the document open, so the next start meets the ack.
      const first = await started(overlay(5))
      first.client.receive({ type: 'stop', keep: { pin: 'd0' } })
      await flush()
      first.client.receive({ type: 'start' })
      await flush()
      first.recorder.receive({ state: 'recording', limit: 300_000, elapsed: 0 })
      first.client.receive({ type: 'cancel' })
      await flush()
      const second = overlay(6)
      second.receive({ type: 'start' })
      // The recorder acknowledges the cancel while the next start reads the key.
      first.recorder.receive({ state: 'idle' })
      await flush()
      expect(first.recorder.posted.at(-1)).toEqual({ type: 'start', limit: 300_000 })
      first.recorder.receive({ state: 'recording', limit: 300_000, elapsed: 0 })
      expect(second.posted).toEqual([{ state: 'recording', limit: 300_000, elapsed: 0 }])
    })

    it('keeps a pin transcribing while another of its dictations still runs', async () => {
      const { client, recorder } = await started()
      client.receive({ type: 'stop', keep: { pin: 'd1' } })
      await flush()
      const one = lastJob(recorder)
      client.receive({ type: 'start' })
      await flush()
      recorder.receive({ state: 'recording', limit: 300_000, elapsed: 0 })
      client.receive({ type: 'stop', keep: { pin: 'd1' } })
      await flush()
      recorder.receive({ job: one, state: 'done', text: 'First.', cut: false })
      await flush()
      expect(await stored(jobsKey(SITE))).toEqual({ d1: { state: 'transcribing' } })
    })

    it('says on the pin when the key went before its stop', async () => {
      const { client, recorder } = await started()
      await deleteKey()
      client.receive({ type: 'stop', keep: { pin: 'd1' } })
      await flush()
      expect(client.posted.at(-1)).toEqual({ state: 'failed', error: 'no-key', retry: false })
      expect(recorder.posted.at(-1)).toEqual({ type: 'cancel' })
      expect(await stored(jobsKey(SITE))).toEqual({
        d1: { state: 'failed', error: 'no-key', retry: false },
      })
    })

    it('ends the recording and says so when its note cannot be made', async () => {
      const { client, recorder } = await started(panel())
      const set = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local)
      vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(((items: object) =>
        NOTES_KEY in items ? Promise.reject(new Error('quota')) : set(items as never)) as never)
      client.receive({ type: 'stop', keep: { note: true } })
      await flush()
      expect(client.posted.at(-1)).toEqual({ state: 'failed', error: 'interrupted', retry: false })
      expect(recorder.posted.at(-1)).toEqual({ type: 'cancel' })
      // Nothing is stuck: the next recording starts.
      client.receive({ type: 'start' })
      await loaded()
      expect(ports.recorder?.posted.at(-1)).toEqual({ type: 'start', limit: 300_000 })
    })

    it('still closes the document when a note cannot take its text', async () => {
      const { client, recorder } = await started(panel())
      client.receive({ type: 'stop', keep: { note: true } })
      await flush()
      vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(new Error('quota'))
      recorder.receive({ job: lastJob(recorder), state: 'done', text: 'Lost?', cut: false })
      await flush()
      expect(ports.exists).toBe(false)
    })
  })

  describe("Rec's dictation", () => {
    it('becomes a note that waits for its text, and gets it after the panel closed', async () => {
      const { client, recorder } = await started(panel())
      client.receive({ type: 'stop', keep: { note: true } })
      await flush()
      const notes = (await stored(NOTES_KEY)) as { items: { id: string }[] }
      const id = notes.items[0]?.id
      expect(notes.items).toEqual([
        { id, text: '', createdAt: expect.any(String), job: { state: 'transcribing' } },
      ])
      expect(client.posted.at(-1)).toEqual({ state: 'handed', to: { note: id } })
      client.close()
      recorder.receive({ job: lastJob(recorder), state: 'done', text: 'Hello there.', cut: false })
      await flush()
      expect(((await stored(NOTES_KEY)) as { items: unknown[] }).items).toEqual([
        { id, text: 'Hello there.', createdAt: expect.any(String) },
      ])
    })

    it('is handed over also when the panel closes right after the stop', async () => {
      const { client, recorder } = await started(panel())
      client.receive({ type: 'stop', keep: { note: true } })
      client.close()
      await flush()
      expect(recorder.posted.at(-1)).toMatchObject({ type: 'stop', request: REQUEST })
      recorder.receive({ job: lastJob(recorder), state: 'done', text: 'Kept.', cut: false })
      await flush()
      expect(((await stored(NOTES_KEY)) as { items: { text: string }[] }).items[0]?.text).toBe(
        'Kept.',
      )
    })

    it('fails on its note, retries and goes with it', async () => {
      const { client, recorder } = await started(panel())
      client.receive({ type: 'stop', keep: { note: true } })
      await flush()
      const id = ((await stored(NOTES_KEY)) as { items: { id: string }[] }).items[0]?.id
      const job = lastJob(recorder)
      recorder.receive({ job, state: 'failed', error: 'offline', retry: true })
      await flush()
      expect(((await stored(NOTES_KEY)) as { items: { job: unknown }[] }).items[0]?.job).toEqual({
        state: 'failed',
        error: 'offline',
        retry: true,
      })
      expect(await send({ type: 'note:retry', id }, panelSender())).toEqual({ ok: true })
      expect(recorder.posted.at(-1)).toEqual({ type: 'retry', job, request: REQUEST })
      expect(await send({ type: 'note:delete', id }, panelSender())).toEqual({ ok: true })
      expect(recorder.posted.at(-1)).toEqual({ type: 'drop', job })
      expect(await stored(NOTES_KEY)).toBeUndefined()
    })
  })

  describe('one recording at a time', () => {
    it('asks the running one to hand itself over before another starts', async () => {
      const first = await started(overlay(5))
      const second = overlay(6)
      second.receive({ type: 'start' })
      await flush()
      expect(first.client.posted.at(-1)).toEqual({ state: 'yield' })
      first.client.receive({ type: 'stop', keep: { pin: 'd1' } })
      await flush()
      expect(first.client.posted.at(-1)).toEqual({ state: 'handed', to: { pin: 'd1' } })
      expect(first.recorder.posted.at(-1)).toEqual({ type: 'start', limit: 300_000 })
    })

    it('ends the running one when it does not hand itself over in time', async () => {
      const first = await started(overlay(5))
      const rec = panel()
      rec.receive({ type: 'start' })
      await flush()
      await vi.advanceTimersByTimeAsync(YIELD_WAIT)
      await flush()
      expect(first.client.posted.at(-1)).toEqual({ state: 'failed', error: 'taken', retry: false })
      expect(first.recorder.posted.slice(-2)).toEqual([
        { type: 'cancel' },
        { type: 'start', limit: 300_000 },
      ])
      first.recorder.receive({ state: 'recording', limit: 300_000, elapsed: 0 })
      expect(rec.posted).toEqual([{ state: 'recording', limit: 300_000, elapsed: 0 }])
    })
  })

  it('ends a recording that was not handed over when its port goes', async () => {
    const { client, recorder } = await started()
    client.close()
    await flush()
    expect(recorder.disconnected || ports.exists === false).toBe(true)
    expect(ports.exists).toBe(false)
  })

  it('cancels a start whose port went while the recorder opened', async () => {
    const client = overlay()
    client.receive({ type: 'start' })
    client.close()
    await loaded()
    expect(ports.recorder?.posted ?? []).toEqual([])
    expect(ports.exists).toBe(false)
  })

  it('loses what was in the document when it goes by itself, and says so', async () => {
    const { client, recorder } = await started()
    const rec = await (async () => {
      client.receive({ type: 'stop', keep: { pin: 'd1' } })
      await flush()
      return lastJob(recorder)
    })()
    expect(rec).toBeTruthy()
    const second = overlay(6)
    second.receive({ type: 'start' })
    await flush()
    recorder.receive({ state: 'recording', limit: 300_000, elapsed: 0 })
    recorder.close()
    await flush()
    expect(second.posted.at(-1)).toEqual({ state: 'failed', error: 'interrupted', retry: false })
    expect(await stored(jobsKey(SITE))).toEqual({
      d1: { state: 'failed', error: 'lost', retry: false },
    })
  })

  it('closes a recorder left from before', async () => {
    const leftOver = fakeBrowser.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'left over',
    })
    await vi.advanceTimersByTimeAsync(100)
    await leftOver
    const stale = ports.recorder as FakePort
    expect(stale.disconnected).toBe(true)
    const { recorder } = await started()
    expect(ports.closed).toBe(1)
    expect(recorder).not.toBe(stale)
    expect(recorder.posted[0]).toEqual({ type: 'start', limit: 300_000 })
  })

  it('starts again cleanly when cancelled while the recorder loads', async () => {
    const client = overlay()
    client.receive({ type: 'start' })
    await flush()
    client.receive({ type: 'cancel' })
    client.receive({ type: 'start' })
    await loaded()
    await loaded()
    const recorder = ports.recorder as FakePort
    expect(recorder.disconnected).toBe(false)
    expect(recorder.posted).toEqual([{ type: 'start', limit: 300_000 }])
  })

  it('says so when the recorder dies before it gets its start', async () => {
    ports.dies = true
    const client = overlay()
    client.receive({ type: 'start' })
    await loaded()
    expect(client.posted).toEqual([{ state: 'failed', error: 'mic-failed', retry: false }])
    expect(ports.exists).toBe(false)
  })

  it('gives up when the recorder does not connect within 5 seconds', async () => {
    ports.connects = false
    const client = overlay()
    client.receive({ type: 'start' })
    await flush()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(client.posted).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await flush()
    expect(client.posted).toEqual([{ state: 'failed', error: 'mic-failed', retry: false }])
    expect(ports.exists).toBe(false)
  })

  it.each([
    ['a subframe', () => fakePort('voice', overlaySender(5, 3))],
    ['another page of the extension', () => fakePort('voice', panelSender('/mic-permission.html'))],
    [
      'a page of the extension in a tab',
      () => fakePort('voice', { ...overlaySender(), url: panelSender('/mic-permission.html').url }),
    ],
    ['the panel in a tab', () => fakePort('voice', { ...overlaySender(), url: panelSender().url })],
    [
      "another extension's panel",
      () =>
        fakePort('voice', {
          id: fakeBrowser.runtime.id,
          url: 'chrome-extension://x/sidepanel.html',
        }),
    ],
    ['another extension', () => fakePort('voice', { ...overlaySender(), id: 'another-extension' })],
  ])('refuses a dictation port from %s', async (_, make) => {
    const port = make()
    ports.connect(port)
    port.receive({ type: 'start' })
    await flush()
    expect(port.disconnected).toBe(true)
    expect(ports.created).toEqual([])
  })

  it('refuses recorder ports from other pages and when no recorder is waited for', async () => {
    const wrong = fakePort('recorder', recorderSender('/sidepanel.html'))
    ports.connect(wrong)
    expect(wrong.disconnected).toBe(true)
    const unasked = fakePort('recorder', recorderSender())
    ports.connect(unasked)
    expect(unasked.disconnected).toBe(true)
  })

  it('leaves ports of other names alone', () => {
    const other = fakePort('panel', overlaySender())
    ports.connect(other)
    expect(other.disconnected).toBe(false)
  })
})

describe('background: after a restart', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    fakeBrowser.reset()
    fakeSites()
    fakeContextMenus()
    fakePorts()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('marks what was transcribed or held as lost: no recorder runs any more', async () => {
    await fakeBrowser.storage.local.set({
      [jobsKey(SITE)]: {
        a1: { state: 'transcribing' },
        a2: { state: 'failed', error: 'offline', retry: true },
        a3: { state: 'cut' },
      },
      [NOTES_KEY]: {
        version: 1,
        items: [{ id: 'n1', text: '', createdAt: 'T0', job: { state: 'transcribing' } }],
      },
    })
    background.main()
    await flush()
    expect(await stored(jobsKey(SITE))).toEqual({
      a1: { state: 'failed', error: 'lost', retry: false },
      a2: { state: 'failed', error: 'offline', retry: false },
      a3: { state: 'cut' },
    })
    expect(((await stored(NOTES_KEY)) as { items: { job: unknown }[] }).items[0]?.job).toEqual({
      state: 'failed',
      error: 'lost',
      retry: false,
    })
  })
})

describe('background: requests from the popover', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    fakeSites()
    fakeContextMenus()
    fakePorts()
    background.main()
  })

  afterEach(() => vi.restoreAllMocks())

  it('opens the microphone page next to the tab', async () => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never)
    expect(await send({ type: 'voice:grant' }, overlaySender())).toEqual({ ok: true })
    expect(create).toHaveBeenCalledWith({
      url: fakeBrowser.runtime.getURL('/mic-permission.html'),
      windowId: 1,
      index: 3,
      openerTabId: 5,
    })
  })

  it('opens the panel on its settings, inside the click', async () => {
    const open = vi.spyOn(fakeBrowser.sidePanel, 'open').mockResolvedValue(undefined)
    const now = Date.now()
    const replied = send({ type: 'voice:settings' }, overlaySender())
    // Synchronously: Chrome accepts sidePanel.open() only within the user gesture.
    expect(open).toHaveBeenCalledWith({ windowId: 1 })
    expect(await replied).toEqual({ ok: true })
    const { panelView } = await fakeBrowser.storage.session.get('panelView')
    expect(panelView).toMatchObject({ windowId: 1, view: 'settings' })
    expect((panelView as { at: number }).at).toBeGreaterThanOrEqual(now)
  })

  it('says whether a key is saved, and nothing more', async () => {
    expect(await send({ type: 'voice:ready' }, overlaySender())).toEqual({ ok: true, ready: false })
    await storeKey(KEY)
    const reply = await send({ type: 'voice:ready' }, overlaySender())
    expect(reply).toEqual({ ok: true, ready: true })
    expect(JSON.stringify(reply)).not.toContain(KEY)
  })

  it.each([
    ['the panel', { id: fakeBrowser.runtime.id, url: 'chrome-extension://x/sidepanel.html' }],
    ['a subframe', overlaySender(5, 2)],
  ])('refuses these from %s', async (_, sender) => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never)
    const open = vi.spyOn(fakeBrowser.sidePanel, 'open').mockResolvedValue(undefined)
    expect(await send({ type: 'voice:grant' }, sender)).toMatchObject({ ok: false })
    expect(await send({ type: 'voice:settings' }, sender)).toMatchObject({ ok: false })
    expect(await send({ type: 'voice:ready' }, sender)).toMatchObject({ ok: false })
    expect(create).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it("refuses a pin's Retry and Dismiss from another site, and notes from a page", async () => {
    const elsewhere = overlayAt(5, 'http://localhost:5173/')
    for (const type of ['dictation:retry', 'dictation:dismiss']) {
      expect(await send({ type, site: SITE, id: 'd1' }, elsewhere)).toMatchObject({ ok: false })
    }
    for (const type of ['note:retry', 'note:delete']) {
      expect(await send({ type, id: 'n1' }, overlayAt())).toMatchObject({ ok: false })
    }
  })
})
