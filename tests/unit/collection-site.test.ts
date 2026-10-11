import { describe, expect, it } from 'vitest'
import { belongsTo, bySite, isSite, siteLabel, siteOf, siteOrNull } from '@/lib/collection/site'

/** `url` with a user name and password, set at runtime so this file holds no credential. */
function withLogin(url: string): string {
  const parsed = new URL(url)
  parsed.username = 'someone'
  parsed.password = 'not-a-secret'
  return parsed.href
}

describe('siteOf', () => {
  it.each([
    ['http://localhost:3000/settings?tab=2#top', 'http://localhost:3000'],
    ['http://localhost:5173/', 'http://localhost:5173'],
    ['https://example.com/a/b', 'https://example.com'],
    ['https://example.com:443/a', 'https://example.com'],
    [withLogin('http://example.com:8080/x'), 'http://example.com:8080'],
    ['file:///srv/app/index.html', 'file://'],
    ['file:///C:/app/page.html', 'file://'],
  ])('%s belongs to %s', (url, site) => {
    expect(siteOf(url)).toBe(site)
  })

  it.each(['javascript:alert(1)', 'chrome://extensions/', 'data:text/html,x', 'not a url'])(
    'refuses %s',
    (url) => {
      expect(() => siteOf(url)).toThrow()
    },
  )
})

describe('siteOrNull', () => {
  it('is the site of a page', () => {
    expect(siteOrNull('https://example.com/a')).toBe('https://example.com')
    expect(siteOrNull('file:///srv/app/index.html')).toBe('file://')
  })

  it.each(['chrome://extensions/', 'blob:https://example.com/x', 'about:blank', 'not a url', ''])(
    'is null for %j',
    (url) => {
      expect(siteOrNull(url)).toBeNull()
    },
  )

  it('is null without a URL', () => {
    expect(siteOrNull(undefined)).toBeNull()
  })
})

describe('belongsTo', () => {
  it('tells whether a page is of the site', () => {
    expect(belongsTo('https://example.com/a', 'https://example.com')).toBe(true)
    expect(belongsTo('file:///srv/a.html', 'file://')).toBe(true)
    expect(belongsTo('https://example.com:8443/a', 'https://example.com')).toBe(false)
    expect(belongsTo('chrome://extensions/', 'https://example.com')).toBe(false)
    expect(belongsTo('', 'file://')).toBe(false)
  })
})

describe('bySite', () => {
  it('sorts by site', () => {
    const sites = [{ site: 'https://example.com' }, { site: 'file://' }, { site: 'http://b.test' }]
    expect(sites.sort(bySite).map((c) => c.site)).toEqual([
      'file://',
      'http://b.test',
      'https://example.com',
    ])
  })
})

describe('isSite', () => {
  it('accepts what siteOf writes', () => {
    for (const site of ['http://localhost:3000', 'https://example.com', 'file://']) {
      expect(isSite(site)).toBe(true)
    }
  })

  it.each([
    'http://localhost:3000/',
    'http://localhost:3000/a',
    'https://example.com:443',
    'file:///srv',
    'chrome://extensions',
    'null',
    '',
    42,
    null,
  ])('refuses %j', (value) => {
    expect(isSite(value)).toBe(false)
  })
})

describe('siteLabel', () => {
  it('names the host and port, or local files', () => {
    expect(siteLabel('http://localhost:3000')).toBe('localhost:3000')
    expect(siteLabel('https://example.com')).toBe('example.com')
    expect(siteLabel('file://')).toBe('Local files')
  })
})
