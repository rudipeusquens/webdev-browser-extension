import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import App from '@/entrypoints/sidepanel/App.vue'
import { PANEL_VIEW_KEY } from '@/lib/messages'
import { KEY_STORAGE } from '@/lib/voice/key'
import { VOICE_KEY } from '@/lib/voice/settings'

// A well-formed but fake key, assembled at runtime so this file never contains one.
const KEY = 'sk-or-v1-' + '77ab'.repeat(16)
const WINDOW = 7

let wrapper: VueWrapper | undefined
let sendMessage: ReturnType<typeof vi.spyOn>
let microphone: { state: PermissionState; onchange: (() => void) | null }

const body = () => document.body.textContent ?? ''
const find = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const byTestId = (id: string) => {
  const el = find(id)
  if (!el) throw new Error(`no ${id}`)
  return el
}

async function render() {
  wrapper = mount(App, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

async function openSettings() {
  await render()
  byTestId('open-settings').click()
  await flushPromises()
}

async function type(id: string, value: string) {
  const input = byTestId(id) as HTMLInputElement
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function choose(id: string, value: string) {
  const select = byTestId(id) as HTMLSelectElement
  select.value = value
  select.dispatchEvent(new Event('change'))
  await flushPromises()
}

describe('side panel: voice settings', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 1, windowId: WINDOW }] as never)
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockRejectedValue(new Error('No overlay.'))
    sendMessage = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValue({ ok: true } as never)
    microphone = { state: 'prompt', onchange: null }
    Object.defineProperty(navigator, 'permissions', {
      value: { query: vi.fn(async () => microphone) },
      configurable: true,
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('comes first in the settings and says what is sent where', async () => {
    await openSettings()
    const voice = byTestId('voice-settings')
    const sites = byTestId('site-settings')
    expect(voice.compareDocumentPosition(sites) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(voice.textContent).toContain('OpenRouter')
  })

  describe('the API key', () => {
    it('is saved through the background and the field is emptied', async () => {
      await openSettings()
      await type('voice-key-input', KEY)
      byTestId('voice-key-save').click()
      await flushPromises()
      expect(sendMessage).toHaveBeenCalledWith({ type: 'voice:key:save', key: KEY })
      expect((byTestId('voice-key-input') as HTMLInputElement).value).toBe('')
    })

    it('is checked for its shape before it is sent', async () => {
      await openSettings()
      await type('voice-key-input', 'not a key')
      byTestId('voice-key-save').click()
      await flushPromises()
      expect(sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'voice:key:save' }),
      )
      expect(body()).toContain('That does not look like an OpenRouter API key.')
    })

    it('shows only masked once stored, and follows changes', async () => {
      await openSettings()
      expect(find('voice-key-masked')).toBeNull()
      await fakeBrowser.storage.local.set({ [KEY_STORAGE]: KEY })
      await flushPromises()
      expect(byTestId('voice-key-masked').textContent).toBe('sk-or-v1-…77ab')
      expect(document.body.innerHTML).not.toContain(KEY)
      expect(find('voice-key-input')).toBeNull()
      await fakeBrowser.storage.local.remove(KEY_STORAGE)
      await flushPromises()
      expect(find('voice-key-masked')).toBeNull()
    })

    it.each([
      [{ ok: true, valid: true }, 'Key works.'],
      [{ ok: true, valid: false }, 'Invalid API key.'],
      [{ ok: false, error: 'Could not reach OpenRouter.' }, 'Could not reach OpenRouter.'],
    ])('is tested on request: %j', async (reply, text) => {
      await fakeBrowser.storage.local.set({ [KEY_STORAGE]: KEY })
      await openSettings()
      sendMessage.mockResolvedValueOnce(reply as never)
      byTestId('voice-key-test').click()
      await flushPromises()
      expect(sendMessage).toHaveBeenCalledWith({ type: 'voice:key:test' })
      expect(byTestId('voice-key-result').textContent).toContain(text)
    })

    it('is removed through the background', async () => {
      await fakeBrowser.storage.local.set({ [KEY_STORAGE]: KEY })
      await openSettings()
      byTestId('voice-key-remove').click()
      await flushPromises()
      expect(sendMessage).toHaveBeenCalledWith({ type: 'voice:key:remove' })
    })
  })

  describe('model and language', () => {
    it('saves a model from the list', async () => {
      await openSettings()
      expect((byTestId('voice-model') as HTMLSelectElement).value).toBe(
        'openai/gpt-4o-mini-transcribe',
      )
      await choose('voice-model', 'openai/whisper-large-v3-turbo')
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'voice:set',
        model: 'openai/whisper-large-v3-turbo',
        language: 'auto',
      })
    })

    it('takes a custom model id once it is well-formed', async () => {
      await openSettings()
      await choose('voice-model', 'custom')
      await type('voice-custom-model', 'whisper')
      byTestId('voice-custom-save').click()
      await flushPromises()
      expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'voice:set' }))
      expect(body()).toContain('Use an OpenRouter model id such as vendor/model.')
      await type('voice-custom-model', 'qwen/qwen3-asr-flash-2026-02-10')
      byTestId('voice-custom-save').click()
      await flushPromises()
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'voice:set',
        model: 'qwen/qwen3-asr-flash-2026-02-10',
        language: 'auto',
      })
    })

    it('shows a stored custom model as custom', async () => {
      await fakeBrowser.storage.local.set({ [VOICE_KEY]: { model: 'a/b', language: 'de' } })
      await openSettings()
      expect((byTestId('voice-model') as HTMLSelectElement).value).toBe('custom')
      expect((byTestId('voice-custom-model') as HTMLInputElement).value).toBe('a/b')
      expect((byTestId('voice-language') as HTMLSelectElement).value).toBe('de')
    })

    it('saves the language with the model', async () => {
      await fakeBrowser.storage.local.set({ [VOICE_KEY]: { model: 'a/b', language: 'auto' } })
      await openSettings()
      await choose('voice-language', 'de')
      expect(sendMessage).toHaveBeenCalledWith({ type: 'voice:set', model: 'a/b', language: 'de' })
    })
  })

  describe('the microphone', () => {
    it('offers Grant until it is allowed, and follows the permission', async () => {
      const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never)
      await openSettings()
      expect(byTestId('voice-mic').textContent).toContain('Not allowed yet')
      byTestId('voice-mic-grant').click()
      expect(create).toHaveBeenCalledWith({
        url: fakeBrowser.runtime.getURL('/mic-permission.html'),
      })
      microphone.state = 'granted'
      microphone.onchange?.()
      await flushPromises()
      expect(byTestId('voice-mic').textContent).toContain('Allowed')
      expect(find('voice-mic-grant')).toBeNull()
    })

    it('explains a block', async () => {
      microphone.state = 'denied'
      await openSettings()
      expect(byTestId('voice-mic').textContent).toContain('Blocked')
      expect(find('voice-mic-grant')).not.toBeNull()
    })
  })

  describe('Open settings from a comment', () => {
    const view = (windowId: number, age = 0) => ({
      [PANEL_VIEW_KEY]: { windowId, view: 'settings', at: Date.now() - age },
    })

    it('opens the settings of the panel it names, once', async () => {
      await fakeBrowser.storage.session.set(view(WINDOW))
      await render()
      expect(find('voice-settings')).not.toBeNull()
      expect(
        (await fakeBrowser.storage.session.get(PANEL_VIEW_KEY))[PANEL_VIEW_KEY],
      ).toBeUndefined()
    })

    it('opens them when asked while the panel is open', async () => {
      await render()
      expect(find('voice-settings')).toBeNull()
      await fakeBrowser.storage.session.set(view(WINDOW))
      await flushPromises()
      expect(find('voice-settings')).not.toBeNull()
    })

    it('leaves other windows and old requests alone', async () => {
      await fakeBrowser.storage.session.set(view(WINDOW + 1))
      await render()
      expect(find('voice-settings')).toBeNull()
      expect((await fakeBrowser.storage.session.get(PANEL_VIEW_KEY))[PANEL_VIEW_KEY]).toBeDefined()
      wrapper?.unmount()
      wrapper = undefined
      await fakeBrowser.storage.session.set(view(WINDOW, 60_000))
      await render()
      expect(find('voice-settings')).toBeNull()
    })
  })
})
