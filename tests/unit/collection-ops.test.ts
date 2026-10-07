import { describe, expect, it } from 'vitest'
import type { Collection } from '@/lib/collection/model'
import {
  addAnnotation,
  clearAll,
  emptyBin,
  emptyCollection,
  groupByPage,
  markCopied,
  type NewAnnotation,
  pick,
  setStatus,
  updateComment,
} from '@/lib/collection/ops'
import { pageKey } from '@/lib/collection/page-key'
import { elementInput, page } from './helpers/collection'

const SITE = 'http://localhost:3000'
const A = 'http://localhost:3000/a'
const B = 'http://localhost:3000/b'
const T1 = '2026-10-05T10:00:00.000Z'
const T2 = '2026-10-05T11:00:00.000Z'

const build = (...inputs: NewAnnotation[]): Collection =>
  inputs.reduce((c, input) => addAnnotation(c, input, T1), emptyCollection(SITE))

describe('addAnnotation', () => {
  it('stores the page under its key, without credentials or fragment, whatever it was sent', () => {
    const c = addAnnotation(
      emptyCollection('http://localhost:3000'),
      elementInput('a1', 'http://user:secret@localhost:3000/x?q=1#token=abc'),
      'T',
    )
    expect(Object.keys(c.pages)).toEqual(['http://localhost:3000/x?q=1'])
    expect(c.pages['http://localhost:3000/x?q=1']?.url).toBe('http://localhost:3000/x?q=1')
  })

  it('numbers items in order and records the page', () => {
    const c = build(elementInput('a1', A), elementInput('a2', A), elementInput('b1', B))
    expect(c.items.map((i) => i.number)).toEqual([1, 2, 3])
    expect(c.nextNumber).toBe(4)
    expect(c.pages[pageKey(A)]).toEqual(page(A))
    expect(c.items[0]).toMatchObject({
      id: 'a1',
      pageKey: pageKey(A),
      comment: 'Make this wider.',
      createdAt: T1,
      updatedAt: T1,
      status: 'open',
    })
  })

  it('refuses a page of another site', () => {
    const c = build(elementInput('a1', A))
    expect(addAnnotation(c, elementInput('x', 'http://localhost:5173/a'), T2)).toBe(c)
    expect(addAnnotation(c, elementInput('y', 'https://localhost:3000/a'), T2)).toBe(c)
  })

  it('keys the page by its URL without the hash', () => {
    const c = build(elementInput('a1', `${A}?tab=2#top`))
    expect(Object.keys(c.pages)).toEqual([`${A}?tab=2`])
    expect(c.items[0]?.pageKey).toBe(`${A}?tab=2`)
  })

  it('keeps the latest page info', () => {
    const first = build(elementInput('a1', A))
    const c = addAnnotation(
      first,
      { ...elementInput('a2', A), page: page(A, { title: 'New' }) },
      T2,
    )
    expect(c.pages[pageKey(A)]?.title).toBe('New')
  })

  it('ignores an id that already exists', () => {
    const c = build(elementInput('a1', A))
    expect(addAnnotation(c, elementInput('a1', B), T2)).toBe(c)
  })

  it('does not mutate its input', () => {
    const c = build(elementInput('a1', A))
    const before = structuredClone(c)
    addAnnotation(c, elementInput('a2', B), T2)
    expect(c).toEqual(before)
  })
})

describe('setStatus', () => {
  it('marks an item deleted and keeps it, its page and its number', () => {
    const c = setStatus(build(elementInput('a1', A), elementInput('b1', B)), 'b1', 'deleted', T2)
    expect(c.items.map((i) => [i.id, i.number, i.status])).toEqual([
      ['a1', 1, 'open'],
      ['b1', 2, 'deleted'],
    ])
    expect(Object.keys(c.pages)).toEqual([pageKey(A), pageKey(B)])
    expect(c.items[1]?.updatedAt).toBe(T2)
    expect(c.nextNumber).toBe(3)
  })

  it('returns the same collection for an unknown id or the status it has', () => {
    const c = build(elementInput('a1', A))
    expect(setStatus(c, 'nope', 'deleted', T2)).toBe(c)
    expect(setStatus(c, 'a1', 'open', T2)).toBe(c)
  })
})

describe('markCopied', () => {
  it('marks the open items among the ids done and remembers the ids', () => {
    let c = build(elementInput('a1', A), elementInput('a2', A), elementInput('a3', A))
    c = setStatus(c, 'a2', 'deleted', T1)
    // a4 was added in another tab while the panel copied a1 to a3.
    c = addAnnotation(c, elementInput('a4', A), T1)
    const copied = markCopied(c, ['a1', 'a2', 'a3', 'gone'], T2)
    expect(copied.items.map((i) => [i.id, i.status])).toEqual([
      ['a1', 'done'],
      ['a2', 'deleted'],
      ['a3', 'done'],
      ['a4', 'open'],
    ])
    expect(copied.lastCopy).toEqual(['a1', 'a2', 'a3'])
    expect(copied.items[0]?.updatedAt).toBe(T2)
  })

  it('returns the same collection when nothing changes', () => {
    const c = markCopied(build(elementInput('a1', A)), ['a1'], T2)
    expect(markCopied(c, ['a1'], T2)).toBe(c)
  })
})

