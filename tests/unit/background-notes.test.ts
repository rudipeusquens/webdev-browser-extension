import { describe, expect, it } from 'vitest'
import { createDictations } from '@/lib/background/dictations'
import { createNotes } from '@/lib/background/notes'
import { addAnnotation, emptyCollection } from '@/lib/collection/ops'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { NOTES_HISTORY_KEY, NOTES_HISTORY_LIMITS, parseNotesHistory } from '@/lib/notes/history'
import { NOTE_LIMITS, NOTES_KEY, parseNotes } from '@/lib/notes/model'
import { copyable, interrupted, type JobView, jobsKey, parseJobs } from '@/lib/voice/jobs'
import { stored } from './helpers/background'
import { elementInput } from './helpers/collection'

const items = async () => parseNotes(await stored(NOTES_KEY)).items

describe('the Rec notes', () => {
  it('are made waiting for their text, filled, marked and deleted', async () => {
    const notes = createNotes(() => 'T1')
    const { id, evicted } = await notes.create({ job: { state: 'transcribing' } })
    expect(evicted).toEqual([])
    expect(await items()).toEqual([
      { id, text: '', createdAt: 'T1', job: { state: 'transcribing' } },
    ])
    expect(await notes.mark(id, { state: 'failed', error: 'offline', retry: true })).toBe(true)
    expect((await items())[0]?.job).toEqual({ state: 'failed', error: 'offline', retry: true })
    expect(await notes.fill(id, 'Hello.')).toBe(true)
    expect(await items()).toEqual([{ id, text: 'Hello.', createdAt: 'T1' }])
    expect(await notes.remove(id)).toBe(true)
    expect(await stored(NOTES_KEY)).toBeUndefined()
    expect(await notes.fill(id, 'Too late.')).toBe(false)
    expect(await notes.remove(id)).toBe(false)
  })

  describe('undo of a delete', () => {
    const history = async () =>
      parseNotesHistory(
        (await fakeBrowser.storage.session.get(NOTES_HISTORY_KEY))[NOTES_HISTORY_KEY],
      )

    it('brings the note back where it was, and redo deletes it again', async () => {
      let time = 0
      let tick = 100
      const notes = createNotes(
        () => `T${++time}`,
        () => ++tick,
      )
      const a = (await notes.create({ text: 'First.' })).id
      const b = (await notes.create({ text: 'Second.' })).id
      const c = (await notes.create({ text: 'Third.' })).id
      await notes.remove(b)
      expect((await items()).map((n) => n.id)).toEqual([a, c])
      expect(await history()).toEqual({
        undo: [{ note: { id: b, text: 'Second.', createdAt: 'T2' }, at: 101 }],
        redo: [],
      })
      expect(await notes.undo()).toEqual({ evicted: [] })
      expect((await items()).map((n) => n.id)).toEqual([a, b, c])
      expect((await history()).redo).toEqual([
        { note: { id: b, text: 'Second.', createdAt: 'T2' }, at: 102 },
      ])
      expect(await notes.undo()).toBeNull()
      expect(await notes.redo()).toBe(true)
      expect((await items()).map((n) => n.id)).toEqual([a, c])
      expect(await notes.redo()).toBe(false)
      expect(await notes.undo()).toEqual({ evicted: [] })
      expect((await items()).map((n) => n.id)).toEqual([a, b, c])
    })

    it('brings back the last note too: the list was empty', async () => {
      const notes = createNotes(() => 'T1')
      const { id } = await notes.create({ text: 'Only one.' })
      await notes.remove(id)
      expect(await stored(NOTES_KEY)).toBeUndefined()
      await notes.undo()
      expect(await items()).toEqual([{ id, text: 'Only one.', createdAt: 'T1' }])
      // Nothing left either way: the key goes.
      await notes.redo()
      await notes.undo()
      await notes.remove(id)
      expect((await history()).redo).toEqual([])
    })

    it('keeps no step for a note that waits for its text or failed', async () => {
      const notes = createNotes()
      const waiting = (await notes.create({ job: { state: 'transcribing' } })).id
      await notes.remove(waiting)
      expect(await history()).toEqual({ undo: [], redo: [] })
      expect(await notes.undo()).toBeNull()
    })

    it('has nothing to redo after another delete', async () => {
      const notes = createNotes()
      const a = (await notes.create({ text: 'A.' })).id
      const b = (await notes.create({ text: 'B.' })).id
      await notes.remove(a)
      await notes.undo()
      await notes.remove(b)
      expect((await history()).redo).toEqual([])
      expect((await history()).undo.map((s) => s.note.id)).toEqual([b])
    })

    it('makes room for a note it brings back: the oldest goes, and its id comes back', async () => {
      const notes = createNotes()
      const first = (await notes.create({ text: 'first' })).id
      const second = (await notes.create({ text: 'second' })).id
      await notes.remove(second)
      for (let i = 0; i < NOTE_LIMITS.count - 1; i++) await notes.create({ text: `n${i}` })
      expect(await notes.undo()).toEqual({ evicted: [first] })
      expect(await items()).toHaveLength(NOTE_LIMITS.count)
    })

    it('keeps the newest 20 steps', async () => {
      const notes = createNotes()
      for (let i = 0; i < NOTES_HISTORY_LIMITS.steps + 3; i++) {
        await notes.remove((await notes.create({ text: `n${i}` })).id)
      }
      const { undo } = await history()
      expect(undo).toHaveLength(NOTES_HISTORY_LIMITS.steps)
      expect(undo.at(-1)?.note.text).toBe(`n${NOTES_HISTORY_LIMITS.steps + 2}`)
    })

    it('reads no malformed step', () => {
      const good = { note: { id: 'n1', text: 'Kept.', createdAt: 'T' }, at: 5 }
      expect(
        parseNotesHistory({
          undo: [good, { note: { id: 'n2', text: '', createdAt: 'T' }, at: 5 }, { at: 1 }, null],
          redo: 'no',
        }),
      ).toEqual({ undo: [good], redo: [] })
      expect(parseNotesHistory(undefined)).toEqual({ undo: [], redo: [] })
    })
  })

  it('keep the newest 50: the oldest go, and their ids come back', async () => {
    const notes = createNotes()
    const ids: string[] = []
    for (let i = 0; i < NOTE_LIMITS.count; i++) ids.push((await notes.create({ text: `n${i}` })).id)
    const { id, evicted } = await notes.create({ text: 'newest' })
    expect(evicted).toEqual([ids[0]])
    const kept = await items()
    expect(kept).toHaveLength(NOTE_LIMITS.count)
    expect(kept.at(-1)?.id).toBe(id)
  })

  it('keep at most a megabyte, the oldest going first', async () => {
    const notes = createNotes()
    const big = 'x'.repeat(19_000)
    const first = await notes.create({ text: big })
    let evicted: string[] = []
    for (let i = 0; i < 60 && evicted.length === 0; i++) {
      evicted = (await notes.create({ text: big })).evicted
    }
    expect(evicted[0]).toBe(first.id)
    const size = new TextEncoder().encode(JSON.stringify(await stored(NOTES_KEY))).length
    expect(size).toBeLessThanOrEqual(NOTE_LIMITS.bytes)
  })

  it('are lost while transcribed, and lose their Retry, when the background starts again', async () => {
    const notes = createNotes(() => 'T1')
    const a = await notes.create({ job: { state: 'transcribing' } })
    const b = await notes.create({ job: { state: 'failed', error: 'offline', retry: true } })
    const c = await notes.create({ text: 'Done.' })
    await notes.interrupt()
    const byId = Object.fromEntries((await items()).map((n) => [n.id, n.job]))
    expect(byId[a.id]).toEqual({ state: 'failed', error: 'lost', retry: false })
    expect(byId[b.id]).toEqual({ state: 'failed', error: 'offline', retry: false })
    expect(byId[c.id]).toBeUndefined()
  })

  it.each([
    ['a note without text or job', { id: 'n1', text: '', createdAt: 'T' }],
    ['a note with a bad id', { id: 'a b', text: 'x', createdAt: 'T' }],
    ['a cut note', { id: 'n1', text: 'x', createdAt: 'T', job: { state: 'cut' } }],
    ['an extra key', { id: 'n1', text: 'x', createdAt: 'T', site: 'http://x.test' }],
    ['an endless text', { id: 'n1', text: 'x'.repeat(20_001), createdAt: 'T' }],
  ])('drop %s when read, and keep the others', (_, bad) => {
    const good = { id: 'n2', text: 'Fine.', createdAt: 'T' }
    expect(parseNotes({ version: 1, items: [bad, good] }).items).toEqual([good])
  })

  it('read as none from anything else', () => {
    for (const value of [undefined, null, 'x', { version: 2, items: [] }, { version: 1 }]) {
      expect(parseNotes(value)).toEqual({ version: 1, items: [] })
    }
  })
})

