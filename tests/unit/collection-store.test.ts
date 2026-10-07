import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { LIMITS } from '@/lib/collection/model'
import { addAnnotation, emptyCollection } from '@/lib/collection/ops'
import {
  COLLECTION_PREFIX,
  collectionKey,
  LEGACY_KEY,
  loadSite,
  loadSites,
  watchSite,
  watchSites,
} from '@/lib/collection/store'
import { elementInput } from './helpers/collection'

const A = 'http://localhost:3000'
const B = 'http://localhost:5173'
const onA = addAnnotation(emptyCollection(A), elementInput('a1', `${A}/x`), 'now')
const onB = addAnnotation(emptyCollection(B), elementInput('b1', `${B}/y`), 'now')

describe('collection store', () => {
  beforeEach(() => fakeBrowser.reset())

  it('keeps each site under its own key', () => {
    expect(collectionKey(A)).toBe('collection:http://localhost:3000')
    expect(COLLECTION_PREFIX).toBe('collection:')
    expect(LEGACY_KEY).toBe('collection')
  })

  it('loads the collection of a site', async () => {
    await fakeBrowser.storage.local.set({ [collectionKey(A)]: onA, [collectionKey(B)]: onB })
    expect(await loadSite(A)).toEqual(onA)
    expect(await loadSite(B)).toEqual(onB)
  })

  it('falls back to an empty collection of the asked site', async () => {
    expect(await loadSite(A)).toEqual(emptyCollection(A))
    await fakeBrowser.storage.local.set({ [collectionKey(A)]: { version: 2, items: 'x' } })
    expect(await loadSite(A)).toEqual(emptyCollection(A))
    // Another site's collection under this key is not this site's.
    await fakeBrowser.storage.local.set({ [collectionKey(A)]: onB })
    expect(await loadSite(A)).toEqual(emptyCollection(A))
  })

  it('keeps the valid pins of a collection that no longer validates as a whole', async () => {
    let c = onA
    c = addAnnotation(c, elementInput('a2', `${A}/x`, 'Second'), 'now')
    c = addAnnotation(c, elementInput('a3', `${A}/z`, 'Third'), 'now')
    // Pin 2 was stored by a version with a larger limit, or got damaged.
    const broken = {
      ...c,
      items: c.items.map((item) =>
        item.id === 'a2' ? { ...item, comment: 'x'.repeat(LIMITS.comment + 1) } : item,
      ),
      lastCopy: ['a1', 'a2'],
    }
    await fakeBrowser.storage.local.set({ [collectionKey(A)]: broken })
    const loaded = await loadSite(A)
    expect(loaded.items.map((item) => item.id)).toEqual(['a1', 'a3'])
    expect(Object.keys(loaded.pages).sort()).toEqual([`${A}/x`, `${A}/z`])
    expect(loaded.nextNumber).toBe(4)
    expect(loaded.lastCopy).toEqual(['a1'])
  })

  it('reports changes of its own site in local storage only', async () => {
    const seen = vi.fn()
    const stop = watchSite(A, seen)
    await fakeBrowser.storage.session.set({ [collectionKey(A)]: onA })
    await fakeBrowser.storage.local.set({ [collectionKey(B)]: onB })
    await fakeBrowser.storage.local.set({ [collectionKey(A)]: onA })
    await fakeBrowser.storage.local.remove(collectionKey(A))
    expect(seen.mock.calls).toEqual([[onA], [emptyCollection(A)]])
    stop()
    await fakeBrowser.storage.local.set({ [collectionKey(A)]: onA })
    expect(seen).toHaveBeenCalledTimes(2)
  })

  it('lists every site collection by what of it can be read, by site', async () => {
    const C = 'https://c.example.com'
    const onC = addAnnotation(emptyCollection(C), elementInput('c1', `${C}/`), 'now')
    const damaged = { ...onC, items: [...onC.items, { id: 'c2', broken: true }] }
    await fakeBrowser.storage.local.set({
      [collectionKey(B)]: onB,
      [collectionKey(A)]: onA,
      [collectionKey(C)]: damaged,
      [collectionKey('https://example.com')]: { broken: true },
      [`collection-unreadable:${A}`]: onA,
      [LEGACY_KEY]: { version: 1 },
      other: 1,
    })
    expect(await loadSites()).toEqual([onA, onB, onC])
  })

  it('says when any site changed', async () => {
    const seen = vi.fn()
    const stop = watchSites(seen)
    await fakeBrowser.storage.local.set({ other: 1 })
    await fakeBrowser.storage.session.set({ [collectionKey(A)]: onA })
    expect(seen).not.toHaveBeenCalled()
    await fakeBrowser.storage.local.set({ [collectionKey(B)]: onB })
    expect(seen).toHaveBeenCalledTimes(1)
    stop()
    await fakeBrowser.storage.local.set({ [collectionKey(A)]: onA })
    expect(seen).toHaveBeenCalledTimes(1)
  })
})
