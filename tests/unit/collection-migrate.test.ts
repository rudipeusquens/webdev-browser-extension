import { describe, expect, it } from 'vitest'
import { splitLegacy } from '@/lib/collection/migrate'
import { addAnnotation, emptyCollection } from '@/lib/collection/ops'
import { isCollection, isLegacyCollection } from '@/lib/collection/validate'
import { elementInput, legacyOf } from './helpers/collection'

const T = '2026-10-05T10:00:00.000Z'

/** What milestone 5 stored: items 1–4 on two origins and a local file, nextNumber 6. */
function legacy() {
  let c = emptyCollection('http://localhost:3000')
  c = addAnnotation(c, elementInput('a1', 'http://localhost:3000/'), T)
  c = addAnnotation(c, elementInput('b1', 'http://localhost:5173/x', 'On B'), T)
  return legacyOf(c)
}

describe('splitLegacy', () => {
  it('gives every site its own collection, with the items as they were and open', () => {
    // Built by hand: one old collection held items of every site.
    const old = {
      version: 1 as const,
      nextNumber: 6,
      pages: {
        'http://localhost:3000/': { ...legacy().pages['http://localhost:3000/']! },
        'http://localhost:5173/x': {
          ...legacy().pages['http://localhost:3000/']!,
          url: 'http://localhost:5173/x',
        },
        'file:///srv/a.html': {
          ...legacy().pages['http://localhost:3000/']!,
          url: 'file:///srv/a.html',
        },
      },
      items: [
        { ...legacy().items[0]!, id: 'a1', number: 1, pageKey: 'http://localhost:3000/' },
        { ...legacy().items[0]!, id: 'b1', number: 2, pageKey: 'http://localhost:5173/x' },
        { ...legacy().items[0]!, id: 'a2', number: 4, pageKey: 'http://localhost:3000/' },
        { ...legacy().items[0]!, id: 'f1', number: 5, pageKey: 'file:///srv/a.html' },
      ],
    }
    expect(isLegacyCollection(old)).toBe(true)
    const sites = splitLegacy(old)
    expect(sites.map((c) => c.site)).toEqual([
      'file://',
      'http://localhost:3000',
      'http://localhost:5173',
    ])
    for (const c of sites) {
      expect(isCollection(c)).toBe(true)
      expect(c.nextNumber).toBe(6)
      expect(c.lastCopy).toEqual([])
      expect(c.items.every((item) => item.status === 'open')).toBe(true)
    }
    const local = sites[1]!
    expect(local.items.map((i) => [i.id, i.number])).toEqual([
      ['a1', 1],
      ['a2', 4],
    ])
    expect(Object.keys(local.pages)).toEqual(['http://localhost:3000/'])
    expect(local.items[0]).toEqual({ ...old.items[0], status: 'open' })
  })

  it('gives nothing for an empty collection', () => {
    expect(splitLegacy({ version: 1, nextNumber: 1, pages: {}, items: [] })).toEqual([])
  })
})
