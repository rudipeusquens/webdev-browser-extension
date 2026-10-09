import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from 'wxt/browser'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { ASK_WAIT } from '@/composables/use-voice'
import App from '@/entrypoints/sidepanel/App.vue'
import { addAnnotation, emptyCollection } from '@/lib/collection/ops'
import { collectionKey } from '@/lib/collection/store'
import type { OverlayStatus } from '@/lib/messages'
import { type Note, NOTES_KEY } from '@/lib/notes/model'
import { VOICE_PORT } from '@/lib/voice/protocol'
import { elementInput } from './helpers/collection'
import { fakeCopyCommand } from './helpers/fake-copy'
import { type FakePort, fakePort } from './helpers/fake-ports'

// Rec: a dictation in the panel without a pin (spec section 8). Stopped, it becomes a Rec note
// that waits for its text; the text then goes to the clipboard as it is. The pins are not
// touched, and the footer's buttons leave the notes alone.

const SITE = 'http://localhost:3000'
const PAGE = 'http://localhost:3000/a'
const active: OverlayStatus = {
  host: 'localhost:3000',
  pageKey: PAGE,
  mode: 'browse',
  pins: true,
  instance: 'one',
}
const RECORDING = { state: 'recording', limit: 300_000, elapsed: 0 }

let wrapper: VueWrapper | undefined
let overlayReply: unknown
let clipboard: ReturnType<typeof fakeCopyCommand>
let ports: FakePort[]
const writeText = vi.fn()

/** The panel's end of its dictation line: `posted` is what the panel sent. */
const line = () => ports.at(-1) as FakePort

