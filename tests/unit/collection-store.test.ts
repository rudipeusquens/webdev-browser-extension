import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
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

  it('lists every valid site collection, by site', async () => {
    await fakeBrowser.storage.local.set({
      [collectionKey(B)]: onB,
      [collectionKey(A)]: onA,
      [collectionKey('https://example.com')]: { broken: true },
      [LEGACY_KEY]: { version: 1 },
      other: 1,
    })
    expect(await loadSites()).toEqual([onA, onB])
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
