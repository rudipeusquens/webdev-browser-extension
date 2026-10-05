import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { createWriter } from '@/lib/background/writer'
import { COLLECTION_KEY, loadCollection } from '@/lib/collection/store'
import type { BackgroundMessage } from '@/lib/messages'
import { elementInput } from './helpers/collection'

const URL_A = 'http://localhost:3000/'
const add = (id: string, comment = 'Make it wider.'): BackgroundMessage => ({
  type: 'annotation:add',
  ...elementInput(id, URL_A, comment),
})

describe('createWriter', () => {
  beforeEach(() => fakeBrowser.reset())

  it('stores an added item with number 1 and a trimmed comment', async () => {
    const write = createWriter(() => 'T1')
    expect(await write(add('a1', '  Wider.\n'))).toEqual({ ok: true })
    const c = await loadCollection()
    expect(c.items).toHaveLength(1)
    expect(c.items[0]).toMatchObject({ id: 'a1', number: 1, comment: 'Wider.', createdAt: 'T1' })
  })

  it('serializes parallel writes so none is lost', async () => {
    const write = createWriter()
    await Promise.all([write(add('a1')), write(add('a2')), write(add('a3'))])
    const c = await loadCollection()
    expect(c.items.map((i) => [i.id, i.number])).toEqual([
      ['a1', 1],
      ['a2', 2],
      ['a3', 3],
    ])
  })

  it('updates, removes and clears', async () => {
    const write = createWriter(() => 'T')
    await write(add('a1'))
    await write(add('a2'))
    expect(await write({ type: 'annotation:update', id: 'a2', comment: 'New' })).toEqual({
      ok: true,
    })
    expect((await loadCollection()).items[1]).toMatchObject({ number: 2, comment: 'New' })
    await write({ type: 'annotation:remove', id: 'a1' })
    expect((await loadCollection()).items.map((i) => i.number)).toEqual([2])
    await write({ type: 'collection:clear' })
    expect((await loadCollection()).items).toEqual([])
  })

  it('refuses a duplicate id and unknown items without writing', async () => {
    const write = createWriter()
    await write(add('a1'))
    const before = await loadCollection()
    expect(await write(add('a1'))).toMatchObject({ ok: false })
    expect(await write({ type: 'annotation:update', id: 'zz', comment: 'x' })).toMatchObject({
      ok: false,
    })
    expect(await write({ type: 'annotation:remove', id: 'zz' })).toMatchObject({ ok: false })
    expect(await loadCollection()).toEqual(before)
  })

  it('replaces invalid stored data on the next write', async () => {
    await fakeBrowser.storage.local.set({ [COLLECTION_KEY]: { version: 9 } })
    await createWriter()(add('a1'))
    expect((await loadCollection()).items.map((i) => i.number)).toEqual([1])
  })

  it('keeps working after a failed write', async () => {
    const write = createWriter()
    const set = fakeBrowser.storage.local.set
    fakeBrowser.storage.local.set = () => Promise.reject(new Error('quota'))
    expect(await write(add('a1'))).toEqual({ ok: false, error: 'Could not save.' })
    fakeBrowser.storage.local.set = set
    expect(await write(add('a2'))).toEqual({ ok: true })
  })
})
