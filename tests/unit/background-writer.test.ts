import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { loadLabels } from '@/lib/background/history'
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

  it('keeps a collection that no longer validates: its valid pins stay, and it is copied aside', async () => {
    const { write } = createWriter(() => 'T1')
    let c = addAnnotation(emptyCollection(SITE), elementInput('a1', URL_A, 'First'), 'T0')
    c = addAnnotation(c, elementInput('a2', URL_A, 'Second'), 'T0')
    const broken = {
      ...c,
      items: c.items.map((item) =>
        item.id === 'a2'
          ? { ...item, target: { kind: 'element', element: { selector: 1 } } }
          : item,
      ),
    }
    await fakeBrowser.storage.local.set({ [collectionKey(SITE)]: broken })
    expect(await write(SITE, add('n1'))).toEqual({ ok: true })
    const after = await loadSite(SITE)
    expect(after.items.map((item) => item.id)).toEqual(['a1', 'n1'])
    expect(after.items.at(-1)?.number).toBe(3)
    expect((await stored())[`collection-unreadable:${SITE}`]).toEqual(broken)
    // Copied aside once: a later write keeps the first copy.
    expect(await write(SITE, add('n2'))).toEqual({ ok: true })
    expect((await stored())[`collection-unreadable:${SITE}`]).toEqual(broken)
  })

  it("refuses a pin beyond the site's budget and says how to make room; the rest still works", async () => {
    const { write } = createWriter(() => 'T1', { siteBudget: 12_000 })
    const long = 'Make it wider. '.repeat(300)
    const replies = []
    for (let i = 1; i <= 6; i++) replies.push(await write(SITE, add(`a${i}`, long)))
    expect(replies.at(-1)).toEqual({
      ok: false,
      error: 'This site holds too much feedback: empty its bin or delete pins first.',
    })
    const kept = (await loadSite(SITE)).items.length
    expect(kept).toBeLessThan(6)
    // Changes that do not grow it, and other sites, still work.
    expect(await write(SITE, { type: 'annotation:remove', site: SITE, id: 'a1' })).toEqual({
      ok: true,
    })
    expect(await write(OTHER, add('o1', 'Here too.', `${OTHER}/`))).toEqual({ ok: true })
    expect((await loadSite(SITE)).items.length).toBe(kept)
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
    expect((await loadSite(SITE)).items.map((i) => i.status)).toEqual(['deleted', 'deleted'])
    expect(await write(SITE, { type: 'collection:empty-bin', site: SITE })).toEqual({ ok: true })
    expect((await loadSite(SITE)).items).toEqual([])
    expect((await loadSite(OTHER)).items).toHaveLength(1)
    // An emptied site leaves nothing behind.
    expect(Object.keys(await stored())).toEqual([collectionKey(OTHER)])
  })

  it('names each step by its pins, for the Undo and Redo tooltips', async () => {
    const { write } = createWriter()
    const steps: string[] = []
    const step = async (msg: CollectionMessage) => {
      expect(await write(SITE, msg)).toEqual({ ok: true })
      steps.push((await loadLabels(SITE)).undo ?? '')
    }
    await step(add('a1'))
    await step({ type: 'annotation:update', site: SITE, id: 'a1', comment: 'Other.' })
    await step(add('a2'))
    await step({ type: 'collection:copied', site: SITE, ids: ['a1', 'a2'] })
    await step({ type: 'annotation:reopen', site: SITE, id: 'a1' })
    await step({ type: 'annotation:remove', site: SITE, id: 'a1' })
    await step({ type: 'annotation:restore', site: SITE, id: 'a1' })
    await step({ type: 'collection:copied', site: SITE, ids: ['a1'] })
    await step({ type: 'collection:clear', site: SITE })
    await step({ type: 'collection:empty-bin', site: SITE })
    expect(steps).toEqual([
      'Add pin 1',
      'Edit pin 1',
      'Add pin 2',
      'Mark 2 pins done',
      'Reopen pin 1',
      'Delete pin 1',
      'Restore pin 1',
      'Copy pin 1',
      'Clear all',
      'Empty bin',
    ])
  })

  it('refuses an item for another site than the page', async () => {
    const { write } = createWriter()
    expect(await write(OTHER, add('a1'))).toMatchObject({ ok: false })
    expect(await stored()).toEqual({})
  })

  it('updates, deletes and clears', async () => {
    const { write } = createWriter(() => 'T')
    await write(SITE, add('a1'))
    await write(SITE, add('a2'))
    const update = { type: 'annotation:update', site: SITE, id: 'a2', comment: 'New' } as const
    expect(await write(SITE, update)).toEqual({ ok: true })
    expect((await loadSite(SITE)).items[1]).toMatchObject({ number: 2, comment: 'New' })
    await write(SITE, { type: 'annotation:remove', site: SITE, id: 'a1' })
    expect((await loadSite(SITE)).items.map((i) => [i.number, i.status])).toEqual([
      [1, 'deleted'],
      [2, 'open'],
    ])
    await write(SITE, { type: 'collection:clear', site: SITE })
    expect((await loadSite(SITE)).items.map((i) => [i.number, i.status])).toEqual([
      [1, 'deleted'],
      [2, 'deleted'],
    ])
    await write(SITE, { type: 'collection:empty-bin', site: SITE })
    expect((await loadSite(SITE)).items).toEqual([])
  })

  it('moves items between open, done and deleted', async () => {
    const { write } = createWriter(() => 'T')
    for (const id of ['a1', 'a2', 'a3']) await write(SITE, add(id))
    const statuses = async () => (await loadSite(SITE)).items.map((i) => i.status)
    const copied: CollectionMessage = { type: 'collection:copied', site: SITE, ids: ['a1', 'a2'] }
    expect(await write(SITE, copied)).toEqual({ ok: true })
    expect(await statuses()).toEqual(['done', 'done', 'open'])
    expect((await loadSite(SITE)).lastCopy).toEqual(['a1', 'a2'])
    await write(SITE, { type: 'annotation:reopen', site: SITE, id: 'a2' })
    await write(SITE, { type: 'annotation:remove', site: SITE, id: 'a3' })
    expect(await statuses()).toEqual(['done', 'open', 'deleted'])
    await write(SITE, { type: 'annotation:restore', site: SITE, id: 'a3' })
    expect(await statuses()).toEqual(['done', 'open', 'open'])
    const edited = { type: 'annotation:update', site: SITE, id: 'a1', comment: 'Again' } as const
    await write(SITE, edited)
    expect(await statuses()).toEqual(['open', 'open', 'open'])
  })

  it('answers ok without writing when an item is in that state already', async () => {
    const { write } = createWriter(() => 'T')
    await write(SITE, add('a1', 'Same'))
    const before = await stored()
    for (const message of [
      { type: 'annotation:restore', site: SITE, id: 'a1' },
      { type: 'annotation:reopen', site: SITE, id: 'a1' },
      { type: 'annotation:update', site: SITE, id: 'a1', comment: ' Same ' },
    ] as const) {
      expect(await write(SITE, message)).toEqual({ ok: true })
    }
    await write(SITE, { type: 'annotation:remove', site: SITE, id: 'a1' })
    const deleted = await stored()
    expect(deleted).not.toEqual(before)
    expect(await write(SITE, { type: 'annotation:remove', site: SITE, id: 'a1' })).toEqual({
      ok: true,
    })
    expect(await stored()).toEqual(deleted)
  })

  it('refuses a duplicate id and unknown items without writing', async () => {
    const { write } = createWriter()
    await write(SITE, add('a1'))
    const before = await stored()
    expect(await write(SITE, add('a1'))).toMatchObject({ ok: false })
    const update = { type: 'annotation:update', site: SITE, id: 'zz', comment: 'x' } as const
    expect(await write(SITE, update)).toMatchObject({ ok: false })
    for (const type of ['annotation:remove', 'annotation:restore', 'annotation:reopen'] as const) {
      expect(await write(SITE, { type, site: SITE, id: 'zz' })).toEqual({
        ok: false,
        error: 'This pin no longer exists.',
      })
    }
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

describe('drafts and dictations', () => {
  beforeEach(() => fakeBrowser.reset())

  const draft = (id: string, comment = ''): CollectionMessage => ({
    type: 'annotation:add',
    ...elementInput(id, URL_A, comment),
    draft: true,
  })

  it('stores a draft, keeps it a draft, and makes it a pin when saved; each an undo step', async () => {
    const { write } = createWriter(() => 'T1')
    const labels: string[] = []
    const step = async (msg: CollectionMessage) => {
      expect(await write(SITE, msg)).toEqual({ ok: true })
      labels.push((await loadLabels(SITE)).undo ?? '')
    }
    await step(draft('d1'))
    expect((await loadSite(SITE)).items[0]).toMatchObject({ comment: '', draft: true })
    await step({ type: 'annotation:update', site: SITE, id: 'd1', comment: 'Later', keep: true })
    expect((await loadSite(SITE)).items[0]).toMatchObject({ comment: 'Later', draft: true })
    await step({ type: 'annotation:update', site: SITE, id: 'd1', comment: 'Later' })
    expect(Object.keys((await loadSite(SITE)).items[0] ?? {})).not.toContain('draft')
    expect(labels).toEqual(['Add draft 1', 'Edit draft 1', 'Save pin 1'])
  })

  it('fills a dictation into its pin as one undo step', async () => {
    const { write, fill } = createWriter(() => 'T1')
    await write(SITE, draft('d1', 'Typed'))
    expect(await fill(SITE, 'd1', 'and dictated.')).toEqual({ ok: true })
    const item = (await loadSite(SITE)).items[0]
    expect(item?.comment).toBe('Typed and dictated.')
    expect(Object.keys(item ?? {})).not.toContain('draft')
    expect((await loadLabels(SITE)).undo).toBe('Dictation into pin 1')
  })

  it('gives the text back when its pin is gone or the site is full, and writes nothing', async () => {
    const { write, fill } = createWriter(() => 'T1', { siteBudget: 3_000 })
    expect(await fill(SITE, 'gone', 'Lost words.')).toEqual({ ok: true, rest: 'Lost words.' })
    await write(SITE, add('a1', 'Short.'))
    const before = await loadSite(SITE)
    const long = 'word '.repeat(600).trim()
    // The pin got none of it, but says where it went, as for a cut.
    expect(await fill(SITE, 'a1', long)).toEqual({ ok: true, rest: long, part: true })
    expect(await loadSite(SITE)).toEqual(before)
  })

  it('gives the whole text back when the comment limit cut it', async () => {
    const { write, fill } = createWriter(() => 'T1')
    await write(SITE, draft('d1'))
    const long = 'word '.repeat(1200).trim()
    expect(await fill(SITE, 'd1', long)).toEqual({ ok: true, rest: long, part: true })
    expect([...((await loadSite(SITE)).items[0]?.comment ?? '')].length).toBeLessThanOrEqual(5000)
  })
})
