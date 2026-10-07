import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from 'wxt/browser'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import App from '@/entrypoints/sidepanel/App.vue'
import { addAnnotation, emptyCollection } from '@/lib/collection/ops'
import { collectionKey } from '@/lib/collection/store'
import type { OverlayStatus } from '@/lib/messages'
import { VOICE_PORT } from '@/lib/voice/protocol'
import { elementInput } from './helpers/collection'
import { fakeCopyCommand } from './helpers/fake-copy'
import { type FakePort, fakePort } from './helpers/fake-ports'

// Rec: a dictation in the panel without a pin (spec section 8). Its text goes to the clipboard
// as it is; the pins are not touched.

const SITE = 'http://localhost:3000'
const PAGE = 'http://localhost:3000/a'
const active: OverlayStatus = {
  host: 'localhost:3000',
  pageKey: PAGE,
  mode: 'browse',
  pins: true,
  instance: 'one',
}

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
const rec = () => byTestId('rec')
const status = () => byTestId('copy-status').textContent?.trim()
const fallback = () =>
  document.querySelector<HTMLTextAreaElement>('[data-testid="copy-fallback-text"]')

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

/** Rec started, recorded, stopped: the text is being transcribed. */
async function transcribing() {
  await click('rec')
  await answer({ state: 'recording', limit: 120_000 })
  await click('rec')
  await answer({ state: 'transcribing' })
}

describe('Rec in the panel', () => {
  beforeEach(() => {
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
    vi.restoreAllMocks()
  })

  it('starts a dictation on its own line, shows the clock while recording, and stops it', async () => {
    await render()
    expect(rec().textContent).toContain('Rec')
    expect(ports).toEqual([])
    await click('rec')
    expect(fakeBrowser.runtime.connect).toHaveBeenCalledWith({ name: VOICE_PORT })
    expect(line().posted).toEqual([{ type: 'start' }])
    expect(rec().dataset.dictation).toBe('starting')
    await answer({ state: 'recording', limit: 120_000 })
    expect(rec().dataset.dictation).toBe('recording')
    expect(rec().getAttribute('aria-pressed')).toBe('true')
    expect(rec().textContent).toContain('0:00')
    await click('rec')
    expect(line().posted.at(-1)).toEqual({ type: 'stop' })
  })

  it('copies the transcript as it is, and leaves the pins alone', async () => {
    await render(true)
    await transcribing()
    expect(rec().dataset.dictation).toBe('transcribing')
    await answer({ state: 'done', text: 'Make the header sticky.', atLimit: false })
    expect(clipboard.text).toBe('Make the header sticky.')
    expect(status()).toBe('Copied dictation')
    expect(writeText).not.toHaveBeenCalled()
    const sent = vi.mocked(fakeBrowser.runtime.sendMessage).mock.calls.map(([m]) => m)
    expect(sent).not.toContainEqual(expect.objectContaining({ type: 'collection:copied' }))
    expect(byTestId('filter-open').textContent).toContain('1')
    expect(rec().dataset.dictation).toBe('done')
  })

  it('says so when the recording stopped at two minutes', async () => {
    await render()
    await transcribing()
    await answer({ state: 'done', text: 'Long one.', atLimit: true })
    expect(clipboard.text).toBe('Long one.')
    expect(status()).toBe('Copied dictation. The recording stopped after 2 minutes.')
  })

  it('works on a tab without the overlay: it needs nothing from the page', async () => {
    overlayReply = undefined
    await render()
    expect(rec().hasAttribute('disabled')).toBe(false)
    await transcribing()
    await answer({ state: 'done', text: 'Anywhere.', atLimit: false })
    expect(clipboard.text).toBe('Anywhere.')
  })

  it('offers the transcript for manual copying when the clipboard refuses', async () => {
    clipboard.refuse = true
    await render()
    await transcribing()
    await answer({ state: 'done', text: 'Keep me.', atLimit: false })
    expect(fallback()?.value).toBe('Keep me.')
    expect(document.body.textContent).toContain('Copy the dictation manually')
  })

  it('leaves the clipboard to a copy of pins clicked while the dictation was transcribed', async () => {
    await render(true)
    await transcribing()
    await click('copy-prompt')
    expect(writeText).toHaveBeenCalledTimes(1)
    await answer({ state: 'done', text: 'Said before the copy.', atLimit: false })
    expect(clipboard.execCommand).not.toHaveBeenCalled()
    expect(fallback()?.value).toBe('Said before the copy.')
    expect(document.body.textContent).toContain(
      'Pins copied while it was transcribed keep the clipboard.',
    )
  })

  it('takes the clipboard when it was stopped after a copy of pins', async () => {
    await render(true)
    await click('rec')
    await answer({ state: 'recording', limit: 120_000 })
    await click('copy-prompt')
    await click('rec')
    await answer({ state: 'transcribing' })
    await answer({ state: 'done', text: 'Stopped last.', atLimit: false })
    expect(clipboard.text).toBe('Stopped last.')
    expect(fallback()).toBeNull()
  })

  it('a retry after a copy of pins takes the clipboard again', async () => {
    await render(true)
    await transcribing()
    await click('copy-prompt')
    await answer({ state: 'failed', error: 'offline', retry: true })
    await click('rec-retry')
    expect(line().posted.at(-1)).toEqual({ type: 'retry' })
    await answer({ state: 'transcribing' })
    await answer({ state: 'done', text: 'Retried.', atLimit: false })
    expect(clipboard.text).toBe('Retried.')
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
    await answer({ state: 'failed', error: 'offline', retry: false })
    expect(document.querySelector('[data-testid="rec-message"]')).not.toBeNull()
    await click('rec')
    expect(document.querySelector('[data-testid="rec-message"]')).toBeNull()
  })

  it('starts and stops with Alt+V, and cancels with Esc', async () => {
    await render()
    await press({ key: 'v', code: 'KeyV', altKey: true })
    expect(line().posted).toEqual([{ type: 'start' }])
    await answer({ state: 'recording', limit: 120_000 })
    await press({ key: 'v', code: 'KeyV', altKey: true })
    expect(line().posted.at(-1)).toEqual({ type: 'stop' })
    await answer({ state: 'transcribing' })
    await press({ key: 'Escape' })
    expect(line().posted.at(-1)).toEqual({ type: 'cancel' })
  })

  it('leaves Esc alone while nothing is dictated', async () => {
    await render()
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(ports).toEqual([])
  })

  it('ends the dictation when the panel closes', async () => {
    await render()
    await click('rec')
    await answer({ state: 'recording', limit: 120_000 })
    wrapper?.unmount()
    wrapper = undefined
    expect(line().disconnected).toBe(true)
  })
})
