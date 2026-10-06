import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import {
  applyStep,
  HISTORY_BYTES,
  HISTORY_LIMIT,
  HISTORY_PREFIX,
  LABELS_PREFIX,
  loadHistory,
  loadLabels,
  saveHistory,
  type Step,
  stepBetween,
} from '@/lib/background/history'
import { createWriter } from '@/lib/background/writer'
import type { Collection } from '@/lib/collection/model'
import {
  addAnnotation,
  clearAll,
  emptyCollection,
  markCopied,
  setStatus,
  updateComment,
} from '@/lib/collection/ops'
import { collectionKey, loadSite } from '@/lib/collection/store'
import type { CollectionMessage } from '@/lib/messages'
import { elementInput } from './helpers/collection'

const SITE = 'http://localhost:3000'
const OTHER = 'http://localhost:5173'
const A = `${SITE}/a`
const B = `${SITE}/b`

function two(): Collection {
  let c = addAnnotation(emptyCollection(SITE), elementInput('a1', A), 'T1')
  c = addAnnotation(c, elementInput('b1', B, 'On B'), 'T1')
  return c
}

describe('steps', () => {
  const changes: [string, (c: Collection) => Collection][] = [
    ['an added item and its page', (c) => addAnnotation(c, elementInput('c1', `${SITE}/c`), 'T2')],
    ['an edit', (c) => updateComment(c, 'a1', 'Changed', 'T2')],
    ['a deletion', (c) => setStatus(c, 'b1', 'deleted', 'T2')],
    ['a copy', (c) => markCopied(c, ['a1', 'b1'], 'T2')],
    ['Clear all', (c) => clearAll(c)],
  ]

  it.each(changes)('put back and apply again %s exactly', (_, change) => {
    const before = two()
    const after = change(before)
    const step = stepBetween(before, after, 'Label')
    expect(step).not.toBeNull()
    expect(applyStep(after, step!, 'before')).toEqual(before)
    expect(applyStep(before, step!, 'after')).toEqual(after)
    // A step survives storage: plain data only.
    expect(JSON.parse(JSON.stringify(step))).toEqual(step)
  })

  it('hold only what changed', () => {
    const before = two()
    const step = stepBetween(before, setStatus(before, 'b1', 'deleted', 'T2'), 'Delete item 2')
    expect(step?.label).toBe('Delete item 2')
    expect(step?.items.map((i) => i.id)).toEqual(['b1'])
    expect(step?.pages).toEqual([])
  })

  it('are nothing when nothing changed', () => {
    const c = two()
    expect(stepBetween(c, c, 'x')).toBeNull()
    expect(stepBetween(c, structuredClone(c), 'x')).toBeNull()
  })

  it('refuse to put back what changed since', () => {
    const before = two()
    const after = setStatus(before, 'b1', 'deleted', 'T2')
    const step = stepBetween(before, after, 'Delete item 2')!
    expect(
      applyStep(updateComment(after, 'b1', 'Edited elsewhere', 'T3'), step, 'before'),
    ).toBeNull()
    expect(applyStep(after, step, 'after')).toBeNull()
    const added = stepBetween(before, addAnnotation(before, elementInput('c1', A), 'T2'), 'Add')!
    expect(applyStep(before, added, 'before')).toBeNull()
  })
})

