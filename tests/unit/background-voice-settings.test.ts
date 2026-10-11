import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import background from '@/entrypoints/background'
import { loadKey, storeKey } from '@/lib/voice/key'
import { DEFAULT_MODEL, loadVoiceSettings, VOICE_KEY } from '@/lib/voice/settings'
import { fakeChrome, send, stored } from './helpers/background'
import { panelSender } from './helpers/fake-ports'

// A well-formed but fake key, assembled at runtime so this file never contains one.
const KEY = 'sk-or-v1-' + 'cd34'.repeat(16)

const tab = { id: 5, windowId: 1 }

describe('background: voice settings from the panel', () => {
  beforeEach(() => {
    fakeChrome()
    background.main()
  })

  afterEach(() => vi.restoreAllMocks())

  it('saves the model, the language and the limit', async () => {
    const reply = await send(
      { type: 'voice:set', model: 'openai/whisper-large-v3-turbo', language: 'de', limit: 600_000 },
      panelSender(),
    )
    expect(reply).toEqual({ ok: true })
    expect(await loadVoiceSettings()).toEqual({
      model: 'openai/whisper-large-v3-turbo',
      language: 'de',
      limit: 600_000,
    })
  })

  it('changes only the fields it is sent, the others as stored', async () => {
    await fakeBrowser.storage.local.set({
      [VOICE_KEY]: { model: 'a/b', language: 'de', limit: 600_000 },
    })
    expect(await send({ type: 'voice:set', limit: 120_000 }, panelSender())).toEqual({ ok: true })
    expect(await send({ type: 'voice:set', language: 'fr' }, panelSender())).toEqual({ ok: true })
    expect(await stored(VOICE_KEY)).toEqual({ model: 'a/b', language: 'fr', limit: 120_000 })
  })

  it('keeps both of two changes sent at once', async () => {
    const replies = await Promise.all([
      send({ type: 'voice:set', language: 'de' }, panelSender()),
      send({ type: 'voice:set', limit: 600_000 }, panelSender()),
      send({ type: 'voice:set', model: 'a/b' }, panelSender()),
    ])
    expect(replies).toEqual([{ ok: true }, { ok: true }, { ok: true }])
    expect(await loadVoiceSettings()).toEqual({ model: 'a/b', language: 'de', limit: 600_000 })
  })

  it('saves and removes the key without ever answering with it', async () => {
    const changes = vi.fn()
    fakeBrowser.storage.onChanged.addListener(changes)
    const broadcast = vi.spyOn(fakeBrowser.runtime, 'sendMessage')
    const saved = await send({ type: 'voice:key:save', key: KEY }, panelSender())
    expect(saved).toEqual({ ok: true })
    expect(await loadKey()).toBe(KEY)
    const removed = await send({ type: 'voice:key:remove' }, panelSender())
    expect(removed).toEqual({ ok: true })
    expect(await loadKey()).toBeUndefined()
    expect(JSON.stringify([saved, removed])).not.toContain(KEY)
    // Not through chrome.storage, whose change events reach every overlay.
    expect(changes).not.toHaveBeenCalled()
    // Open panels hear that the key changed, not what it is.
    expect(broadcast.mock.calls).toEqual([
      [{ type: 'voice:key:changed' }],
      [{ type: 'voice:key:changed' }],
    ])
  })

  it.each([
    ['a page', { ...panelSender(), tab }],
    [
      'another extension page',
      { ...panelSender(), url: fakeBrowser.runtime.getURL('/offscreen.html') },
    ],
    ['an unknown page', { id: fakeBrowser.runtime.id }],
  ])('refuses every voice message from %s', async (_, sender) => {
    for (const message of [
      { type: 'voice:set', model: 'a/b', language: 'en', limit: 60_000 },
      { type: 'voice:key:save', key: KEY },
      { type: 'voice:key:remove' },
      { type: 'voice:key:test' },
    ]) {
      expect(await send(message, sender)).toMatchObject({ ok: false })
    }
    await storeKey(KEY)
    expect(await send({ type: 'voice:key:remove' }, sender)).toMatchObject({ ok: false })
    expect(await loadKey()).toBe(KEY)
    expect(await loadVoiceSettings()).toEqual({
      model: DEFAULT_MODEL,
      language: 'auto',
      limit: 300_000,
    })
  })

  it('ignores another extension and malformed values', async () => {
    const other = { ...panelSender(), id: 'another-extension' }
    expect(await send({ type: 'voice:key:save', key: KEY }, other)).toBeUndefined()
    expect(
      await send({ type: 'voice:key:save', key: 'has spaces in it' }, panelSender()),
    ).toBeUndefined()
    expect(
      await send(
        { type: 'voice:set', model: 'nope', language: 'en', limit: 60_000 },
        panelSender(),
      ),
    ).toBeUndefined()
    expect(
      await send(
        { type: 'voice:set', model: 'a/b', language: 'english', limit: 60_000 },
        panelSender(),
      ),
    ).toBe(undefined)
    expect(
      await send({ type: 'voice:set', model: 'a/b', language: 'en', limit: 1_000 }, panelSender()),
    ).toBe(undefined)
    expect(await send({ type: 'voice:set' }, panelSender())).toBe(undefined)
    expect(await send({ type: 'voice:set', limit: 1_000 }, panelSender())).toBe(undefined)
    expect(await loadKey()).toBeUndefined()
    expect(await loadVoiceSettings()).toEqual({
      model: DEFAULT_MODEL,
      language: 'auto',
      limit: 300_000,
    })
  })

  describe('testing the key', () => {
    it('says when there is none', async () => {
      const fetch = vi.spyOn(globalThis, 'fetch')
      expect(await send({ type: 'voice:key:test' }, panelSender())).toEqual({
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
      await storeKey(KEY)
      const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status }))
      const reply = await send({ type: 'voice:key:test' }, panelSender())
      expect(reply).toEqual({ ok: true, valid })
      const [url, init] = fetch.mock.calls[0] ?? []
      expect(String(url)).toBe('https://openrouter.ai/api/v1/key')
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${KEY}`)
      expect(init?.method ?? 'GET').toBe('GET')
    })

    it('says when OpenRouter cannot be reached or fails', async () => {
      await storeKey(KEY)
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError(`Failed: ${KEY}`))
      const offline = await send({ type: 'voice:key:test' }, panelSender())
      expect(offline).toEqual({ ok: false, error: 'Could not reach OpenRouter.' })
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(KEY, { status: 500 }))
      const failed = await send({ type: 'voice:key:test' }, panelSender())
      expect(failed).toEqual({ ok: false, error: 'OpenRouter could not check the key.' })
      expect(JSON.stringify([offline, failed])).not.toContain(KEY)
    })
  })
})
