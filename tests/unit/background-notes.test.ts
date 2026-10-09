import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { createDictations } from '@/lib/background/dictations'
import { createNotes } from '@/lib/background/notes'
import { NOTE_LIMITS, NOTES_KEY, parseNotes } from '@/lib/notes/model'
import { jobsKey, parseJobs } from '@/lib/voice/jobs'

const stored = async (key: string) => (await fakeBrowser.storage.local.get(key))[key]
const items = async () => parseNotes(await stored(NOTES_KEY)).items

describe('the Rec notes', () => {
  beforeEach(() => fakeBrowser.reset())

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
  beforeEach(() => fakeBrowser.reset())

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
})