async function render(withPin = false) {
  if (withPin) {
    const collection = addAnnotation(emptyCollection(SITE), elementInput('a1', PAGE, 'Hi'), 'T')
    await fakeBrowser.storage.local.set({ [collectionKey(SITE)]: collection })
  }
  wrapper = mount(App, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

const byTestId = (id: string) => {
  const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  if (!el) throw new Error(`no ${id}`)
  return el
}
const all = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]
const rec = () => byTestId('rec')
const status = () => byTestId('copy-status').textContent?.trim()
const fallback = () =>
  document.querySelector<HTMLTextAreaElement>('[data-testid="copy-fallback-text"]')
const sent = () =>
  vi
    .mocked(fakeBrowser.runtime.sendMessage)
    .mock.calls.map(([m]) => m as unknown as { type: string })

async function click(id: string) {
  byTestId(id).click()
  await flushPromises()
}

async function press(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  await flushPromises()
}

/** The background answers on the line. */
async function answer(state: unknown) {
  line().receive(state)
  await flushPromises()
}

/** The notes as the background stores them. */
async function storeNotes(items: Note[]) {
  await fakeBrowser.storage.local.set({ [NOTES_KEY]: { version: 1, items } })
  await flushPromises()
}

const waitingNote = (id: string): Note => ({
  id,
  text: '',
  createdAt: '2026-10-09T10:00:00.000Z',
  job: { state: 'transcribing' },
})
const note = (id: string, text: string): Note => ({
  id,
  text,
  createdAt: '2026-10-09T10:00:00.000Z',
})

/** Rec started and recording. */
async function recording() {
  await click('rec')
  await answer(RECORDING)
}

/** The background took the recording as the note `id`, which waits for its text. */
async function handed(id = 'n1') {
  await answer({ state: 'handed', to: { note: id } })
  await storeNotes([waitingNote(id)])
}

/** Rec started, recorded, stopped by the developer: the note waits for its text. */
async function transcribing(id = 'n1') {
  await recording()
  await click('rec')
  await handed(id)
}

describe('Rec in the panel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    fakeBrowser.reset()
    overlayReply = active
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 1 }] as never)
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockImplementation((async () => {
      if (overlayReply === undefined) throw new Error('Could not establish connection.')
      return overlayReply
    }) as never)
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue({ ok: true } as never)
    ports = []
    vi.spyOn(fakeBrowser.runtime, 'connect').mockImplementation(((info: { name: string }) => {
      const port = fakePort(info.name, {})
      ports.push(port)
      return port as unknown as Browser.runtime.Port
    }) as never)
    writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    clipboard = fakeCopyCommand()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts a dictation on its own line, shows the clock, and stops it into a note', async () => {
    await render()
    expect(rec().textContent).toContain('Rec')
    expect(ports).toEqual([])
    await click('rec')
    expect(fakeBrowser.runtime.connect).toHaveBeenCalledWith({ name: VOICE_PORT })
    expect(line().posted).toEqual([{ type: 'start' }])
    expect(rec().dataset.dictation).toBe('starting')
    await answer(RECORDING)
    expect(rec().dataset.dictation).toBe('recording')
    expect(rec().getAttribute('aria-pressed')).toBe('true')
    expect(rec().textContent).toContain('0:00')
    await click('rec')
    expect(line().posted.at(-1)).toEqual({ type: 'stop', keep: { note: true } })
    await handed()
    expect(rec().dataset.dictation).toBe('idle')
  })

  it('shows its note at the top while it waits, and copies the text as it is once it is there', async () => {
    await render(true)
    await transcribing()
    const notes = byTestId('notes')
    expect(notes.compareDocumentPosition(byTestId('page-group'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(byTestId('note-transcribing').textContent).toContain('Transcribing…')
    await storeNotes([note('n1', 'Make the header sticky.')])
    expect(clipboard.text).toBe('Make the header sticky.')
    expect(status()).toBe('Copied dictation')
    expect(writeText).not.toHaveBeenCalled()
    expect(sent()).not.toContainEqual(expect.objectContaining({ type: 'collection:copied' }))
    expect(byTestId('note-text').textContent).toBe('Make the header sticky.')
    // Copied once: a later change of the notes copies nothing again.
    clipboard.text = ''
    await storeNotes([note('n1', 'Make the header sticky.'), note('n2', 'Other.')])
    expect(clipboard.text).toBe('')
  })

  it('works on a tab without the overlay, and lists its notes there too', async () => {
    overlayReply = undefined
    await render()
    expect(rec().hasAttribute('disabled')).toBe(false)
    await transcribing()
    await storeNotes([note('n1', 'Anywhere.')])
    expect(clipboard.text).toBe('Anywhere.')
    expect(byTestId('notes').textContent).toContain('Anywhere.')
    expect(byTestId('empty-state')).toBeTruthy()
  })

  it('offers the text for manual copying when the clipboard refuses', async () => {
    clipboard.refuse = true
    await render()
    await transcribing()
    await storeNotes([note('n1', 'Keep me.')])
    expect(fallback()?.value).toBe('Keep me.')
    expect(document.body.textContent).toContain('Copy the dictation manually')
  })

  it('leaves the clipboard to a copy of pins clicked while the text was transcribed', async () => {
    await render(true)
    await transcribing()
    await click('copy-prompt')
    expect(writeText).toHaveBeenCalledTimes(1)
    await storeNotes([note('n1', 'Said before the copy.')])
    expect(clipboard.execCommand).not.toHaveBeenCalled()
    expect(fallback()?.value).toBe('Said before the copy.')
  })

  it('takes the clipboard when it was stopped after a copy of pins', async () => {
    await render(true)
    await recording()
    await click('copy-prompt')
    await click('rec')
    await handed()
    await storeNotes([note('n1', 'Stopped last.')])
    expect(clipboard.text).toBe('Stopped last.')
    expect(fallback()).toBeNull()
  })

  it('keeps pins copied while it recorded on the clipboard when nobody answers at the limit', async () => {
    await render(true)
    await recording()
    await click('copy-prompt')
    await answer({ state: 'paused', elapsed: 300_000 })
    await vi.advanceTimersByTimeAsync(ASK_WAIT)
    expect(line().posted.at(-1)).toEqual({ type: 'stop', keep: { note: true } })
    await handed()
    await storeNotes([note('n1', 'Five minutes of it.')])
    expect(clipboard.execCommand).not.toHaveBeenCalled()
    expect(fallback()?.value).toBe('Five minutes of it.')
  })

  it('asks at the limit: Keep goes on, Stop hands it over', async () => {
    await render()
    await recording()
    await answer({ state: 'paused', elapsed: 300_000 })
    expect(byTestId('rec-limit').textContent).toContain('Rec paused at 5:00. Keep recording?')
    expect(rec().getAttribute('aria-pressed')).toBe('true')
    await click('rec-keep')
    expect(line().posted.at(-1)).toEqual({ type: 'resume' })
    await answer({ state: 'recording', limit: 300_000, elapsed: 300_000 })
    expect(document.querySelector('[data-testid="rec-limit"]')).toBeNull()
    await answer({ state: 'paused', elapsed: 600_000 })
    await click('rec-stop')
    expect(line().posted.at(-1)).toEqual({ type: 'stop', keep: { note: true } })
  })

  it('hands itself over when another recording starts elsewhere', async () => {
    await render()
    await recording()
    await answer({ state: 'yield' })
    expect(line().posted.at(-1)).toEqual({ type: 'stop', keep: { note: true } })
  })

  it('copies the text when the copy of pins failed, and keeps the prompt for copying by hand', async () => {
    writeText.mockRejectedValue(new Error('Document is not focused.'))
    await render(true)
    await transcribing()
    await click('copy-prompt')
    expect(fallback()?.value).toContain('> Hi')
    await storeNotes([note('n1', 'After the failed copy.')])
    expect(clipboard.text).toBe('After the failed copy.')
    expect(fallback()?.value).toContain('> Hi')
  })

  it('offers a second text for copying by hand once the first is closed', async () => {
    writeText.mockRejectedValue(new Error('Document is not focused.'))
    clipboard.refuse = true
    await render(true)
    await transcribing()
    await click('copy-prompt')
    await storeNotes([note('n1', 'Waits its turn.')])
    expect(fallback()?.value).toContain('> Hi')
    byTestId('copy-fallback-text')
      .closest('[data-slot="dialog-content"]')
      ?.querySelector<HTMLElement>('[data-slot="dialog-close"]')
      ?.click()
    await flushPromises()
    expect(fallback()?.value).toBe('Waits its turn.')
  })

  it('leaves a running dictation alone on Esc while a dialog is open', async () => {
    writeText.mockRejectedValue(new Error('Document is not focused.'))
    await render(true)
    await recording()
    await click('copy-prompt')
    expect(fallback()).not.toBeNull()
    await press({ key: 'Escape' })
    expect(line().posted).toEqual([{ type: 'start' }])
  })

  it("leaves a running dictation alone on the Esc that closes the site's menu", async () => {
    await render()
    await recording()
    const pill = byTestId('site-pill')
    pill.focus()
    await flushPromises()
    expect(document.querySelector('#site-actions')).not.toBeNull()
    pill.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await flushPromises()
    expect(document.querySelector('#site-actions')).toBeNull()
    expect(line().posted).toEqual([{ type: 'start' }])
    // The next Esc, with the menu closed, cancels.
    pill.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await flushPromises()
    expect(line().posted.at(-1)).toEqual({ type: 'cancel' })
  })

  it("retries a note's failed transcription, which then takes the clipboard again", async () => {
    await render(true)
    await transcribing()
    await click('copy-prompt')
    await storeNotes([
      { ...waitingNote('n1'), job: { state: 'failed', error: 'offline', retry: true } },
    ])
    expect(byTestId('note-job').textContent).toContain('Could not reach OpenRouter.')
    await click('note-retry')
    expect(sent()).toContainEqual({ type: 'note:retry', id: 'n1' })
    await storeNotes([note('n1', 'Retried.')])
    expect(clipboard.text).toBe('Retried.')
  })

  it('sends a recording that ended by itself on Retry', async () => {
    await render()
    await click('rec')
    await answer({ state: 'failed', error: 'mic-lost', retry: true })
    expect(byTestId('rec-message').textContent).toContain('The microphone stopped.')
    await click('rec-retry')
    expect(line().posted.at(-1)).toEqual({ type: 'stop', keep: { note: true } })
  })

  it('says why a dictation failed, and offers what helps', async () => {
    await render()
    await click('rec')
    await answer({ state: 'failed', error: 'mic-not-granted', retry: false })
    expect(byTestId('rec-message').textContent).toContain('Allow the microphone first.')
    const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never)
    await click('rec-grant')
    expect(create).toHaveBeenCalledWith({ url: fakeBrowser.runtime.getURL('/mic-permission.html') })
    await click('rec')
    await answer({ state: 'failed', error: 'no-key', retry: false })
    expect(byTestId('rec-message').textContent).toContain('Add an OpenRouter API key in settings.')
    await click('rec-settings')
    expect(byTestId('panel-title').textContent?.trim()).toBe('Settings')
  })

  it('drops the message when the next dictation starts', async () => {
    await render()
    await click('rec')
    await answer({ state: 'failed', error: 'mic-failed', retry: false })
    expect(document.querySelector('[data-testid="rec-message"]')).not.toBeNull()
    await click('rec')
    expect(document.querySelector('[data-testid="rec-message"]')).toBeNull()
  })

  it('starts and stops with Alt+V, and cancels with Esc', async () => {
    await render()
    await press({ key: 'v', code: 'KeyV', altKey: true })
    expect(line().posted).toEqual([{ type: 'start' }])
    await answer(RECORDING)
    await press({ key: 'Escape' })
    expect(line().posted.at(-1)).toEqual({ type: 'cancel' })
    await answer({ state: 'idle' })
    await press({ key: 'v', code: 'KeyV', altKey: true })
    await answer(RECORDING)
    await press({ key: 'v', code: 'KeyV', altKey: true })
    expect(line().posted.at(-1)).toEqual({ type: 'stop', keep: { note: true } })
  })

  it('leaves Esc alone while nothing is dictated', async () => {
    await render()
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(ports).toEqual([])
  })

  it('ends the recording when the panel closes', async () => {
    await render()
    await recording()
    wrapper?.unmount()
    wrapper = undefined
    expect(line().disconnected).toBe(true)
  })
})