describe('undo and redo', () => {
  beforeEach(() => fakeBrowser.reset())

  const add = (id: string, url = A): CollectionMessage => ({
    type: 'annotation:add',
    ...elementInput(id, url),
  })
  const items = async (site = SITE) =>
    (await loadSite(site)).items.map((i) => [i.id, i.number, i.status, i.comment])

  it('undoes and redoes every kind of change, numbers and last copy included', async () => {
    const { write, undo, redo } = createWriter(() => 'T')
    const messages: CollectionMessage[] = [
      add('a1'),
      add('a2'),
      { type: 'annotation:update', site: SITE, id: 'a1', comment: 'Changed' },
      { type: 'collection:copied', site: SITE, ids: ['a1', 'a2'] },
      { type: 'annotation:reopen', site: SITE, id: 'a2' },
      { type: 'annotation:remove', site: SITE, id: 'a2' },
      { type: 'annotation:restore', site: SITE, id: 'a2' },
      { type: 'collection:clear', site: SITE },
    ]
    const states: unknown[] = [await loadSite(SITE)]
    for (const message of messages) {
      expect(await write(SITE, message)).toEqual({ ok: true })
      states.push(await loadSite(SITE))
    }
    for (let i = states.length - 2; i >= 0; i--) {
      expect(await undo(SITE)).toEqual({ ok: true })
      expect(await loadSite(SITE)).toEqual(states[i])
    }
    expect(await undo(SITE)).toEqual({ ok: false, error: 'Nothing to undo.' })
    for (let i = 1; i < states.length; i++) {
      expect(await redo(SITE)).toEqual({ ok: true })
      expect(await loadSite(SITE)).toEqual(states[i])
    }
    expect(await redo(SITE)).toEqual({ ok: false, error: 'Nothing to redo.' })
  })

  it('names the next steps for the panel', async () => {
    const { write, undo } = createWriter(() => 'T')
    expect(await loadLabels(SITE)).toEqual({})
    await write(SITE, add('a1'))
    expect(await loadLabels(SITE)).toEqual({ undo: 'Add item 1' })
    // Stored apart from the steps, so the panel never reads them.
    const stored = await fakeBrowser.storage.session.get(`${LABELS_PREFIX}${SITE}`)
    expect(stored[`${LABELS_PREFIX}${SITE}`]).toEqual({ undo: 'Add item 1' })
    await write(SITE, add('a2'))
    await write(SITE, { type: 'collection:copied', site: SITE, ids: ['a1', 'a2'] })
    expect(await loadLabels(SITE)).toEqual({ undo: 'Mark 2 items done' })
    await write(SITE, { type: 'annotation:remove', site: SITE, id: 'a1' })
    await undo(SITE)
    expect(await loadLabels(SITE)).toEqual({
      undo: 'Mark 2 items done',
      redo: 'Delete item 1',
    })
    await write(SITE, { type: 'collection:clear', site: SITE })
    expect(await loadLabels(SITE)).toEqual({ undo: 'Clear all' })
  })

  it('forgets what could be redone once something new happens', async () => {
    const { write, undo, redo } = createWriter(() => 'T')
    await write(SITE, add('a1'))
    await undo(SITE)
    await write(SITE, add('a2'))
    expect(await redo(SITE)).toEqual({ ok: false, error: 'Nothing to redo.' })
    expect(await items()).toEqual([['a2', 1, 'open', 'Make this wider.']])
  })

  it(`keeps the last ${HISTORY_LIMIT} steps`, async () => {
    const { write, undo } = createWriter(() => 'T')
    for (let i = 0; i <= HISTORY_LIMIT; i++) await write(SITE, add(`a${i}`))
    for (let i = 0; i < HISTORY_LIMIT; i++) expect(await undo(SITE)).toEqual({ ok: true })
    expect(await undo(SITE)).toEqual({ ok: false, error: 'Nothing to undo.' })
    expect(await items()).toEqual([['a0', 1, 'open', 'Make this wider.']])
  })

  it('records nothing for a refused or unchanged write', async () => {
    const { write } = createWriter(() => 'T')
    await write(SITE, add('a1'))
    await write(SITE, add('a1'))
    await write(SITE, { type: 'annotation:restore', site: SITE, id: 'a1' })
    await write(SITE, { type: 'annotation:remove', site: SITE, id: 'zz' })
    const stored = await fakeBrowser.storage.session.get(`${HISTORY_PREFIX}${SITE}`)
    expect((stored[`${HISTORY_PREFIX}${SITE}`] as { undo: unknown[] }).undo).toHaveLength(1)
  })

  it('refuses and forgets the history when an item changed outside it', async () => {
    const { write, undo, redo } = createWriter(() => 'T')
    await write(SITE, add('a1'))
    await write(SITE, { type: 'annotation:remove', site: SITE, id: 'a1' })
    // Something wrote the collection without a step (should not happen).
    const c = await loadSite(SITE)
    await fakeBrowser.storage.local.set({
      [collectionKey(SITE)]: updateComment(c, 'a1', 'Elsewhere', 'T'),
    })
    expect(await undo(SITE)).toEqual({
      ok: false,
      error: 'This changed in the meantime; it can no longer be undone.',
    })
    expect(await items()).toEqual([['a1', 1, 'deleted', 'Elsewhere']])
    expect(await loadLabels(SITE)).toEqual({})
    expect(await redo(SITE)).toMatchObject({ ok: false })
  })

  it('keeps each site to its own history', async () => {
    const { write, undo } = createWriter(() => 'T')
    await write(SITE, add('a1'))
    await write(OTHER, add('o1', `${OTHER}/`))
    expect(await undo(SITE)).toEqual({ ok: true })
    expect(await items()).toEqual([])
    expect(await items(OTHER)).toEqual([['o1', 1, 'open', 'Make this wider.']])
    expect(await undo(SITE)).toEqual({ ok: false, error: 'Nothing to undo.' })
  })

  it('drops the oldest steps when the session storage is full', async () => {
    const { write, undo } = createWriter(() => 'T')
    const set = fakeBrowser.storage.session.set.bind(fakeBrowser.storage.session)
    // Room for three steps at most.
    fakeBrowser.storage.session.set = async (items: Record<string, unknown>) => {
      const history = items[`${HISTORY_PREFIX}${SITE}`] as { undo: unknown[] } | undefined
      if (history && history.undo.length > 3) throw new Error('QUOTA_BYTES quota exceeded')
      return set(items)
    }
    for (let i = 0; i < 6; i++) expect(await write(SITE, add(`a${i}`))).toEqual({ ok: true })
    // The newest three steps stay; older ones went one at a time.
    let undone = 0
    while ((await undo(SITE)).ok) undone++
    expect(undone).toBe(3)
    expect((await items()).map(([id]) => id)).toEqual(['a0', 'a1', 'a2'])
  })
})

describe('the size of the history', () => {
  beforeEach(() => fakeBrowser.reset())

  /** A step of about `size` characters: storage.session is shared with other runtime state. */
  const step = (size: number, label = 'x'): Step => ({
    label: label + ' '.repeat(size),
    items: [],
    pages: [],
    nextNumber: [1, 1],
    lastCopy: [[], []],
  })

  it('keeps the newest steps that fit, so the rest of the session storage stays free', async () => {
    // A third, less room for the JSON around each step.
    const third = Math.floor(HISTORY_BYTES / 3) - 200
    await saveHistory(SITE, {
      undo: [step(third, 'a'), step(third, 'b'), step(third, 'c'), step(third, 'd')],
      redo: [],
    })
    const kept = await loadHistory(SITE)
    expect(kept.undo.map((s) => s.label[0])).toEqual(['b', 'c', 'd'])
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(HISTORY_BYTES)
    expect(await loadLabels(SITE)).toEqual({ undo: expect.stringMatching(/^d/) })
  })

  it('keeps no history when a single step is too large', async () => {
    await saveHistory(SITE, { undo: [step(HISTORY_BYTES)], redo: [] })
    expect(await loadHistory(SITE)).toEqual({ undo: [], redo: [] })
    expect(await loadLabels(SITE)).toEqual({})
  })
})
