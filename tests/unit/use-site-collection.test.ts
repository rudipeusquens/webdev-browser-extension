import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { useSiteCollection } from '@/composables/use-site-collection'
import { addAnnotation, emptyCollection } from '@/lib/collection/ops'
import { collectionKey } from '@/lib/collection/store'
import { elementInput } from './helpers/collection'

const A = 'http://localhost:3000'
const B = 'http://localhost:5173'

function mountWith(site: ReturnType<typeof ref<string | null>>) {
  let state: ReturnType<typeof useSiteCollection> | undefined
  mount(
    defineComponent({
      setup() {
        state = useSiteCollection(site as never)
        return () => null
      },
    }),
  )
  if (!state) throw new Error('not set up')
  return state
}

describe('useSiteCollection', () => {
  beforeEach(async () => {
    fakeBrowser.reset()
    await fakeBrowser.storage.local.set({
      [collectionKey(A)]: addAnnotation(emptyCollection(A), elementInput('a1', `${A}/`), 'T'),
      [collectionKey(B)]: addAnnotation(emptyCollection(B), elementInput('b1', `${B}/`), 'T'),
    })
  })

  it('reads the collection of the site, and says while it reads', async () => {
    const site = ref<string | null>(A)
    const { collection, loading } = mountWith(site)
    expect(loading.value).toBe(true)
    await flushPromises()
    expect(loading.value).toBe(false)
    expect(collection.value?.items.map((i) => i.id)).toEqual(['a1'])
  })

  it("never holds the last site's collection while the next one loads", async () => {
    const site = ref<string | null>(A)
    const { collection, loading } = mountWith(site)
    await flushPromises()
    site.value = B
    await nextTick()
    expect(collection.value).toBeNull()
    expect(loading.value).toBe(true)
    await flushPromises()
    expect(collection.value?.items.map((i) => i.id)).toEqual(['b1'])
    expect(loading.value).toBe(false)
    site.value = null
    await nextTick()
    expect(collection.value).toBeNull()
    expect(loading.value).toBe(false)
  })

  it('stops loading when the storage cannot be read', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('gone'))
    const { collection, loading } = mountWith(ref<string | null>(A))
    await flushPromises()
    expect(loading.value).toBe(false)
    expect(collection.value).toBeNull()
    vi.restoreAllMocks()
  })
})