describe('Rec notes in the panel', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 1 }] as never)
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(active as never)
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue({ ok: true } as never)
    writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    clipboard = fakeCopyCommand()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('lists them newest first, shows all of one on a click, copies and deletes each', async () => {
    await storeNotes([note('n1', 'Older.'), note('n2', 'Newer.\nSecond line.')])
    await render(true)
    expect(all('note').map((li) => li.dataset.noteId)).toEqual(['n2', 'n1'])
    const text = all('note-text')[0] as HTMLElement
    expect(text.className).toContain('line-clamp-2')
    ;(all('note')[0]?.querySelector('button') as HTMLElement).click()
    await flushPromises()
    expect(text.className).not.toContain('line-clamp-2')
    ;(all('note-copy')[1] as HTMLElement).click()
    await flushPromises()
    expect(clipboard.text).toBe('Older.')
    expect(status()).toBe('Copied note')
    ;(all('note-delete')[0] as HTMLElement).click()
    await flushPromises()
    expect(sent()).toContainEqual({ type: 'note:delete', id: 'n2' })
  })

  it('is left alone by Copy as prompt, Copy again and Clear all', async () => {
    await storeNotes([note('n1', 'Not a pin.')])
    await render(true)
    await click('copy-prompt')
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0]?.[0]).not.toContain('Not a pin.')
    await click('clear-all')
    expect(sent().filter((m) => m.type.startsWith('note:'))).toEqual([])
    expect(all('note')).toHaveLength(1)
  })
})