describe('updateComment', () => {
  it('changes the comment and keeps number and creation time', () => {
    const c = updateComment(build(elementInput('a1', A), elementInput('a2', A)), 'a2', 'New', T2)
    expect(c.items[1]).toMatchObject({ number: 2, comment: 'New', createdAt: T1, updatedAt: T2 })
  })

  it('returns the same collection for an unknown id or the same text', () => {
    const c = build(elementInput('a1', A))
    expect(updateComment(c, 'nope', 'New', T2)).toBe(c)
    expect(updateComment(c, 'a1', 'Make this wider.', T2)).toBe(c)
  })

  it('reopens a done item whose comment changed, and only that', () => {
    const done = markCopied(build(elementInput('a1', A), elementInput('a2', A)), ['a1', 'a2'], T1)
    const c = updateComment(done, 'a1', 'Still too narrow.', T2)
    expect(c.items.map((i) => i.status)).toEqual(['open', 'done'])
    const deleted = setStatus(done, 'a2', 'deleted', T1)
    expect(updateComment(deleted, 'a2', 'Changed', T2).items[1]?.status).toBe('deleted')
  })
})

describe('emptyCollection', () => {
  it('belongs to its site and has nothing copied yet', () => {
    expect(emptyCollection(SITE)).toEqual({
      version: 2,
      site: SITE,
      nextNumber: 1,
      pages: {},
      items: [],
      lastCopy: [],
    })
  })
})

describe('clearAll', () => {
  it('moves every open and done item to deleted, and keeps the rest', () => {
    let c = build(elementInput('a1', A), elementInput('a2', A), elementInput('b1', B))
    c = markCopied(c, ['a2'], T1)
    c = setStatus(c, 'b1', 'deleted', T1)
    const cleared = clearAll(c, T2)
    expect(cleared.items.map((i) => [i.id, i.status, i.updatedAt])).toEqual([
      ['a1', 'deleted', T2],
      ['a2', 'deleted', T2],
      ['b1', 'deleted', T1],
    ])
    expect(cleared.nextNumber).toBe(c.nextNumber)
    expect(cleared.pages).toEqual(c.pages)
    expect(cleared.lastCopy).toEqual(['a2'])
  })

  it('returns the same collection when nothing is open or done', () => {
    const c = setStatus(build(elementInput('a1', A)), 'a1', 'deleted', T1)
    expect(clearAll(c, T2)).toBe(c)
    const empty = emptyCollection(SITE)
    expect(clearAll(empty, T2)).toBe(empty)
  })
})

describe('emptyBin', () => {
  it('removes the deleted items, the pages left without items and their copies', () => {
    let c = build(elementInput('a1', A), elementInput('a2', A), elementInput('b1', B))
    c = markCopied(c, ['a1', 'b1'], T1)
    c = setStatus(setStatus(c, 'a2', 'deleted', T1), 'b1', 'deleted', T1)
    const emptied = emptyBin(c)
    expect(emptied.items.map((i) => i.id)).toEqual(['a1'])
    expect(Object.keys(emptied.pages)).toEqual([pageKey(A)])
    expect(emptied.lastCopy).toEqual(['a1'])
    // Numbers stay unique: the next one goes on.
    expect(emptied.nextNumber).toBe(4)
  })

  it('starts the numbering again once nothing is left', () => {
    const c = clearAll(build(elementInput('a1', A), elementInput('a2', A)), T2)
    const emptied = emptyBin(c)
    expect(emptied).toEqual(emptyCollection(SITE))
    expect(addAnnotation(emptied, elementInput('x', A), T2).items[0]?.number).toBe(1)
  })

  it('returns the same collection without deleted items', () => {
    const c = build(elementInput('a1', A))
    expect(emptyBin(c)).toBe(c)
  })
})

describe('pick', () => {
  it('keeps the chosen items, their pages and their numbers', () => {
    const c = build(elementInput('a1', A), elementInput('b1', B), elementInput('a2', A))
    const picked = pick(c, new Set(['a2', 'zz']))
    expect(picked.items.map((i) => [i.id, i.number])).toEqual([['a2', 3]])
    expect(Object.keys(picked.pages)).toEqual([pageKey(A)])
    expect(picked.site).toBe(SITE)
    expect(c.items).toHaveLength(3)
  })
})

describe('groupByPage', () => {
  it('orders pages by their first item and items by number', () => {
    const c = build(elementInput('b1', B), elementInput('a1', A), elementInput('b2', B))
    const groups = groupByPage(c)
    expect(groups.map((g) => g.key)).toEqual([pageKey(B), pageKey(A)])
    expect(groups[0]?.items.map((i) => i.number)).toEqual([1, 3])
    expect(groups[0]?.page).toEqual(page(B))
  })

  it('sorts by number even when items are stored out of order', () => {
    const c = build(elementInput('a1', A), elementInput('a2', A))
    const shuffled = { ...c, items: [...c.items].reverse() }
    expect(groupByPage(shuffled)[0]?.items.map((i) => i.id)).toEqual(['a1', 'a2'])
    expect(shuffled.items.map((i) => i.id)).toEqual(['a2', 'a1'])
  })
})
