import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import background from '@/entrypoints/background'
import { deleteKey, storeKey } from '@/lib/voice/key'
import { DEFAULT_MODEL, VOICE_KEY } from '@/lib/voice/settings'
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

/** Lets pending work settle: IndexedDB's tasks run on real setImmediate, timers are fake. */
async function flush() {
  for (let i = 0; i < 20; i++) {
    await new Promise((done) => setImmediate(done))
    await vi.advanceTimersByTimeAsync(0)
  }
}

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
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** A popover's port from the top frame of tab `tabId`. */
  function popover(tabId = 5): FakePort {
    const port = fakePort('voice', overlaySender(tabId))
    ports.connect(port)
    return port
  }

  /** Lets the recorder document load and connect. */
  async function loaded() {
    await flush()
    await vi.advanceTimersByTimeAsync(100)
    await flush()
  }

  async function started(tabId = 5) {
    const overlay = popover(tabId)
    overlay.receive({ type: 'start' })
    await loaded()
    const recorder = ports.recorder as FakePort
    return { overlay, recorder }
  }

  it('asks for a key before it opens anything', async () => {
    await deleteKey()
    const overlay = popover()
    overlay.receive({ type: 'start' })
    await flush()
    expect(overlay.posted).toEqual([{ state: 'failed', error: 'no-key', retry: false }])
    expect(ports.created).toEqual([])
  })

  it('opens a recorder and starts it with the key, model and language', async () => {
    await fakeBrowser.storage.local.set({ [VOICE_KEY]: { model: 'a/b', language: 'de' } })
    const { recorder } = await started()
    expect(ports.created).toEqual([
      {
        url: expect.stringMatching(/^offscreen\.html\?/),
        reasons: ['USER_MEDIA'],
        justification: expect.stringMatching(/microphone/i),
      },
    ])
    expect(recorder.posted).toEqual([
      { type: 'start', request: { key: KEY, model: 'a/b', language: 'de' } },
    ])
  })

  it('uses the default model and automatic language when none is set', async () => {
    const { recorder } = await started()
    expect(recorder.posted[0]).toEqual({
      type: 'start',
      request: { key: KEY, model: DEFAULT_MODEL, language: 'auto' },
    })
  })

  it("relays the recorder's states, but not its heartbeat, and never the key", async () => {
    const { overlay, recorder } = await started()
    recorder.receive({ state: 'starting' })
    recorder.receive({ state: 'recording', limit: 120_000 })
    recorder.receive({ state: 'alive' })
    recorder.receive({ state: 'transcribing' })
    recorder.receive({ state: 'failed', error: 'offline', retry: true })
    expect(overlay.posted).toEqual([
      { state: 'starting' },
      { state: 'recording', limit: 120_000 },
      { state: 'transcribing' },
      { state: 'failed', error: 'offline', retry: true },
    ])
    expect(JSON.stringify(overlay.posted)).not.toContain(KEY)
  })

  it('ignores malformed messages from either side', async () => {
    const { overlay, recorder } = await started()
    recorder.receive({ state: 'done', text: 42, atLimit: false })
    recorder.receive({ state: 'failed', error: 'oops', retry: true })
    overlay.receive({ type: 'start', request: { key: OTHER_KEY, model: 'a/b', language: 'en' } })
    overlay.receive({ type: 'pause' })
    overlay.receive('stop')
    await flush()
    expect(overlay.posted).toEqual([])
    expect(recorder.posted).toHaveLength(1)
  })

  it('passes stop and cancel on', async () => {
    const { overlay, recorder } = await started()
    overlay.receive({ type: 'stop' })
    overlay.receive({ type: 'cancel' })
    await flush()
    expect(recorder.posted.slice(1)).toEqual([{ type: 'stop' }, { type: 'cancel' }])
  })

  it('reads the key and settings again for a retry', async () => {
    const { overlay, recorder } = await started()
    recorder.receive({ state: 'failed', error: 'invalid-key', retry: true })
    await storeKey(OTHER_KEY)
    await fakeBrowser.storage.local.set({ [VOICE_KEY]: { model: 'c/d', language: 'fr' } })
    overlay.receive({ type: 'retry' })
    await flush()
    expect(recorder.posted.at(-1)).toEqual({
      type: 'retry',
      request: { key: OTHER_KEY, model: 'c/d', language: 'fr' },
    })
  })

  it('says so when the key is gone at a retry, and keeps the audio', async () => {
    const { overlay, recorder } = await started()
    recorder.receive({ state: 'failed', error: 'invalid-key', retry: true })
    await deleteKey()
    overlay.receive({ type: 'retry' })
    await flush()
    expect(overlay.posted.at(-1)).toEqual({ state: 'failed', error: 'no-key', retry: true })
    expect(recorder.posted).toHaveLength(1)
    expect(ports.exists).toBe(true)
  })

  it('closes the recorder when the dictation is done, and opens a new one next time', async () => {
    const { overlay, recorder } = await started()
    recorder.receive({ state: 'done', text: 'Make it wider.', atLimit: false })
    await flush()
    expect(overlay.posted.at(-1)).toEqual({ state: 'done', text: 'Make it wider.', atLimit: false })
    expect(ports.exists).toBe(false)
    expect(overlay.posted).toHaveLength(1)
    overlay.receive({ type: 'start' })
    await loaded()
    expect(ports.created).toHaveLength(2)
    expect(ports.recorder?.posted[0]).toMatchObject({ type: 'start' })
  })

  it.each([
    [{ state: 'idle' }],
    [{ state: 'failed', error: 'no-speech', retry: false }],
    [{ state: 'failed', error: 'mic-not-granted', retry: false }],
  ])('closes the recorder once it holds nothing: %j', async (state) => {
    const { recorder } = await started()
    recorder.receive(state)
    await flush()
    expect(ports.exists).toBe(false)
  })

  it('keeps the recorder while it holds audio for a retry', async () => {
    const { recorder } = await started()
    recorder.receive({ state: 'failed', error: 'offline', retry: true })
    await flush()
    expect(ports.exists).toBe(true)
  })

  it('ends everything when the popover goes', async () => {
    const { overlay, recorder } = await started()
    recorder.receive({ state: 'recording', limit: 120_000 })
    overlay.close()
    await flush()
    expect(recorder.disconnected || ports.exists === false).toBe(true)
    expect(ports.exists).toBe(false)
  })

  it('cancels a start whose popover went while the recorder opened', async () => {
    const overlay = popover()
    overlay.receive({ type: 'start' })
    overlay.close()
    await loaded()
    expect(ports.recorder?.posted ?? []).toEqual([])
    expect(ports.exists).toBe(false)
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
    expect(recorder.posted[0]).toMatchObject({ type: 'start' })
  })

  it('ends the first dictation when another popover starts one', async () => {
    const first = await started(5)
    first.recorder.receive({ state: 'recording', limit: 120_000 })
    const second = await started(6)
    expect(first.overlay.posted.at(-1)).toEqual({ state: 'failed', error: 'taken', retry: false })
    expect(ports.created).toHaveLength(2)
    expect(second.recorder.posted[0]).toMatchObject({ type: 'start' })
    second.recorder.receive({ state: 'transcribing' })
    expect(first.overlay.posted.at(-1)).toMatchObject({ state: 'failed', error: 'taken' })
    expect(second.overlay.posted).toEqual([{ state: 'transcribing' }])
  })

  // The review found these: a recorder document connects while it loads, and must reach the
  // dictation that opened it, not whichever waits next.
  it('starts again cleanly when cancelled while the recorder loads', async () => {
    const overlay = popover()
    overlay.receive({ type: 'start' })
    await flush()
    overlay.receive({ type: 'cancel' })
    overlay.receive({ type: 'start' })
    await loaded()
    await loaded()
    const recorder = ports.recorder as FakePort
    expect(recorder.disconnected).toBe(false)
    expect(recorder.posted).toEqual([
      { type: 'start', request: { key: KEY, model: DEFAULT_MODEL, language: 'auto' } },
    ])
    expect(ports.exists).toBe(true)
    recorder.receive({ state: 'recording', limit: 120_000 })
    expect(overlay.posted.at(-1)).toEqual({ state: 'recording', limit: 120_000 })
  })

  it('gives the recorder to the popover that started last while one loads', async () => {
    const first = popover(5)
    first.receive({ type: 'start' })
    await flush()
    const second = popover(6)
    second.receive({ type: 'start' })
    await loaded()
    await loaded()
    expect(first.posted).toEqual([{ state: 'failed', error: 'taken', retry: false }])
    const recorder = ports.recorder as FakePort
    expect(recorder.posted).toEqual([{ type: 'start', request: expect.anything() }])
    recorder.receive({ state: 'recording', limit: 120_000 })
    expect(second.posted).toEqual([{ state: 'recording', limit: 120_000 }])
  })

  it('says so when the recorder dies before it gets its start', async () => {
    ports.dies = true
    const { overlay } = await started()
    expect(overlay.posted).toEqual([{ state: 'failed', error: 'mic-failed', retry: false }])
    expect(ports.exists).toBe(false)
  })

  it('tells the popover when the recorder goes away by itself', async () => {
    const { overlay, recorder } = await started()
    recorder.receive({ state: 'recording', limit: 120_000 })
    recorder.close()
    await flush()
    expect(overlay.posted.at(-1)).toEqual({ state: 'failed', error: 'interrupted', retry: false })
  })

  it('gives up when the recorder does not connect within 5 seconds', async () => {
    ports.connects = false
    const overlay = popover()
    overlay.receive({ type: 'start' })
    // The key is read and the document created; then the wait runs.
    await flush()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(overlay.posted).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await flush()
    expect(overlay.posted).toEqual([{ state: 'failed', error: 'mic-failed', retry: false }])
    expect(ports.exists).toBe(false)
  })

  it('dictates for the panel as for a popover: Rec copies what the recorder sends', async () => {
    const panel = fakePort('voice', panelSender())
    ports.connect(panel)
    panel.receive({ type: 'start' })
    await loaded()
    const recorder = ports.recorder as FakePort
    expect(recorder.posted[0]).toMatchObject({ type: 'start', request: { key: KEY } })
    recorder.receive({ state: 'recording', limit: 120_000 })
    panel.receive({ type: 'stop' })
    expect(recorder.posted.at(-1)).toEqual({ type: 'stop' })
    recorder.receive({ state: 'done', text: 'Hello', atLimit: false })
    expect(panel.posted).toEqual([
      { state: 'recording', limit: 120_000 },
      { state: 'done', text: 'Hello', atLimit: false },
    ])
    await flush()
    expect(ports.exists).toBe(false)
  })

  it("ends a popover's dictation when the panel starts one, and the other way round", async () => {
    const first = await started(5)
    first.recorder.receive({ state: 'recording', limit: 120_000 })
    const panel = fakePort('voice', panelSender())
    ports.connect(panel)
    panel.receive({ type: 'start' })
    await loaded()
    expect(first.overlay.posted.at(-1)).toEqual({ state: 'failed', error: 'taken', retry: false })
    const second = await started(6)
    expect(panel.posted.at(-1)).toEqual({ state: 'failed', error: 'taken', retry: false })
    expect(second.recorder.posted[0]).toMatchObject({ type: 'start' })
  })

  it.each([
    ['a subframe', fakePort('voice', overlaySender(5, 3))],
    ['another page of the extension', fakePort('voice', panelSender('/mic-permission.html'))],
    [
      "another extension's panel",
      fakePort('voice', { id: fakeBrowser.runtime.id, url: 'chrome-extension://x/sidepanel.html' }),
    ],
    ['another extension', fakePort('voice', { ...overlaySender(), id: 'another-extension' })],
  ])('refuses a dictation port from %s', async (_, port) => {
    ports.connect(port)
    port.receive({ type: 'start' })
    await flush()
    expect(port.disconnected).toBe(true)
    expect(ports.created).toEqual([])
  })

  it('refuses recorder ports from other pages and when no dictation waits', async () => {
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

  it.each([
    ['the panel', { id: fakeBrowser.runtime.id, url: 'chrome-extension://x/sidepanel.html' }],
    ['a subframe', overlaySender(5, 2)],
  ])('refuses both from %s', async (_, sender) => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never)
    const open = vi.spyOn(fakeBrowser.sidePanel, 'open').mockResolvedValue(undefined)
    expect(await send({ type: 'voice:grant' }, sender)).toMatchObject({ ok: false })
    expect(await send({ type: 'voice:settings' }, sender)).toMatchObject({ ok: false })
    expect(create).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })
})

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
