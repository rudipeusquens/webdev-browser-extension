import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FAKE_TEXT, startFakeOpenRouter } from './fake-openrouter'
import { setKey } from './voice-helpers'
import {
  clickAction,
  contentRealm,
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
  markElement,
  overlayMounted,
  overlayText,
  sleep,
  waitInOverlay,
} from './overlay-helpers'

// Dictation end to end (spec sections 5, 9, 12): Chrome's fake microphone, the shipped build
// pointed at a local fake OpenRouter. Not a real key: no test reaches the real API.
const KEY = 'test-key-e2e-1234'

/** What the tests use of the extension API in the service worker. */
interface ExtensionApi {
  storage: {
    local: {
      get(key: string | null): Promise<Record<string, unknown>>
    }
  }
  runtime: { getContexts(filter: { contextTypes: string[] }): Promise<unknown[]> }
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
    fake.reset()
    await setMicrophone(s, 'granted')
    await setKey(s, KEY)
  })

  /** A fresh page with a fresh overlay and the comment popover open on the submit button. */
  async function popover() {
    await s.page.goto(`${server.origin}/plain/`)
    await startOverlayAgain(s)
    await overlayMounted(s)
    await markElement(s, 'button[type="submit"]')
  }

  async function field(): Promise<string> {
    const realm = await contentRealm(s)
    return realm.evaluate(
      () =>
        (
          globalThis.__webdevOverlay?.shadow?.querySelector(
            'textarea',
          ) as HTMLTextAreaElement | null
        )?.value ?? '',
    )
  }

  /** Waits until the overlay element `selector` contains `text`. */
  async function waitForText(selector: string, text: string) {
    for (let i = 0; i < 100; i++) {
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

  async function record(ms = 1200) {
    await clickInOverlay(s, '[data-testid="overlay-mic"]')
    await waitForText('[data-testid="overlay-voice-status"]', '· Alt+V to stop')
    await sleep(ms)
  }

  it('records, transcribes at the caret and saves the comment', async () => {
    await popover()
    await s.page.keyboard.type('Fix this')
    await record()
    expect(await overlayText(s, '[data-testid="overlay-voice-status"]')).toMatch(/0:0[1-9]/)
    await clickInOverlay(s, '[data-testid="overlay-mic"]')
    for (let i = 0; i < 50 && !(await field()).includes(FAKE_TEXT); i++) await sleep(100)
    expect(await field()).toBe(`Fix this ${FAKE_TEXT}`)
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

    await s.page.keyboard.press('Enter')
    expect(await savedComments()).toEqual([`Fix this ${FAKE_TEXT}`])

    // The dictated comment is in the prompt the panel copies.
    const panel = await panelPage()
    await panel.click('[data-testid="copy-prompt"]')
    await panel.waitForSelector('::-p-text(Copied 1 item)')
    const prompt = await panel.evaluate(() => navigator.clipboard.readText())
    expect(prompt).toContain(`> Fix this ${FAKE_TEXT}`)
    await panel.click('[data-testid="clear-all"]')
    await panel.click('[data-testid="clear-confirm"]')
    await s.page.bringToFront()
  })

  it('keeps what is typed while it records', async () => {
    await popover()
    await record(600)
    await clickInOverlay(s, 'textarea')
    await s.page.keyboard.type('Typed meanwhile')
    await s.page.keyboard.down('Alt')
    await s.page.keyboard.press('KeyV')
    await s.page.keyboard.up('Alt')
    for (let i = 0; i < 50 && !(await field()).includes(FAKE_TEXT); i++) await sleep(100)
    expect(await field()).toBe(`Typed meanwhile ${FAKE_TEXT}`)
  })

  it('starts and stops on Alt+V', async () => {
    await popover()
    await s.page.keyboard.down('Alt')
    await s.page.keyboard.press('KeyV')
    await s.page.keyboard.up('Alt')
    await waitForText('[data-testid="overlay-voice-status"]', '· Alt+V to stop')
    await sleep(800)
    await s.page.keyboard.down('Alt')
    await s.page.keyboard.press('KeyV')
    await s.page.keyboard.up('Alt')
    for (let i = 0; i < 50 && !(await field()); i++) await sleep(100)
    expect(await field()).toBe(FAKE_TEXT)
  })

  it('sends nothing when Escape cancels the recording, and keeps the comment', async () => {
    await popover()
    await record(600)
    await s.page.keyboard.press('Escape')
    await waitForText('[data-testid="overlay-voice-status"]', 'Enter to save')
    await sleep(300)
    expect(fake.transcriptions()).toHaveLength(0)
    expect(await offscreenDocuments()).toBe(0)
    await waitInOverlay(s, '[data-testid="overlay-popover"]')
  })

  it('inserts nothing when the comment closes while it transcribes', async () => {
    fake.reply(200, { text: 'Too late.' }, 1500)
    await popover()
    await record(600)
    await clickInOverlay(s, '[data-testid="overlay-mic"]')
    await waitForText('[data-testid="overlay-voice-status"]', 'Transcribing')
    await clickInOverlay(s, '[aria-label="Cancel"]')
    await waitInOverlay(s, '[data-testid="overlay-popover"]', false)
    await sleep(2000)
    expect(await offscreenDocuments()).toBe(0)
    await markElement(s, 'button[type="submit"]')
    expect(await field()).toBe('')
  })

  it('retries a failed request with the same recording', async () => {
    fake.reply(500, { error: { message: 'Upstream failed' } })
    await popover()
    await record()
    await clickInOverlay(s, '[data-testid="overlay-mic"]')
    await waitForText('[data-testid="overlay-voice-message"]', 'Transcription failed.')
    expect(await field()).toBe('')
    await clickInOverlay(s, '[data-testid="overlay-voice-retry"]')
    for (let i = 0; i < 50 && !(await field()); i++) await sleep(100)
    expect(await field()).toBe(FAKE_TEXT)
    const [first, second] = fake.transcriptions()
    expect(fake.transcriptions()).toHaveLength(2)
    expect((second?.body as { input_audio: unknown }).input_audio).toEqual(
      (first?.body as { input_audio: unknown }).input_audio,
    )
  })

  it.each([
    [401, { error: { message: 'Missing Authentication header' } }, 'Invalid API key.'],
    [200, { text: '' }, 'No speech detected.'],
    [
      400,
      { error: { message: 'Model a/b does not exist' } },
      'Transcription failed: Model a/b does not exist',
    ],
  ])('says what HTTP %i with %j means', async (status, body, text) => {
    fake.reply(status, body)
    await popover()
    await record(600)
    await clickInOverlay(s, '[data-testid="overlay-mic"]')
    await waitForText('[data-testid="overlay-voice-message"]', text)
  })

  it('opens the panel on its settings when there is no key, also when it was closed', async () => {
    await setKey(s, null)
    // The panel closes itself (as on a second click on the toolbar icon).
    await (await panelPage()).evaluate(() => window.close())
    for (let i = 0; i < 50 && (await panelTarget()); i++) await sleep(100)
    expect(await panelTarget()).toBeUndefined()
    await s.page.bringToFront()
    await popover()
    await clickInOverlay(s, '[data-testid="overlay-mic"]')
    await waitForText(
      '[data-testid="overlay-voice-message"]',
      'Add an OpenRouter API key in settings.',
    )
    expect(await offscreenDocuments()).toBe(0)
    await clickInOverlay(s, '[data-testid="overlay-voice-settings"]')
    const target = await s.browser.waitForTarget(
      (t) => t.url() === `chrome-extension://${s.extensionId}/sidepanel.html`,
    )
    const panel = await target.asPage()
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

  it('sets up the key and the language in the panel', async () => {
    await setKey(s, null)
    fake.validKeys.add(KEY)
    await s.page.goto(`${server.origin}/plain/`)
    await startOverlayAgain(s)
    const target = await s.browser.waitForTarget(
      (t) => t.url() === `chrome-extension://${s.extensionId}/sidepanel.html`,
    )
    const panel = await target.asPage()
    await panel.setViewport({ width: 400, height: 900 })
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
    expect(await storageText()).not.toContain(KEY)
    await panel.click('[data-testid="voice-key-test"]')
    await panel.waitForSelector('[data-testid="voice-key-result"] ::-p-text(Key works.)')
    expect(fake.requests.find((r) => r.path === '/api/v1/key')?.authorization).toBe(`Bearer ${KEY}`)
    await panel.select('[data-testid="voice-language"]', 'de')
    await panel.select('[data-testid="voice-model"]', 'openai/whisper-large-v3-turbo')
    await sleep(300)

    await s.page.bringToFront()
    await overlayMounted(s)
    await markElement(s, 'button[type="submit"]')
    await record(600)
    await clickInOverlay(s, '[data-testid="overlay-mic"]')
    for (let i = 0; i < 50 && !(await field()); i++) await sleep(100)
    expect(fake.transcriptions()[0]?.body).toMatchObject({
      model: 'openai/whisper-large-v3-turbo',
      language: 'de',
    })

    await panel.click('[data-testid="voice-key-remove"]')
    await panel.waitForSelector('[data-testid="voice-key-input"]')
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

  /** The open side panel. */
  async function panelPage() {
    const target = await s.browser.waitForTarget(
      (t) => t.url() === `chrome-extension://${s.extensionId}/sidepanel.html`,
    )
    const panel = await target.asPage()
    await panel.setViewport({ width: 400, height: 900 })
    return panel
  }

  /** Everything in chrome.storage.local, as JSON. */
  async function storageText(): Promise<string> {
    const worker = await serviceWorker(s)
    return worker.evaluate(async () => {
      const { storage } = (globalThis as unknown as { chrome: ExtensionApi }).chrome
      return JSON.stringify(await storage.local.get(null))
    })
  }

  /** The comments of the stored collection, once there is one. */
  async function savedComments(): Promise<string[]> {
    const worker = await serviceWorker(s)
    for (let i = 0; i < 50; i++) {
      const comments = await worker.evaluate(async () => {
        const { storage } = (globalThis as unknown as { chrome: ExtensionApi }).chrome
        const { collection } = await storage.local.get('collection')
        return ((collection as { items?: { comment: string }[] } | undefined)?.items ?? []).map(
          (item) => item.comment,
        )
      })
      if (comments.length) return comments
      await sleep(100)
    }
    return []
  }
})
