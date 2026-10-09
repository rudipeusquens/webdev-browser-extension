import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'puppeteer'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FAKE_TEXT, startFakeOpenRouter } from './fake-openrouter'
import { setKey } from './voice-helpers'
import {
  clickAction,
  EXTENSION_DIR,
  launch,
  serviceWorker,
  type Session,
  setMicrophone,
  startFixtureServer,
  startOverlayAgain,
} from './harness'
import {
  clickInOverlay,
  contentField,
  markElement,
  overlayMounted,
  overlayText,
  sleep,
  waitInOverlay,
} from './overlay-helpers'

// Dictation end to end (spec sections 5, 8, 9, 12): Chrome's fake microphone, the shipped
// build pointed at a local fake OpenRouter. Not a real key: no test reaches the real API. A
// stopped dictation saves its pin and closes the popover; the text follows in the background.
const KEY = 'test-key-e2e-1234'

/** What the tests use of the extension API in the service worker. */
interface ExtensionApi {
  storage: {
    local: {
      get(key: string | null): Promise<Record<string, unknown>>
      set(items: Record<string, unknown>): Promise<void>
      remove(key: string): Promise<void>
    }
  }
  runtime: { getContexts(filter: { contextTypes: string[] }): Promise<unknown[]> }
}

interface Item {
  id: string
  number: number
  comment: string
  status: string
  draft?: true
}

