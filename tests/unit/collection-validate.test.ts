import { describe, expect, it } from 'vitest'
import type { Collection, Target } from '@/lib/collection/model'
import { addAnnotation, emptyCollection } from '@/lib/collection/ops'
import {
  isAnnotationId,
  isCollection,
  isElementSnapshot,
  isLegacyCollection,
  isPageInfo,
  isTarget,
} from '@/lib/collection/validate'
import { legacyOf, page, snapshot } from './helpers/collection'

const SITE = 'http://localhost:3000'
const URL_A = 'http://localhost:3000/a'
const NOW = '2026-10-05T10:00:00.000Z'

const textTarget: Target = {
  kind: 'text',
  selected: 'Email notifcations',
  before: '…Manage your ',
  after: ' and alerts…',
  container: snapshot({ selector: 'section.prefs > h3' }),
}
const areaTarget: Target = {
  kind: 'area',
  rect: { x: 120, y: 640, width: 1200, height: 420 },
  container: snapshot({ selector: 'main > section.features' }),
  elements: [snapshot({ selector: 'div.card' })],
  moreCount: 0,
}

function valid(): Collection {
  const targets: Target[] = [
    {
      kind: 'element',
      element: snapshot({
        origin: { framework: 'vue', chain: [{ name: 'App', file: '/srv/app/App.vue', line: 3 }] },
      }),
    },
    textTarget,
    areaTarget,
  ]
  return targets.reduce(
    (c, target, i) =>
      addAnnotation(c, { id: `id-${i}`, page: page(URL_A), target, comment: 'x' }, NOW),
    emptyCollection(SITE),
  )
}

/** A valid collection with one change applied to a deep copy. */
function mutated(change: (c: Collection) => void): unknown {
  const c = structuredClone(valid())
  change(c)
  return c
}

const element = (c: Collection) => {
  const target = c.items[0]?.target
  if (target?.kind !== 'element') throw new Error('fixture changed')
  return target.element
}

describe('isCollection', () => {
  it('accepts element, text and area items', () => {
    expect(isCollection(valid())).toBe(true)
    expect(isCollection(emptyCollection(SITE))).toBe(true)
    expect(isCollection(emptyCollection('file://'))).toBe(true)
    expect(isCollection({ ...valid(), lastCopy: ['id-0', 'id-2'] })).toBe(true)
  })

  it.each([
    ['the old version', (c: Collection) => Object.assign(c, { version: 1 })],
    ['a site with a path', (c: Collection) => (c.site = `${SITE}/a`)],
    ['no site', (c: Collection) => delete (c as Partial<Collection>).site],
    [
      'an unknown status',
      (c: Collection) => c.items[0] && Object.assign(c.items[0], { status: 'x' }),
    ],
    [
      'an item without status',
      (c: Collection) => c.items[0] && delete (c.items[0] as { status?: string }).status,
    ],
    [
      'a page of another site',
      (c: Collection) => {
        c.site = 'http://localhost:5173'
      },
    ],
    ['a copied id twice', (c: Collection) => (c.lastCopy = ['id-0', 'id-0'])],
    ['a copied id that is no id', (c: Collection) => (c.lastCopy = ['a b'])],
    [
      'more than 1000 copied ids',
      (c: Collection) => (c.lastCopy = Array.from({ length: 1001 }, (_, i) => `c${i}`)),
    ],
    ['no lastCopy', (c: Collection) => delete (c as Partial<Collection>).lastCopy],
    ['text over 120 code points', (c: Collection) => (element(c).text = 'x'.repeat(121))],
    ['a non-finite box value', (c: Collection) => (element(c).box.width = Number.NaN)],
    ['a negative box size', (c: Collection) => (element(c).box.height = -1)],
    ['a style outside the curated list', (c: Collection) => (element(c).styles.cursor = 'auto')],
    ['a style value over 80', (c: Collection) => (element(c).styles.color = 'x'.repeat(81))],
    [
      'an origin chain of six',
      (c: Collection) =>
        (element(c).origin = {
          framework: 'vue',
          chain: Array.from({ length: 6 }, () => ({ file: '/srv/a.vue' })),
        }),
    ],
    [
      'an unknown framework',
      (c: Collection) =>
        (element(c).origin = { framework: 'react' as 'vue', chain: [{ file: '/srv/a.tsx' }] }),
    ],
    ['an extra snapshot key', (c: Collection) => Object.assign(element(c), { html: '<b>' })],
    [
      'an area with eleven elements',
      (c: Collection) => {
        const t = c.items[2]?.target
        if (t?.kind === 'area') t.elements = Array.from({ length: 11 }, () => snapshot())
      },
    ],
    [
      'selected text over 500',
      (c: Collection) => {
        const t = c.items[1]?.target
        if (t?.kind === 'text') t.selected = 'x'.repeat(501)
      },
    ],
    ['an id with a space', (c: Collection) => c.items[0] && (c.items[0].id = 'a b')],
    ['a duplicate id', (c: Collection) => c.items[1] && (c.items[1].id = 'id-0')],
    ['a duplicate number', (c: Collection) => c.items[1] && (c.items[1].number = 1)],
    ['a number not below nextNumber', (c: Collection) => (c.nextNumber = 3)],
    ['an item without its page', (c: Collection) => (c.pages = {})],
    [
      'a comment over 5000',
      (c: Collection) => c.items[0] && (c.items[0].comment = 'x'.repeat(5001)),
    ],
    [
      'a page keyed by something else than its URL',
      (c: Collection) => (c.pages = { [URL_A]: page('http://localhost:3000/other') }),
    ],
  ])('rejects %s', (_, change) => {
    expect(isCollection(mutated(change))).toBe(false)
  })

  it.each([null, undefined, 'x', 1, [], {}])('rejects %j', (value) => {
    expect(isCollection(value)).toBe(false)
  })
})

