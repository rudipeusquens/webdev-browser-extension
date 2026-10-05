import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { addAnnotation, emptyCollection } from '@/lib/collection/ops'
import { COLLECTION_KEY, loadCollection, watchCollection } from '@/lib/collection/store'
import { elementInput } from './helpers/collection'

const stored = addAnnotation(emptyCollection(), elementInput('a1', 'http://localhost/'), 'now')

describe('collection store', () => {
  beforeEach(() => fakeBrowser.reset())

  it('loads a stored collection', async () => {
    await fakeBrowser.storage.local.set({ [COLLECTION_KEY]: stored })
    expect(await loadCollection()).toEqual(stored)
  })

  it('falls back to an empty collection for missing or invalid data', async () => {
    expect(await loadCollection()).toEqual(emptyCollection())
    await fakeBrowser.storage.local.set({ [COLLECTION_KEY]: { version: 1, items: 'x' } })
    expect(await loadCollection()).toEqual(emptyCollection())
  })

  it('reports changes in local storage only', async () => {
    const seen = vi.fn()
    const stop = watchCollection(seen)
    await fakeBrowser.storage.session.set({ [COLLECTION_KEY]: stored })
    await fakeBrowser.storage.local.set({ [COLLECTION_KEY]: stored })
    await fakeBrowser.storage.local.set({ other: 1 })
    expect(seen.mock.calls).toEqual([[stored]])
    stop()
    await fakeBrowser.storage.local.set({ [COLLECTION_KEY]: emptyCollection() })
    expect(seen).toHaveBeenCalledTimes(1)
  })
})
