import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { loadSettings, SETTINGS_KEY } from '@/lib/settings'
import { deleteKey, isApiKey, KEY_DB, loadKey, maskKey, storeKey } from '@/lib/voice/key'
import {
  DEFAULT_MODEL,
  isLanguage,
  isModelId,
  isVoiceSettings,
  LANGUAGES,
  loadVoiceSettings,
  MODELS,
  VOICE_KEY,
  watchVoiceSettings,
} from '@/lib/voice/settings'

// A well-formed but fake key, assembled at runtime so this file never contains one.
const KEY = 'sk-or-v1-' + 'ab12'.repeat(16)

describe('voice settings', () => {
  beforeEach(() => fakeBrowser.reset())

  it('default to the spec model and automatic language', async () => {
    expect(DEFAULT_MODEL).toBe('openai/gpt-4o-mini-transcribe')
    expect(await loadVoiceSettings()).toEqual({ model: DEFAULT_MODEL, language: 'auto' })
  })

  it('load what is stored', async () => {
    const stored = { model: 'mistralai/voxtral-mini-transcribe', language: 'de' }
    await fakeBrowser.storage.local.set({ [VOICE_KEY]: stored })
    expect(await loadVoiceSettings()).toEqual(stored)
  })

  it.each([
    ['a model without a vendor', { model: 'gpt-4o', language: 'auto' }],
    ['a three-letter language', { model: DEFAULT_MODEL, language: 'deu' }],
    ['an extra key', { model: DEFAULT_MODEL, language: 'auto', key: 'x' }],
    ['a missing language', { model: DEFAULT_MODEL }],
    ['a string', 'openai/gpt-4o-mini-transcribe'],
  ])('fall back to the defaults for %s, leaving the sites alone', async (_, stored) => {
    await fakeBrowser.storage.local.set({
      [VOICE_KEY]: stored,
      [SETTINGS_KEY]: { rememberedOrigins: ['http://localhost:3000'] },
    })
    expect(await loadVoiceSettings()).toEqual({ model: DEFAULT_MODEL, language: 'auto' })
    expect((await loadSettings()).rememberedOrigins).toEqual(['http://localhost:3000'])
  })

  it('report their own changes only', async () => {
    const seen = vi.fn()
    const stop = watchVoiceSettings(seen)
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { rememberedOrigins: [] } })
    await fakeBrowser.storage.session.set({ [VOICE_KEY]: { model: 'a/b', language: 'en' } })
    expect(seen).not.toHaveBeenCalled()
    await fakeBrowser.storage.local.set({ [VOICE_KEY]: { model: 'a/b', language: 'en' } })
    expect(seen).toHaveBeenCalledWith({ model: 'a/b', language: 'en' })
    await fakeBrowser.storage.local.set({ [VOICE_KEY]: { model: 'bad', language: 'en' } })
    expect(seen).toHaveBeenLastCalledWith({ model: DEFAULT_MODEL, language: 'auto' })
    stop()
    await fakeBrowser.storage.local.set({ [VOICE_KEY]: { model: 'c/d', language: 'fr' } })
    expect(seen).toHaveBeenCalledTimes(2)
  })

  it.each([
    'openai/gpt-4o-mini-transcribe',
    'mistralai/voxtral-mini-transcribe',
    'qwen/qwen3-asr-flash-2026-02-10',
    'vendor/model:free',
    'a/b',
  ])('accept the model id %s', (id) => expect(isModelId(id)).toBe(true))

  it.each([
    'gpt-4o',
    '/model',
    'vendor/',
    'a/b/c',
    '../x',
    'vendor/model name',
    'vendor/model\n',
    `vendor/${'m'.repeat(94)}`,
    '',
    42,
    null,
  ])('refuse the model id %j', (id) => expect(isModelId(id)).toBe(false))

  it('accept auto and two-letter codes as language', () => {
    for (const language of ['auto', 'en', 'de']) expect(isLanguage(language)).toBe(true)
    for (const language of ['EN', 'deu', 'e', '', 'en-US', 'Auto', 3]) {
      expect(isLanguage(language)).toBe(false)
    }
  })

  it('offer the spec models, the default first, and automatic language first', () => {
    expect(MODELS.map((m) => m.id)).toEqual([
      'openai/gpt-4o-mini-transcribe',
      'openai/gpt-4o-transcribe',
      'openai/whisper-large-v3-turbo',
      'mistralai/voxtral-mini-transcribe',
    ])
    expect(LANGUAGES[0]?.code).toBe('auto')
    expect(MODELS.every((m) => isModelId(m.id) && m.label.length > 0)).toBe(true)
    expect(LANGUAGES.every((l) => isLanguage(l.code) && l.label.length > 0)).toBe(true)
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length)
    expect(isVoiceSettings({ model: MODELS[3]?.id, language: LANGUAGES[2]?.code })).toBe(true)
  })
})

describe('the API key', () => {
  beforeEach(() => fakeBrowser.reset())

  it('accepts key-shaped text only', () => {
    expect(isApiKey(KEY)).toBe(true)
    expect(isApiKey('test-key-1')).toBe(true)
    for (const key of [
      'short',
      'with space inside',
      `${KEY}\n`,
      'tab\there-and-more',
      'ä'.repeat(10),
      'x'.repeat(257),
      '',
      42,
      null,
    ]) {
      expect(isApiKey(key)).toBe(false)
    }
  })

  it('shows at most its prefix and the last four characters', () => {
    expect(maskKey(KEY)).toBe('sk-or-v1-…ab12')
    expect(maskKey('another-key-9876')).toBe('…9876')
    expect(maskKey(KEY)).not.toContain(KEY.slice(9, -4))
  })

  it('is stored, loaded and deleted', async () => {
    expect(await loadKey()).toBeUndefined()
    await storeKey(KEY)
    expect(await loadKey()).toBe(KEY)
    await storeKey('another-key-9876')
    expect(await loadKey()).toBe('another-key-9876')
    await deleteKey()
    expect(await loadKey()).toBeUndefined()
    await deleteKey()
  })

  it('loads nothing malformed', async () => {
    await rawPut('a b')
    expect(await loadKey()).toBeUndefined()
    await rawPut(42)
    expect(await loadKey()).toBeUndefined()
  })

  // Content scripts can read chrome.storage.local and get its change events; they cannot open
  // the extension origin's IndexedDB.
  it('never goes through chrome.storage', async () => {
    const changes = vi.fn()
    fakeBrowser.storage.onChanged.addListener(changes)
    await storeKey(KEY)
    await deleteKey()
    expect(changes).not.toHaveBeenCalled()
    expect(JSON.stringify(await fakeBrowser.storage.local.get(null))).not.toContain(KEY)
    expect(JSON.stringify(await loadSettings())).not.toContain(KEY)
    expect(JSON.stringify(await loadVoiceSettings())).not.toContain(KEY)
  })
})

/** Writes `value` where the key lives, bypassing the shape check of storeKey. */
async function rawPut(value: unknown) {
  const open = indexedDB.open(KEY_DB.name, KEY_DB.version)
  open.onupgradeneeded = () => open.result.createObjectStore(KEY_DB.store)
  const db = await new Promise<IDBDatabase>((done) => (open.onsuccess = () => done(open.result)))
  const tx = db.transaction(KEY_DB.store, 'readwrite')
  tx.objectStore(KEY_DB.store).put(value, KEY_DB.record)
  await new Promise((done) => (tx.oncomplete = done))
  db.close()
}
