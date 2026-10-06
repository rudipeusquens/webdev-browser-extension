import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { isSettings, isSiteOrigin, loadSettings, originPattern, SETTINGS_KEY } from '@/lib/settings'

describe('isSiteOrigin', () => {
  it.each(['http://localhost:3000', 'https://example.com', 'http://127.0.0.1:8080'])(
    'accepts %s',
    (origin) => expect(isSiteOrigin(origin)).toBe(true),
  )

  it.each([
    'http://localhost:3000/',
    'https://example.com/path',
    'https://EXAMPLE.com',
    'https://example.com:443',
    'file:///srv/app/index.html',
    'chrome://settings',
    'javascript:alert(1)',
    'https://user@example.com',
    'example.com',
    '',
    42,
    null,
  ])('rejects %s', (origin) => expect(isSiteOrigin(origin)).toBe(false))
})

describe('originPattern', () => {
  it('matches every page of the origin', () => {
    expect(originPattern('http://localhost:3000')).toBe('http://localhost:3000/*')
  })
})

describe('isSettings', () => {
  it('accepts remembered site origins, sorted and unique', () => {
    expect(isSettings({ rememberedOrigins: [] })).toBe(true)
    expect(isSettings({ rememberedOrigins: ['http://a.test', 'http://b.test'] })).toBe(true)
  })

  it('rejects duplicates, invalid origins, more than 100 and extra keys', () => {
    expect(isSettings({ rememberedOrigins: ['http://a.test', 'http://a.test'] })).toBe(false)
    expect(isSettings({ rememberedOrigins: ['http://a.test/'] })).toBe(false)
    expect(
      isSettings({
        rememberedOrigins: Array.from({ length: 101 }, (_, i) => `http://s${i}.test`),
      }),
    ).toBe(false)
    expect(isSettings({ rememberedOrigins: [], extra: 1 })).toBe(false)
    expect(isSettings(null)).toBe(false)
  })
})

describe('loadSettings', () => {
  beforeEach(() => fakeBrowser.reset())

  it('has defaults, and falls back to them for stored garbage', async () => {
    expect(await loadSettings()).toEqual({ rememberedOrigins: [] })
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { rememberedOrigins: 'all' } })
    expect(await loadSettings()).toEqual({ rememberedOrigins: [] })
  })
})
