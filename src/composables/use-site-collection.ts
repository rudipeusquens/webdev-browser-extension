import { onBeforeUnmount, type Ref, shallowRef, watch } from 'vue'
import type { Collection } from '@/lib/collection/model'
import { loadSite, watchSite } from '@/lib/collection/store'

/**
 * The stored collection of `site`, kept current through `storage.onChanged`; null while there
 * is no site. A new site loads its own collection and stops following the last one.
 */
export function useSiteCollection(site: Ref<string | null>): {
  collection: Ref<Collection | null>
} {
  const collection = shallowRef<Collection | null>(null)
  let stop: (() => void) | undefined

  watch(
    site,
    async (current) => {
      stop?.()
      stop = undefined
      if (!current) {
        collection.value = null
        return
      }
      let changed = false
      stop = watchSite(current, (c) => {
        changed = true
        collection.value = c
      })
      const loaded = await loadSite(current)
      // A change that arrived while loading is newer; a new site may have come meanwhile.
      if (!changed && site.value === current) collection.value = loaded
    },
    { immediate: true },
  )
  onBeforeUnmount(() => stop?.())
  return { collection }
}
