import type { Page } from 'puppeteer'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FAKE_TEXT, startFakeOpenRouter } from './fake-openrouter'
import {
  clickAction,
  launch,
  serviceWorker,
  type Session,
  setMicrophone,
  startFixtureServer,
} from './harness'
import { markElement, overlayMounted, sleep, waitForItems } from './overlay-helpers'
import { setKey } from './voice-helpers'

// Rec end to end (spec sections 8 and 12): a dictation in the panel without a pin, with
// Chrome's fake microphone and the shipped build pointed at a local fake OpenRouter. The
// clipboard is written with the extension's own clipboardWrite permission: the tests grant
// reading it only.
const KEY = 'test-key-e2e-1234'

describe('Rec in the panel', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let fake: Awaited<ReturnType<typeof startFakeOpenRouter>>
  let s: Session
  let panel: Page

  beforeAll(async () => {
    server = await startFixtureServer()
    fake = await startFakeOpenRouter()
    s = await launch({ openrouter: fake.origin, microphone: 'granted' })
    await s.browser
      .defaultBrowserContext()
      .overridePermissions(`chrome-extension://${s.extensionId}`, ['clipboard-read'])
    await s.page.goto(`${server.origin}/plain/`)
    panel = await clickAction(s)
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

  const dictation = () =>
    panel.$eval('[data-testid="rec"]', (el) => (el as HTMLElement).dataset.dictation)

  async function waitForDictation(state: string) {
    await panel.waitForSelector(`[data-testid="rec"][data-dictation="${state}"]`)
  }

  async function status(): Promise<string> {
    return panel.$eval('[data-testid="copy-status"]', (el) => el.textContent?.trim() ?? '')
  }

  /** Reads the clipboard from the panel, which needs the focus for it. */
  async function clipboard(): Promise<string> {
    await panel.click('[data-testid="panel-title"]')
    return panel.evaluate(() => navigator.clipboard.readText())
  }

  async function offscreenDocuments(): Promise<number> {
    const worker = await serviceWorker(s)
    return worker.evaluate(async () => {
      const { runtime } = (
        globalThis as unknown as {
          chrome: { runtime: { getContexts(f: object): Promise<unknown[]> } }
        }
      ).chrome
      return (await runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length
    })
  }

  /** Records for `ms` from a click on Rec. */
  async function record(ms = 1200) {
    await panel.click('[data-testid="rec"]')
    await waitForDictation('recording')
    await sleep(ms)
  }

  it('copies the transcript as it is, also once the developer moved on to the page', async () => {
    // The answer comes after the developer left the panel: its document has no focus then.
    fake.reply(200, { text: FAKE_TEXT }, 1500)
    await record()
    await panel.click('[data-testid="rec"]')
    await waitForDictation('transcribing')
    await s.page.bringToFront()
    await s.page.click('body')
    expect(await panel.evaluate(() => document.hasFocus())).toBe(false)
    await panel.waitForFunction(
      () =>
        document.querySelector('[data-testid="copy-status"]')?.textContent === 'Copied dictation',
    )
    expect(await clipboard()).toBe(FAKE_TEXT)
    expect(await dictation()).toBe('done')
    // Nothing of the page goes along, and nothing became a pin.
    const [request] = fake.transcriptions()
    expect(fake.transcriptions()).toHaveLength(1)
    expect(Object.keys(request?.body as object).sort()).toEqual([
      'input_audio',
      'model',
      'provider',
    ])
    expect(await panel.$eval('[data-testid="filter-all"]', (el) => el.textContent)).toContain('0')
    expect(await offscreenDocuments()).toBe(0)
  })

  it('leaves the clipboard to Copy as prompt clicked while it was transcribed', async () => {
    await markElement(s, 'button[type="submit"]')
    await s.page.keyboard.type('Pin text')
    await s.page.keyboard.press('Enter')
    await waitForItems(panel, 1)
    fake.reply(200, { text: FAKE_TEXT }, 1500)
    await record(600)
    await panel.click('[data-testid="rec"]')
    await waitForDictation('transcribing')
    await panel.click('[data-testid="copy-prompt"]')
    await panel.waitForSelector('::-p-text(Copied 1 pin)')
    const offered = await panel.waitForSelector('[data-testid="copy-fallback-text"]')
    expect(await offered?.evaluate((el) => (el as HTMLTextAreaElement).value)).toBe(FAKE_TEXT)
    // Selected for Ctrl+C.
    expect(
      await offered?.evaluate((el) => {
        const field = el as HTMLTextAreaElement
        return [field.selectionStart, field.selectionEnd]
      }),
    ).toEqual([0, FAKE_TEXT.length])
    await panel.keyboard.press('Escape')
    await panel.waitForSelector('[data-testid="copy-fallback-text"]', { hidden: true })
    expect(await clipboard()).toContain('> Pin text')
    expect(await status()).toBe('Copied 1 pin')
  })

  it('starts and stops on Alt+V, and Escape cancels: nothing is sent', async () => {
    await panel.click('[data-testid="panel-title"]')
    await panel.keyboard.down('Alt')
    await panel.keyboard.press('KeyV')
    await panel.keyboard.up('Alt')
    await waitForDictation('recording')
    await sleep(600)
    await panel.keyboard.press('Escape')
    await waitForDictation('idle')
    await sleep(1000)
    expect(fake.transcriptions()).toHaveLength(0)
    expect(await offscreenDocuments()).toBe(0)
  })

  it('says when there is no key, and opens the settings', async () => {
    await setKey(s, null)
    await panel.click('[data-testid="rec"]')
    const message = await panel.waitForSelector('[data-testid="rec-message"]')
    expect(await message?.evaluate((el) => el.textContent)).toContain(
      'Add an OpenRouter API key in settings.',
    )
    expect(await offscreenDocuments()).toBe(0)
    await panel.click('[data-testid="rec-settings"]')
    await panel.waitForSelector('[data-testid="voice-settings"]')
    await panel.click('[data-testid="close-settings"]')
  })

  it('needs no overlay on the tab', async () => {
    await s.page.goto('about:blank')
    await panel.waitForSelector('[data-testid="tab-status"]')
    await record(600)
    await panel.click('[data-testid="rec"]')
    await panel.waitForFunction(
      () =>
        document.querySelector('[data-testid="copy-status"]')?.textContent === 'Copied dictation',
    )
    expect(await clipboard()).toBe(FAKE_TEXT)
  })

  it('ends the recording when the panel closes', async () => {
    await record(600)
    expect(await offscreenDocuments()).toBe(1)
    await panel.evaluate(() => window.close())
    for (let i = 0; i < 50 && (await offscreenDocuments()) > 0; i++) await sleep(100)
    expect(await offscreenDocuments()).toBe(0)
    expect(fake.transcriptions()).toHaveLength(0)
  })
})
