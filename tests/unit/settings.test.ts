import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { isSiteOrigin, loadSettings, originPattern, SETTINGS_KEY } from '@/lib/settings'

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

describe('loadSettings', () => {
  beforeEach(() => fakeBrowser.reset())

  const OFF = { pageTitles: false, contextMenu: false }

  it('has defaults, and falls back to them for stored garbage', async () => {
    expect(await loadSettings()).toEqual({ rememberedOrigins: [], ...OFF })
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { rememberedOrigins: 'all' } })
    expect(await loadSettings()).toEqual({ rememberedOrigins: [], ...OFF })
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: 'all' })
    expect(await loadSettings()).toEqual({ rememberedOrigins: [], ...OFF })
  })

  it('reads the settings of milestone 6 with both options off', async () => {
    await fakeBrowser.storage.local.set({
      [SETTINGS_KEY]: { rememberedOrigins: ['http://a.test'] },
    })
    expect(await loadSettings()).toEqual({ rememberedOrigins: ['http://a.test'], ...OFF })
  })

  it('reads the options that are on', async () => {
    await fakeBrowser.storage.local.set({
      [SETTINGS_KEY]: { rememberedOrigins: [], pageTitles: true, contextMenu: true },
    })
    expect(await loadSettings()).toEqual({
      rememberedOrigins: [],
      pageTitles: true,
      contextMenu: true,
    })
  })

  it('turns an option it cannot read off, and keeps the remembered sites', async () => {
    await fakeBrowser.storage.local.set({
      [SETTINGS_KEY]: { rememberedOrigins: ['http://a.test'], pageTitles: 'yes', contextMenu: 1 },
    })
    expect(await loadSettings()).toEqual({ rememberedOrigins: ['http://a.test'], ...OFF })
  })
})
