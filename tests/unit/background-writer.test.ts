import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { createWriter } from '@/lib/background/writer'
import { addAnnotation, emptyCollection } from '@/lib/collection/ops'
import { collectionKey, LEGACY_KEY, loadSite } from '@/lib/collection/store'
import type { CollectionMessage } from '@/lib/messages'
import { elementInput, legacyOf } from './helpers/collection'

const SITE = 'http://localhost:3000'
const OTHER = 'http://localhost:5173'
const URL_A = `${SITE}/`
const add = (id: string, comment = 'Make it wider.', url = URL_A): CollectionMessage => ({
  type: 'annotation:add',
  ...elementInput(id, url, comment),
})
const stored = async () => fakeBrowser.storage.local.get(null)

describe('createWriter', () => {
  beforeEach(() => fakeBrowser.reset())

  it('stores an added item with number 1 and a trimmed comment', async () => {
    const { write } = createWriter(() => 'T1')
    expect(await write(SITE, add('a1', '  Wider.\n'))).toEqual({ ok: true })
    const c = await loadSite(SITE)
    expect(c.items).toHaveLength(1)
    expect(c.items[0]).toMatchObject({
      id: 'a1',
      number: 1,
      comment: 'Wider.',
      createdAt: 'T1',
      status: 'open',
    })
  })

  it('serializes parallel writes so none is lost', async () => {
    const { write } = createWriter()
    await Promise.all([write(SITE, add('a1')), write(SITE, add('a2')), write(SITE, add('a3'))])
    const c = await loadSite(SITE)
    expect(c.items.map((i) => [i.id, i.number])).toEqual([
      ['a1', 1],
      ['a2', 2],
      ['a3', 3],
    ])
  })

  it('keeps each site to itself: numbers, items and Clear all', async () => {
    const { write } = createWriter()
    await write(SITE, add('a1'))
    await write(SITE, add('a2'))
    await write(OTHER, add('b1', 'On B', `${OTHER}/x`))
    expect((await loadSite(OTHER)).items.map((i) => [i.id, i.number])).toEqual([['b1', 1]])
    expect(await write(SITE, { type: 'collection:clear', site: SITE })).toEqual({ ok: true })
    expect((await loadSite(SITE)).items).toEqual([])
    expect((await loadSite(OTHER)).items).toHaveLength(1)
    // An emptied site leaves nothing behind.
    expect(Object.keys(await stored())).toEqual([collectionKey(OTHER)])
  })

  it('refuses an item for another site than the page', async () => {
    const { write } = createWriter()
    expect(await write(OTHER, add('a1'))).toMatchObject({ ok: false })
    expect(await stored()).toEqual({})
  })

  it('updates, removes and clears', async () => {
    const { write } = createWriter(() => 'T')
    await write(SITE, add('a1'))
    await write(SITE, add('a2'))
    const update = { type: 'annotation:update', site: SITE, id: 'a2', comment: 'New' } as const
    expect(await write(SITE, update)).toEqual({ ok: true })
    expect((await loadSite(SITE)).items[1]).toMatchObject({ number: 2, comment: 'New' })
    await write(SITE, { type: 'annotation:remove', site: SITE, id: 'a1' })
    expect((await loadSite(SITE)).items.map((i) => i.number)).toEqual([2])
    await write(SITE, { type: 'collection:clear', site: SITE })
    expect((await loadSite(SITE)).items).toEqual([])
  })

  it('refuses a duplicate id and unknown items without writing', async () => {
    const { write } = createWriter()
    await write(SITE, add('a1'))
    const before = await stored()
    expect(await write(SITE, add('a1'))).toMatchObject({ ok: false })
    const update = { type: 'annotation:update', site: SITE, id: 'zz', comment: 'x' } as const
    expect(await write(SITE, update)).toMatchObject({ ok: false })
    expect(await write(SITE, { type: 'annotation:remove', site: SITE, id: 'zz' })).toMatchObject({
      ok: false,
    })
    expect(await stored()).toEqual(before)
  })

  it('replaces invalid stored data on the next write', async () => {
    await fakeBrowser.storage.local.set({ [collectionKey(SITE)]: { version: 9 } })
    await createWriter().write(SITE, add('a1'))
    expect((await loadSite(SITE)).items.map((i) => i.number)).toEqual([1])
  })

  it('keeps working after a failed write', async () => {
    const { write } = createWriter()
    const set = fakeBrowser.storage.local.set
    fakeBrowser.storage.local.set = () => Promise.reject(new Error('quota'))
    expect(await write(SITE, add('a1'))).toEqual({ ok: false, error: 'Could not save.' })
    fakeBrowser.storage.local.set = set
    expect(await write(SITE, add('a2'))).toEqual({ ok: true })
  })
})

describe('the split of the old collection', () => {
  beforeEach(() => fakeBrowser.reset())

  const onA = addAnnotation(emptyCollection(SITE), elementInput('a1', URL_A), 'T')
  const onB = addAnnotation(emptyCollection(OTHER), elementInput('b1', `${OTHER}/x`), 'T')

  it('writes one collection per site and removes the old key', async () => {
    await fakeBrowser.storage.local.set({ [LEGACY_KEY]: legacyOf(onA, onB), other: 1 })
    await createWriter().migrate()
    const all = await stored()
    expect(Object.keys(all).sort()).toEqual([collectionKey(SITE), collectionKey(OTHER), 'other'])
    expect((await loadSite(SITE)).items.map((i) => [i.id, i.status])).toEqual([['a1', 'open']])
    expect((await loadSite(OTHER)).items.map((i) => i.id)).toEqual(['b1'])
  })

  it('does nothing without an old collection, also the second time', async () => {
    await fakeBrowser.storage.local.set({ [LEGACY_KEY]: legacyOf(onA) })
    const { migrate } = createWriter()
    await migrate()
    const once = await stored()
    await migrate()
    expect(await stored()).toEqual(once)
  })

  it('leaves collections that already exist alone', async () => {
    const newer = addAnnotation(onA, elementInput('a2', URL_A), 'T')
    await fakeBrowser.storage.local.set({
      [LEGACY_KEY]: legacyOf(onA),
      [collectionKey(SITE)]: newer,
    })
    await createWriter().migrate()
    expect(await loadSite(SITE)).toEqual(newer)
    expect((await stored())[LEGACY_KEY]).toBeUndefined()
  })

  it('removes an old collection it cannot read', async () => {
    await fakeBrowser.storage.local.set({ [LEGACY_KEY]: { version: 1, items: 'x' } })
    await createWriter().migrate()
    expect(await stored()).toEqual({})
  })

  it('lets a write that arrives meanwhile land after the split', async () => {
    await fakeBrowser.storage.local.set({ [LEGACY_KEY]: legacyOf(onA) })
    const { migrate, write } = createWriter()
    const done = migrate()
    const written = write(SITE, add('a2'))
    await Promise.all([done, written])
    expect((await loadSite(SITE)).items.map((i) => [i.id, i.number])).toEqual([
      ['a1', 1],
      ['a2', 2],
    ])
  })
})