describe('dictating a comment', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let fake: Awaited<ReturnType<typeof startFakeOpenRouter>>
  let s: Session

  beforeAll(async () => {
    server = await startFixtureServer()
    fake = await startFakeOpenRouter()
    s = await launch({ openrouter: fake.origin, microphone: 'granted' })
    await s.browser
      .defaultBrowserContext()
      .overridePermissions(`chrome-extension://${s.extensionId}`, [
        'clipboard-read',
        'clipboard-sanitized-write',
      ])
    await s.page.goto(`${server.origin}/plain/`)
    // The toolbar click grants activeTab and opens the panel; later tests start overlays
    // without toggling it.
    await clickAction(s)
    await overlayMounted(s)
  })

  afterAll(async () => {
    await s?.browser.close()
    await fake?.close()
    await server?.close()
  })

  beforeEach(async () => {
    // A popover the last test left open is kept when its page goes: before the storage is
    // cleared, not in the middle of this test. The same site keeps the toolbar's grant.
    await s.page.goto(`${server.origin}/plain/`)
    await sleep(300)
    fake.reset()
    await setMicrophone(s, 'granted')
    await setKey(s, KEY)
    await clearStorage()
  })

  /** A fresh page with a fresh overlay and the comment popover open on the submit button. */
  async function popover() {
    await s.page.goto(`${server.origin}/plain/`)
    await startOverlayAgain(s)
    await overlayMounted(s)
    await markElement(s, 'button[type="submit"]')
    // The popover asked whether a key is saved: Space dictates once it knows.
    await waitInOverlay(s, '[data-testid="overlay-popover"][data-voice-ready]')
  }

  /** Waits until the overlay element `selector` contains `text`. */
  async function waitForText(selector: string, text: string) {
    for (let i = 0; i < 150; i++) {
      if ((await overlayText(s, selector))?.includes(text)) return
      await sleep(100)
    }
    const message = await overlayText(s, '[data-testid="overlay-voice-message"]')
    throw new Error(
      `${selector} never said "${text}": ${await overlayText(s, selector)} (${message})`,
    )
  }

  async function offscreenDocuments(): Promise<number> {
    const worker = await serviceWorker(s)
    return worker.evaluate(async () => {
      const { runtime } = (globalThis as unknown as { chrome: ExtensionApi }).chrome
      return (await runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length
    })
  }

  /** Everything in chrome.storage.local. */
  async function stored(): Promise<Record<string, unknown>> {
    const worker = await serviceWorker(s)
    return worker.evaluate(async () => {
      const { storage } = (globalThis as unknown as { chrome: ExtensionApi }).chrome
      return storage.local.get(null)
    })
  }

  /** No pins, no dictations, no notes: each test starts from nothing. */
  async function clearStorage() {
    const worker = await serviceWorker(s)
    await worker.evaluate(async () => {
      const { storage } = (globalThis as unknown as { chrome: ExtensionApi }).chrome
      const all = await storage.local.get(null)
      for (const key of Object.keys(all)) {
        if (/^(collection:|dictation:|notes$)/.test(key)) await storage.local.remove(key)
      }
    })
  }

  /** The pins of the fixture site, once `ready` holds for them. */
  async function items(ready: (items: Item[]) => boolean = (i) => i.length > 0): Promise<Item[]> {
    let last: Item[] = []
    for (let i = 0; i < 100; i++) {
      const all = await stored()
      last = Object.entries(all)
        .filter(([key]) => key.startsWith('collection:'))
        .flatMap(([, c]) => (c as { items: Item[] }).items)
      if (ready(last)) return last
      await sleep(100)
    }
    throw new Error(`the pins never got there: ${JSON.stringify(last)}`)
  }

  /** The pin's dictation state, as the panel and the overlay read it. */
  async function dictations(): Promise<Record<string, unknown>> {
    const all = await stored()
    const entry = Object.entries(all).find(([key]) => key.startsWith('dictation:'))
    return (entry?.[1] as Record<string, unknown>) ?? {}
  }

  async function space() {
    await s.page.keyboard.press('Space')
  }

  async function altV() {
    await s.page.keyboard.down('Alt')
    await s.page.keyboard.press('KeyV')
    await s.page.keyboard.up('Alt')
  }

  it('records with Space, closes on Space, and fills the pin in the background', async () => {
    fake.reply(200, { text: FAKE_TEXT }, 1500)
    await popover()
    await space()
    await waitForText('[data-testid="overlay-voice-status"]', '· Space to stop')
    await sleep(1200)
    expect(await overlayText(s, '[data-testid="overlay-voice-status"]')).toMatch(/0:0[1-9]/)
    await space()
    // The popover closes at once: the pin is a draft until its text is there.
    await waitInOverlay(s, '[data-testid="overlay-popover"]', false)
    const [draft] = await items()
    expect(draft).toMatchObject({ comment: '', draft: true, status: 'open' })
    expect(await dictations()).toEqual({ [draft!.id]: { state: 'transcribing' } })
    // The panel shows it transcribing, the pin pulses.
    const panel = await panelPage()
    await panel.waitForSelector('[data-testid="item-transcribing"]')
    await waitInOverlay(s, '[data-testid="overlay-pin"][data-transcribing]')

    const [filled] = await items((i) => i[0]?.comment === FAKE_TEXT)
    expect(filled?.draft).toBeUndefined()
    expect(await dictations()).toEqual({})
    await waitInOverlay(s, '[data-testid="overlay-pin"][data-transcribing]', false)
    for (let i = 0; i < 30 && (await offscreenDocuments()) > 0; i++) await sleep(100)
    expect(await offscreenDocuments()).toBe(0)

    const [request] = fake.transcriptions()
    expect(fake.transcriptions()).toHaveLength(1)
    expect(request?.authorization).toBe(`Bearer ${KEY}`)
    const body = request?.body as {
      model: string
      input_audio: { data: string; format: string }
      provider: unknown
      language?: string
    }
    expect(Object.keys(body).sort()).toEqual(['input_audio', 'model', 'provider'])
    expect(body.model).toBe('openai/gpt-4o-mini-transcribe')
    expect(body.input_audio.format).toBe('webm')
    // The EBML header of a WebM file.
    expect(Buffer.from(body.input_audio.data, 'base64').subarray(0, 4)).toEqual(
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    )
    expect(body.provider).toEqual({ data_collection: 'deny' })
    expect(JSON.stringify(body)).not.toContain(KEY)
    await s.page.bringToFront()
  })

  it('types a space in a comment with text, stops on Enter and appends the text', async () => {
    await popover()
    await s.page.keyboard.type('Fix this')
    expect(await contentField(s)).toBe('Fix this')
    await altV()
    await waitForText('[data-testid="overlay-voice-status"]', '· Alt+V to stop')
    await space()
    expect(await contentField(s)).toBe('Fix this ')
    await sleep(800)
    await s.page.keyboard.press('Enter')
    await waitInOverlay(s, '[data-testid="overlay-popover"]', false)
    const [pin] = await items((i) => i[0]?.comment.includes(FAKE_TEXT) ?? false)
    expect(pin?.comment).toBe(`Fix this ${FAKE_TEXT}`)
    expect(pin?.draft).toBeUndefined()

    // The dictated comment is in the prompt the panel copies.
    const panel = await panelPage()
    await panel.click('[data-testid="copy-prompt"]')
    await panel.waitForSelector('::-p-text(Copied 1 pin)')
    const prompt = await panel.evaluate(() => navigator.clipboard.readText())
    expect(prompt).toContain(`> Fix this ${FAKE_TEXT}`)
    await s.page.bringToFront()
  })

  it('sends nothing when Escape cancels the recording, and keeps the comment open', async () => {
    await popover()
    await space()
    await waitForText('[data-testid="overlay-voice-status"]', '· Space to stop')
    await sleep(600)
    await s.page.keyboard.press('Escape')
    for (let i = 0; i < 100; i++) {
      if ((await overlayText(s, '[data-testid="overlay-voice-status"]'))?.trim() === '') break
      await sleep(100)
    }
    expect((await overlayText(s, '[data-testid="overlay-voice-status"]'))?.trim()).toBe('')
    await sleep(300)
    expect(fake.transcriptions()).toHaveLength(0)
    expect(await offscreenDocuments()).toBe(0)
    await waitInOverlay(s, '[data-testid="overlay-popover"]')
    // The next Esc closes it and keeps the pin as a grey draft.
    await s.page.keyboard.press('Escape')
    await waitInOverlay(s, '[data-testid="overlay-popover"]', false)
    expect((await items())[0]).toMatchObject({ comment: '', draft: true })
  })

  it('hands the recording over when the page reloads: the text still arrives', async () => {
    await popover()
    await space()
    await waitForText('[data-testid="overlay-voice-status"]', '· Space to stop')
    await sleep(800)
    await s.page.reload()
    const [pin] = await items((i) => i[0]?.comment === FAKE_TEXT)
    expect(pin?.draft).toBeUndefined()
  })

  it('shows a failure on the pin, and Retry sends the same recording again', async () => {
    fake.reply(500, { error: { message: 'Upstream failed' } })
    await popover()
    await space()
    await waitForText('[data-testid="overlay-voice-status"]', '· Space to stop')
    await sleep(800)
    await space()
    const panel = await panelPage()
    const failure = await panel.waitForSelector('[data-testid="item-job"]')
    expect(await failure?.evaluate((el) => el.textContent)).toContain('Transcription failed.')
    await panel.click('[data-testid="item-job-retry"]')
    const [pin] = await items((i) => i[0]?.comment === FAKE_TEXT)
    expect(pin?.draft).toBeUndefined()
    const [first, second] = fake.transcriptions()
    expect(fake.transcriptions()).toHaveLength(2)
    expect((second?.body as { input_audio: unknown }).input_audio).toEqual(
      (first?.body as { input_audio: unknown }).input_audio,
    )
    await panel.waitForSelector('[data-testid="item-job"]', { hidden: true })
    await s.page.bringToFront()
  })

  it.each([
    [401, { error: { message: 'Missing Authentication header' } }, 'Invalid API key.'],
    [200, { text: '' }, 'No speech detected.'],
    [
      400,
      { error: { message: 'Model a/b does not exist' } },
      'Transcription failed: Model a/b does not exist',
    ],
  ])('says on the pin what HTTP %i with %j means', async (status, body, text) => {
    fake.reply(status, body)
    await popover()
    await space()
    await waitForText('[data-testid="overlay-voice-status"]', '· Space to stop')
    await sleep(600)
    await space()
    const panel = await panelPage()
    await panel.waitForSelector(`[data-testid="item-job"] ::-p-text(${text})`)
    // Its popover says so too.
    await s.page.bringToFront()
    await clickInOverlay(s, '[data-testid="overlay-pin"]')
    await waitForText('[data-testid="overlay-voice-message"]', text)
    await s.page.keyboard.press('Escape')
  })

  it('pauses at the limit and asks; Keep goes on, Stop hands it over', async () => {
    const worker = await serviceWorker(s)
    await worker.evaluate(async () => {
      const { storage } = (globalThis as unknown as { chrome: ExtensionApi }).chrome
      await storage.local.set({ voice: { model: 'a/b', language: 'auto', limit: 10_000 } })
    })
    try {
      await popover()
      await space()
      await waitForText('[data-testid="overlay-voice-limit"]', 'Paused at 0:10. Keep recording?')
      await clickInOverlay(s, '[data-testid="overlay-voice-keep"]')
      await waitForText('[data-testid="overlay-voice-status"]', '· Space to stop')
      await sleep(500)
      await clickInOverlay(s, '[data-testid="overlay-mic"]')
      await waitInOverlay(s, '[data-testid="overlay-popover"]', false)
      await items((i) => i[0]?.comment === FAKE_TEXT)
    } finally {
      await worker.evaluate(async () => {
        const { storage } = (globalThis as unknown as { chrome: ExtensionApi }).chrome
        await storage.local.remove('voice')
      })
    }
  })

  it("hands a pin's recording over when Rec starts in the panel", async () => {
    await popover()
    await space()
    await waitForText('[data-testid="overlay-voice-status"]', '· Space to stop')
    await sleep(600)
    const panel = await panelPage()
    await panel.click('[data-testid="rec"]')
    // The pin's recording went to the background; Rec records now.
    await panel.waitForSelector('[data-testid="rec"][data-dictation="recording"]')
    await items((i) => i[0]?.comment === FAKE_TEXT)
    await panel.keyboard.press('Escape')
    await panel.waitForSelector('[data-testid="rec"][data-dictation="idle"]')
    await s.page.bringToFront()
  })

  it('opens the panel on its settings when there is no key, also when it was closed', async () => {
    await setKey(s, null)
    // The panel closes itself (as on a second click on the toolbar icon).
    await (await panelPage()).evaluate(() => window.close())
    for (let i = 0; i < 50 && (await panelTarget()); i++) await sleep(100)
    expect(await panelTarget()).toBeUndefined()
    await s.page.bringToFront()
    await s.page.goto(`${server.origin}/plain/`)
    await startOverlayAgain(s)
    await overlayMounted(s)
    await markElement(s, 'button[type="submit"]')
    // Without a key, Space types.
    await sleep(300)
    await space()
    expect(await contentField(s)).toBe(' ')
    // Audio an earlier test's failure holds may keep a document open; no key opens none.
    const before = await offscreenDocuments()
    await clickInOverlay(s, '[data-testid="overlay-mic"]')
    await waitForText(
      '[data-testid="overlay-voice-message"]',
      'Add an OpenRouter API key in settings.',
    )
    expect(await offscreenDocuments()).toBe(before)
    await clickInOverlay(s, '[data-testid="overlay-voice-settings"]')
    const panel = await panelPage()
    await panel.waitForSelector('[data-testid="voice-settings"]')
  })

  it('asks to grant the microphone, and opens the microphone page', async () => {
    await setMicrophone(s, 'prompt')
    await popover()
    await clickInOverlay(s, '[data-testid="overlay-mic"]')
    await waitForText('[data-testid="overlay-voice-message"]', 'Allow the microphone first.')
    await clickInOverlay(s, '[data-testid="overlay-voice-grant"]')
    const target = await s.browser.waitForTarget(
      (t) => t.url() === `chrome-extension://${s.extensionId}/mic-permission.html`,
    )
    const page = await target.asPage()
    await page.close()
    await s.page.bringToFront()
  })

  it('sets up the key, the language and the limit in the panel', async () => {
    await setKey(s, null)
    fake.validKeys.add(KEY)
    await s.page.goto(`${server.origin}/plain/`)
    await startOverlayAgain(s)
    const panel = await panelPage()
    if (!(await panel.$('[data-testid="voice-settings"]')))
      await panel.click('[data-testid="open-settings"]')
    await panel.waitForSelector('[data-testid="voice-key-input"]')
    await panel.type('[data-testid="voice-key-input"]', KEY)
    await panel.click('[data-testid="voice-key-save"]')
    await panel.waitForSelector('[data-testid="voice-key-masked"]')
    expect(await panel.$eval('[data-testid="voice-key-masked"]', (el) => el.textContent)).toBe(
      '…1234',
    )
    expect(await panel.content()).not.toContain(KEY)
    // Never in chrome.storage, which content scripts can read and whose changes reach them.
    expect(JSON.stringify(await stored())).not.toContain(KEY)
    await panel.click('[data-testid="voice-key-test"]')
    await panel.waitForSelector('[data-testid="voice-key-result"] ::-p-text(Key works.)')
    expect(fake.requests.find((r) => r.path === '/api/v1/key')?.authorization).toBe(`Bearer ${KEY}`)
    await panel.select('[data-testid="voice-language"]', 'de')
    await panel.select('[data-testid="voice-model"]', 'openai/whisper-large-v3-turbo')
    await panel.select('[data-testid="voice-limit"]', '600000')
    await sleep(300)
    expect((await stored()).voice).toEqual({
      model: 'openai/whisper-large-v3-turbo',
      language: 'de',
      limit: 600_000,
    })

    await s.page.bringToFront()
    await overlayMounted(s)
    await markElement(s, 'button[type="submit"]')
    await clickInOverlay(s, '[data-testid="overlay-mic"]')
    await waitForText('[data-testid="overlay-voice-status"]', '· Space to stop')
    await sleep(600)
    await clickInOverlay(s, '[data-testid="overlay-mic"]')
    await items((i) => i[0]?.comment === FAKE_TEXT)
    expect(fake.transcriptions()[0]?.body).toMatchObject({
      model: 'openai/whisper-large-v3-turbo',
      language: 'de',
    })

    await panel.click('[data-testid="voice-key-remove"]')
    await panel.waitForSelector('[data-testid="voice-key-input"]')
    const worker = await serviceWorker(s)
    await worker.evaluate(async () => {
      const { storage } = (globalThis as unknown as { chrome: ExtensionApi }).chrome
      await storage.local.remove('voice')
    })
    await panel.click('[data-testid="close-settings"]')
  })

  it('keeps the key out of the overlay script', async () => {
    const overlay = await readFile(join(EXTENSION_DIR, 'content-scripts/overlay.js'), 'utf8')
    expect(overlay).not.toContain('openrouterKey')
    expect(overlay).not.toContain('openrouter.ai')
  })

  const panelTarget = async () =>
    s.browser
      .targets()
      .find((t) => t.url() === `chrome-extension://${s.extensionId}/sidepanel.html`)

  /** The open side panel, opened again when it was closed. */
  async function panelPage(): Promise<Page> {
    if (!(await panelTarget())) await clickAction(s)
    const target = await s.browser.waitForTarget(
      (t) => t.url() === `chrome-extension://${s.extensionId}/sidepanel.html`,
    )
    const panel = await target.asPage()
    await panel.setViewport({ width: 400, height: 900 })
    return panel
  }
})
