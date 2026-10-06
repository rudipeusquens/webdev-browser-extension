import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import background from '@/entrypoints/background'
import { KEY_STORAGE, loadKey } from '@/lib/voice/key'
import { DEFAULT_MODEL, loadVoiceSettings } from '@/lib/voice/settings'
import { fakeContextMenus } from './helpers/fake-context-menus'
import { fakeSites } from './helpers/fake-sites'

// A well-formed but fake key, assembled at runtime so this file never contains one.
const KEY = 'sk-or-v1-' + 'cd34'.repeat(16)

const panel = () => ({
  id: fakeBrowser.runtime.id,
  url: fakeBrowser.runtime.getURL('/sidepanel.html'),
})
const tab = { id: 5, windowId: 1 }

describe('background: voice settings from the panel', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    fakeSites()
    fakeContextMenus()
    background.main()
  })

  afterEach(() => vi.restoreAllMocks())

  it('saves the model and the language', async () => {
    const reply = await send(
      { type: 'voice:set', model: 'openai/whisper-large-v3-turbo', language: 'de' },
      panel(),
    )
    expect(reply).toEqual({ ok: true })
    expect(await loadVoiceSettings()).toEqual({
      model: 'openai/whisper-large-v3-turbo',
      language: 'de',
    })
  })

  it('saves and removes the key without ever answering with it', async () => {
    const saved = await send({ type: 'voice:key:save', key: KEY }, panel())
    expect(saved).toEqual({ ok: true })
    expect(await loadKey()).toBe(KEY)
    const removed = await send({ type: 'voice:key:remove' }, panel())
    expect(removed).toEqual({ ok: true })
    expect(await loadKey()).toBeUndefined()
    expect(JSON.stringify([saved, removed])).not.toContain(KEY)
  })

  it.each([
    ['a page', { ...panel(), tab }],
    ['another extension page', { ...panel(), url: fakeBrowser.runtime.getURL('/offscreen.html') }],
    ['an unknown page', { id: fakeBrowser.runtime.id }],
  ])('refuses every voice message from %s', async (_, sender) => {
    for (const message of [
      { type: 'voice:set', model: 'a/b', language: 'en' },
      { type: 'voice:key:save', key: KEY },
      { type: 'voice:key:remove' },
      { type: 'voice:key:test' },
    ]) {
      expect(await send(message, sender)).toMatchObject({ ok: false })
    }
    await fakeBrowser.storage.local.set({ [KEY_STORAGE]: KEY })
    expect(await send({ type: 'voice:key:remove' }, sender)).toMatchObject({ ok: false })
    expect(await loadKey()).toBe(KEY)
    expect(await loadVoiceSettings()).toEqual({ model: DEFAULT_MODEL, language: 'auto' })
  })

  it('ignores another extension and malformed values', async () => {
    const other = { ...panel(), id: 'another-extension' }
    expect(await send({ type: 'voice:key:save', key: KEY }, other)).toBeUndefined()
    expect(await send({ type: 'voice:key:save', key: 'has spaces in it' }, panel())).toBeUndefined()
    expect(
      await send({ type: 'voice:set', model: 'nope', language: 'en' }, panel()),
    ).toBeUndefined()
    expect(await send({ type: 'voice:set', model: 'a/b', language: 'english' }, panel())).toBe(
      undefined,
    )
    expect(await loadKey()).toBeUndefined()
    expect(await loadVoiceSettings()).toEqual({ model: DEFAULT_MODEL, language: 'auto' })
  })

  describe('testing the key', () => {
    it('says when there is none', async () => {
      const fetch = vi.spyOn(globalThis, 'fetch')
      expect(await send({ type: 'voice:key:test' }, panel())).toEqual({
        ok: false,
        error: 'Add an OpenRouter API key first.',
      })
      expect(fetch).not.toHaveBeenCalled()
    })

    it.each([
      [200, true],
      [401, false],
      [403, false],
    ])('asks OpenRouter at no cost: %i means valid %s', async (status, valid) => {
      await fakeBrowser.storage.local.set({ [KEY_STORAGE]: KEY })
      const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status }))
      const reply = await send({ type: 'voice:key:test' }, panel())
      expect(reply).toEqual({ ok: true, valid })
      const [url, init] = fetch.mock.calls[0] ?? []
      expect(String(url)).toBe('https://openrouter.ai/api/v1/key')
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${KEY}`)
      expect(init?.method ?? 'GET').toBe('GET')
    })

    it('says when OpenRouter cannot be reached or fails', async () => {
      await fakeBrowser.storage.local.set({ [KEY_STORAGE]: KEY })
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError(`Failed: ${KEY}`))
      const offline = await send({ type: 'voice:key:test' }, panel())
      expect(offline).toEqual({ ok: false, error: 'Could not reach OpenRouter.' })
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(KEY, { status: 500 }))
      const failed = await send({ type: 'voice:key:test' }, panel())
      expect(failed).toEqual({ ok: false, error: 'OpenRouter could not check the key.' })
      expect(JSON.stringify([offline, failed])).not.toContain(KEY)
    })
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