describe('isLegacyCollection', () => {
  it('accepts what milestones 2 to 5 stored, and only that', () => {
    expect(isLegacyCollection(legacyOf(valid()))).toBe(true)
    expect(isLegacyCollection(valid())).toBe(false)
    expect(isLegacyCollection({ ...legacyOf(valid()), items: 'x' })).toBe(false)
    expect(isLegacyCollection(null)).toBe(false)
  })
})

describe('isPageInfo', () => {
  it('accepts http, https and file pages', () => {
    for (const url of ['http://localhost:3000/', 'https://example.com/a?b', 'file:///srv/a.html']) {
      expect(isPageInfo(page(url))).toBe(true)
    }
  })

  it('rejects other schemes, unparsable URLs and bad fields', () => {
    expect(isPageInfo(page('javascript:alert(1)'))).toBe(false)
    expect(isPageInfo(page('not a url'))).toBe(false)
    expect(isPageInfo(page(`https://example.com/${'a'.repeat(8192)}`))).toBe(false)
    expect(isPageInfo(page(URL_A, { colorScheme: 'blue' as 'light' }))).toBe(false)
    expect(isPageInfo(page(URL_A, { title: 'x'.repeat(121) }))).toBe(false)
  })
})

describe('limits', () => {
  it('counts code points, not UTF-16 units', () => {
    const text = '😀'.repeat(120)
    expect(text.length).toBe(240)
    expect(isElementSnapshot(snapshot({ text }))).toBe(true)
    expect(isElementSnapshot(snapshot({ text: `${text}x` }))).toBe(false)
  })
})

describe('isTarget', () => {
  it('accepts the three kinds and rejects others', () => {
    expect(isTarget(textTarget)).toBe(true)
    expect(isTarget(areaTarget)).toBe(true)
    expect(isTarget({ kind: 'page' })).toBe(false)
  })
})

describe('isAnnotationId', () => {
  it('accepts 1 to 64 URL-safe characters', () => {
    expect(isAnnotationId('a'.repeat(64))).toBe(true)
    expect(isAnnotationId('3f2a-_B')).toBe(true)
    expect(isAnnotationId('')).toBe(false)
    expect(isAnnotationId('a'.repeat(65))).toBe(false)
    expect(isAnnotationId('a/b')).toBe(false)
    expect(isAnnotationId(7)).toBe(false)
  })
})
