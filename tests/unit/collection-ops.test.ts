import { describe, expect, it } from 'vitest'
import type { Collection } from '@/lib/collection/model'
import {
  addAnnotation,
  clearAll,
  emptyCollection,
  groupByPage,
  type NewAnnotation,
  removeAnnotation,
  updateComment,
} from '@/lib/collection/ops'
import { pageKey } from '@/lib/collection/page-key'
import { elementInput, page } from './helpers/collection'

const A = 'http://localhost:3000/a'
const B = 'http://localhost:3000/b'
const T1 = '2026-10-05T10:00:00.000Z'
const T2 = '2026-10-05T11:00:00.000Z'

const build = (...inputs: NewAnnotation[]): Collection =>
  inputs.reduce((c, input) => addAnnotation(c, input, T1), emptyCollection())

describe('addAnnotation', () => {
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
    })
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

describe('removeAnnotation', () => {
  it('leaves a gap in the numbering', () => {
    const c = removeAnnotation(
      build(elementInput('a1', A), elementInput('a2', A), elementInput('a3', A)),
      'a2',
    )
    expect(c.items.map((i) => i.number)).toEqual([1, 3])
    expect(c.nextNumber).toBe(4)
  })

  it('drops the page when its last item goes', () => {
    const c = removeAnnotation(build(elementInput('a1', A), elementInput('b1', B)), 'b1')
    expect(Object.keys(c.pages)).toEqual([pageKey(A)])
  })

  it('returns the same collection for an unknown id', () => {
    const c = build(elementInput('a1', A))
    expect(removeAnnotation(c, 'nope')).toBe(c)
  })
})

describe('updateComment', () => {
  it('changes the comment and keeps number and creation time', () => {
    const c = updateComment(build(elementInput('a1', A), elementInput('a2', A)), 'a2', 'New', T2)
    expect(c.items[1]).toMatchObject({ number: 2, comment: 'New', createdAt: T1, updatedAt: T2 })
  })

  it('returns the same collection for an unknown id', () => {
    const c = build(elementInput('a1', A))
    expect(updateComment(c, 'nope', 'New', T2)).toBe(c)
  })
})

describe('clearAll', () => {
  it('resets the numbering', () => {
    const c = addAnnotation(clearAll(), elementInput('x', A), T2)
    expect(c.items[0]?.number).toBe(1)
    expect(c.nextNumber).toBe(2)
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