describe("the pins' dictation states", () => {
  const SITE = 'http://localhost:3000'

  it('are set and cleared per pin, and the key goes with the last', async () => {
    const dictations = createDictations()
    await dictations.set(SITE, 'a1', { state: 'transcribing' })
    await dictations.set(SITE, 'a2', { state: 'cut' })
    expect(await dictations.get(SITE, 'a1')).toEqual({ state: 'transcribing' })
    await dictations.set(SITE, 'a1', null)
    expect(await stored(jobsKey(SITE))).toEqual({ a2: { state: 'cut' } })
    await dictations.set(SITE, 'a2', null)
    expect(await stored(jobsKey(SITE))).toBeUndefined()
  })

  it('read only well-formed entries', () => {
    expect(
      parseJobs({
        a1: { state: 'transcribing' },
        'a b': { state: 'transcribing' },
        a2: { state: 'failed', error: 'oops', retry: true },
        a3: { state: 'failed', error: 'offline', retry: false, detail: 'x' },
        a4: { state: 'done' },
      }),
    ).toEqual({
      a1: { state: 'transcribing' },
      a3: { state: 'failed', error: 'offline', retry: false, detail: 'x' },
    })
    expect(parseJobs('x')).toEqual({})
  })

  it('fail after a restart, keeping their error or lost, without Retry; a cut or final one stays', () => {
    const cut: JobView = { state: 'cut' }
    const final: JobView = { state: 'failed', error: 'offline', retry: false }
    expect(interrupted(cut)).toBe(cut)
    expect(interrupted(final)).toBe(final)
    // The job's keys keep their order, the changed ones in place.
    expect(JSON.stringify(interrupted({ state: 'transcribing' }))).toBe(
      '{"state":"failed","error":"lost","retry":false}',
    )
    expect(
      JSON.stringify(interrupted({ state: 'failed', error: 'rejected', detail: 'x', retry: true })),
    ).toBe('{"state":"failed","error":"rejected","detail":"x","retry":false}')
  })

  it('keep a transcribed pin, like a draft, out of Copy as prompt', () => {
    const [pin] = addAnnotation(emptyCollection(SITE), elementInput('a1', `${SITE}/`), 'T').items
    if (!pin) throw new Error('no pin')
    const failed: JobView = { state: 'failed', error: 'offline', retry: true }
    expect(copyable(pin, undefined)).toBe(true)
    expect(copyable(pin, { a1: failed, a2: { state: 'transcribing' } })).toBe(true)
    expect(copyable(pin, { a1: { state: 'transcribing' } })).toBe(false)
    expect(copyable({ ...pin, draft: true }, {})).toBe(false)
    expect(copyable({ ...pin, status: 'done' }, {})).toBe(false)
  })
})
