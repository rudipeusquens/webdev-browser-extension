import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'puppeteer'
import { unzip } from '../unit/helpers/unzip'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FAKE_TEXT, startFakeOpenRouter } from './fake-openrouter'
import {
  grantPermissions,
  clickAction,
  launch,
  serviceWorker,
  type Session,
  setMicrophone,
  useFixtureServer,
} from './harness'
import { markElement, sleep, startOverlay, waitForItems } from './overlay-helpers'
import { offscreenDocuments, setKey } from './voice-helpers'

// Rec end to end (spec sections 8 and 12): a dictation in the panel without a pin, with
// Chrome's fake microphone and the shipped build pointed at a local fake OpenRouter. Stopped,
// it becomes a Rec note above the pages; its text goes to the clipboard once it is there. The
// clipboard is written with the extension's own clipboardWrite permission: the tests grant
// reading it only.
const KEY = 'test-key-e2e-1234'

describe('Rec in the panel', () => {
  const server = useFixtureServer()
  let fake: Awaited<ReturnType<typeof startFakeOpenRouter>>
  let s: Session
  let panel: Page

  beforeAll(async () => {
    fake = await startFakeOpenRouter()
    s = await launch({ openrouter: fake.origin, microphone: 'granted' })
    await grantPermissions(s, ['clipboard-read'])
    panel = await startOverlay(s, `${server.origin}/plain/`, { clear: false })
  })

  afterAll(async () => {
    await s?.browser.close()
    await fake?.close()
  })

  beforeEach(async () => {
    fake.reset()
    await setMicrophone(s, 'granted')
    await setKey(s, KEY)
    // No notes from the last test.
    const worker = await serviceWorker(s)
    await worker.evaluate(async () => {
      const { storage } = (
        globalThis as unknown as {
          chrome: {
            storage: {
              local: { remove(k: string): Promise<void> }
              session: { remove(k: string): Promise<void> }
            }
          }
        }
      ).chrome
      await storage.local.remove('notes')
      await storage.session.remove('notesHistory')
    })
    await panel.waitForSelector('[data-testid="notes"]', { hidden: true })
  })

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

  const noteTexts = () =>
    panel.$$eval('[data-testid="note"]', (notes) =>
      notes.map((li) => li.querySelector('[data-testid="note-text"]')?.textContent ?? ''),
    )

  /** Records for `ms` from a click on Rec. */
  async function record(ms = 1200) {
    await panel.click('[data-testid="rec"]')
    await waitForDictation('recording')
    await sleep(ms)
  }

  it('keeps the text as a note above the pages and copies it, also once the developer moved on', async () => {
    // The answer comes after the developer left the panel: its document has no focus then.
    fake.reply(200, { text: FAKE_TEXT }, 1500)
    await record()
    await panel.click('[data-testid="rec"]')
    await panel.waitForSelector('[data-testid="note-transcribing"]')
    await waitForDictation('idle')
    await s.page.bringToFront()
    await s.page.click('body')
    expect(await panel.evaluate(() => document.hasFocus())).toBe(false)
    await panel.waitForFunction(
      () =>
        document.querySelector('[data-testid="copy-status"]')?.textContent === 'Copied dictation',
    )
    expect(await clipboard()).toBe(FAKE_TEXT)
    expect(await noteTexts()).toEqual([FAKE_TEXT])
    // Nothing of the page goes along, and nothing became a pin.
    const [request] = fake.transcriptions()
    expect(fake.transcriptions()).toHaveLength(1)
    expect(Object.keys(request?.body as object).sort()).toEqual([
      'input_audio',
      'model',
      'provider',
    ])
    expect(await panel.$eval('[data-testid="filter-all"]', (el) => el.textContent)).toContain('0')
    for (let i = 0; i < 30 && (await offscreenDocuments(s)) > 0; i++) await sleep(100)
    expect(await offscreenDocuments(s)).toBe(0)
  })

  it('corrects the transcript before it is kept and copied, on the instructions of Settings', async () => {
    fake.correct('Make the Button wider.')
    await record(600)
    await panel.click('[data-testid="rec"]')
    await panel.waitForSelector('[data-testid="note-text"]')
    expect(await noteTexts()).toEqual(['Make the Button wider.'])
    expect(await clipboard()).toBe('Make the Button wider.')
    const [request] = fake.corrections()
    expect(fake.corrections()).toHaveLength(1)
    expect(request?.authorization).toBe(`Bearer ${KEY}`)
    const body = request?.body as { model: string; messages: { role: string; content: string }[] }
    expect(body.model).toBe('anthropic/claude-haiku-5.5')
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(body.messages[0]?.content).toContain('You correct transcripts')
    expect(body.messages[1]?.content).toBe(`<transcript>\n${FAKE_TEXT}\n</transcript>`)
    expect(await panel.$('[data-testid="note-uncorrected"]')).toBeNull()
  })

  it('keeps the transcript as it came when the correction fails, and marks the note', async () => {
    fake.failCorrection(500)
    await record(600)
    await panel.click('[data-testid="rec"]')
    await panel.waitForSelector('[data-testid="note-uncorrected"]')
    expect(await noteTexts()).toEqual([FAKE_TEXT])
  })

  it('sends no transcript anywhere while the correction is off', async () => {
    await panel.click('[data-testid="open-settings"]')
    await panel.click('[data-testid="voice-correct-on"]')
    await panel.waitForSelector('[data-testid="voice-correct-prompt"]', { hidden: true })
    await panel.click('[data-testid="close-settings"]')
    try {
      await record(600)
      await panel.click('[data-testid="rec"]')
      await panel.waitForSelector('[data-testid="note-text"]')
      expect(await noteTexts()).toEqual([FAKE_TEXT])
      expect(fake.corrections()).toHaveLength(0)
    } finally {
      await panel.click('[data-testid="open-settings"]')
      await panel.click('[data-testid="voice-correct-on"]')
      await panel.waitForSelector('[data-testid="voice-correct-prompt"]')
      await panel.click('[data-testid="close-settings"]')
    }
  })

  it('keeps every text and recording in the archive, also of a deleted note, and exports them as a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'webdev-archive-'))
    try {
      fake.correct('Make the Button wider.')
      await record(600)
      await panel.click('[data-testid="rec"]')
      await panel.waitForSelector('[data-testid="note-text"]')
      await panel.click('[data-testid="note-delete"]')
      await panel.waitForSelector('[data-testid="notes"]', { hidden: true })
      const cdp = await panel.createCDPSession()
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir })
      await panel.click('[data-testid="open-settings"]')
      // The count is there once the archive is read.
      const count = await panel.waitForFunction(() => {
        const text = document.querySelector('[data-testid="archive-count"]')?.textContent ?? ''
        return /\d+ dictation/.test(text) ? text : false
      })
      const before = Number.parseInt(String(await count.jsonValue()).trim(), 10)
      expect(before).toBeGreaterThanOrEqual(1)
      await panel.click('[data-testid="archive-export"]')
      let files: string[] = []
      for (let i = 0; i < 50 && !files.some((f) => f.endsWith('.zip')); i++) {
        await sleep(100)
        files = await readdir(dir)
      }
      const file = files.find((f) => /^dictations-\d{4}-\d{2}-\d{2}\.zip$/.test(f))
      expect(file).toBeDefined()
      const zipped = unzip(new Uint8Array(await readFile(join(dir, file ?? ''))))
      const exported = JSON.parse(new TextDecoder().decode(zipped.get('dictations.json'))) as {
        version: number
        dictations: { audioFiles?: string[] }[]
      }
      // The recording is in the file: WebM, as the microphone gave it.
      const [audio] = exported.dictations.at(-1)?.audioFiles ?? []
      expect(audio).toMatch(/^audio\/.+-1\.webm$/)
      const recording = zipped.get(audio ?? '')
      expect(recording?.length).toBeGreaterThan(100)
      expect([...(recording?.subarray(0, 4) ?? [])]).toEqual([0x1a, 0x45, 0xdf, 0xa3])
      expect(await panel.$eval('[data-testid="archive-size"]', (el) => el.textContent)).toContain(
        'of recordings',
      )
      expect(exported.version).toBe(1)
      expect(exported.dictations).toHaveLength(before)
      expect(exported.dictations.at(-1)).toMatchObject({
        kind: 'note',
        text: 'Make the Button wider.',
        raw: FAKE_TEXT,
        model: 'openai/gpt-4o-mini-transcribe',
        correctModel: 'anthropic/claude-haiku-5.5',
      })
      // Deleted only after a confirmation.
      await panel.click('[data-testid="archive-clear"]')
      await (await panel.waitForSelector('[data-testid="archive-clear-confirm"]'))?.click()
      await panel.waitForSelector('[data-testid="archive-export"][disabled]')
    } finally {
      // The next test starts in Edit: the dialog is gone before Settings closes.
      await panel.waitForSelector('[data-testid="archive-clear-confirm"]', { hidden: true })
      if (await panel.$('[data-testid="close-settings"]')) {
        await panel.click('[data-testid="close-settings"]')
      }
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('leaves the clipboard to Copy as prompt clicked while it was transcribed', async () => {
    await markElement(s, 'button[type="submit"]')
    await s.page.keyboard.type('Pin text')
    await s.page.keyboard.press('Enter')
    await waitForItems(panel, 1)
    fake.reply(200, { text: FAKE_TEXT }, 1500)
    await record(600)
    await panel.click('[data-testid="rec"]')
    await panel.waitForSelector('[data-testid="note-transcribing"]')
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
    // The note keeps it, and the footer's buttons leave the note alone.
    expect(await noteTexts()).toEqual([FAKE_TEXT])
    await panel.click('[data-testid="clear-all"]')
    await panel.waitForSelector('::-p-text(Moved 1 pin to Deleted)')
    expect(await noteTexts()).toEqual([FAKE_TEXT])
  })

  it('copies and deletes a note with its own buttons', async () => {
    await record(600)
    await panel.click('[data-testid="rec"]')
    await panel.waitForFunction(
      () =>
        document.querySelector('[data-testid="copy-status"]')?.textContent === 'Copied dictation',
    )
    await panel.evaluate(() => navigator.clipboard.writeText('Something else'))
    await panel.click('[data-testid="note-copy"]')
    await panel.waitForSelector('::-p-text(Copied note)')
    expect(await clipboard()).toBe(FAKE_TEXT)
    await panel.click('[data-testid="note-delete"]')
    await panel.waitForSelector('[data-testid="notes"]', { hidden: true })
  })

  it('fills its note when the panel closes while it is transcribed', async () => {
    fake.reply(200, { text: FAKE_TEXT }, 1500)
    await record(600)
    await panel.click('[data-testid="rec"]')
    await panel.waitForSelector('[data-testid="note-transcribing"]')
    await panel.evaluate(() => window.close())
    await sleep(2500)
    await s.page.bringToFront()
    panel = await clickAction(s)
    await panel.waitForSelector('[data-testid="note-text"]')
    expect(await noteTexts()).toEqual([FAKE_TEXT])
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
    expect(await offscreenDocuments(s)).toBe(0)
    expect(await noteTexts()).toEqual([])
  })

  it('says when there is no key, and opens the settings', async () => {
    await setKey(s, null)
    await panel.click('[data-testid="rec"]')
    const message = await panel.waitForSelector('[data-testid="rec-message"]')
    expect(await message?.evaluate((el) => el.textContent)).toContain(
      'Add an OpenRouter API key in settings.',
    )
    expect(await offscreenDocuments(s)).toBe(0)
    await panel.click('[data-testid="rec-settings"]')
    await panel.waitForSelector('[data-testid="voice-settings"]')
    await panel.click('[data-testid="close-settings"]')
  })

  it('needs no overlay on the tab, and lists its notes there too', async () => {
    await s.page.goto('about:blank')
    await panel.waitForSelector('[data-testid="tab-status"]')
    await record(600)
    await panel.click('[data-testid="rec"]')
    await panel.waitForFunction(
      () =>
        document.querySelector('[data-testid="copy-status"]')?.textContent === 'Copied dictation',
    )
    expect(await clipboard()).toBe(FAKE_TEXT)
    expect(await noteTexts()).toEqual([FAKE_TEXT])
    // Its Delete is undone and redone there too, with the buttons and with the key.
    await panel.click('[data-testid="note-delete"]')
    await panel.waitForSelector('[data-testid="notes"]', { hidden: true })
    await panel.waitForSelector('[data-testid="undo"]:not([disabled])')
    await panel.click('[data-testid="undo"]')
    await panel.waitForSelector('[data-testid="note-text"]')
    expect(await noteTexts()).toEqual([FAKE_TEXT])
    await panel.click('[data-testid="redo"]')
    await panel.waitForSelector('[data-testid="notes"]', { hidden: true })
    await panel.click('[data-testid="panel-title"]')
    await panel.keyboard.down('Control')
    await panel.keyboard.press('KeyZ')
    await panel.keyboard.up('Control')
    await panel.waitForSelector('[data-testid="note-text"]')
    expect(await noteTexts()).toEqual([FAKE_TEXT])
  })

  it('ends the recording when the panel closes before the stop', async () => {
    await record(600)
    expect(await offscreenDocuments(s)).toBe(1)
    await panel.evaluate(() => window.close())
    for (let i = 0; i < 50 && (await offscreenDocuments(s)) > 0; i++) await sleep(100)
    expect(await offscreenDocuments(s)).toBe(0)
    expect(fake.transcriptions()).toHaveLength(0)
  })
})
