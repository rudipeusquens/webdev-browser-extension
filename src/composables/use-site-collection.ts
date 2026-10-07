import { onBeforeUnmount, type Ref, ref, shallowRef, watch } from 'vue'
import type { Collection } from '@/lib/collection/model'
import { loadSite, watchSite } from '@/lib/collection/store'

/**
 * The stored collection of `site`, kept current through `storage.onChanged`; null while there
 * is no site and while a new site's collection is read (`loading`), never the last site's. A
 * new site stops following the last one.
 */
export function useSiteCollection(site: Ref<string | null>): {
  collection: Ref<Collection | null>
  loading: Ref<boolean>
} {
  const collection = shallowRef<Collection | null>(null)
  const loading = ref(false)
  let stop: (() => void) | undefined

  watch(
    site,
    async (current) => {
      stop?.()
      stop = undefined
      collection.value = null
      loading.value = !!current
      if (!current) return
      let changed = false
      stop = watchSite(current, (c) => {
        changed = true
        loading.value = false
        collection.value = c
      })
      // Unreadable: the panel shows the site as empty rather than nothing at all.
      const loaded = await loadSite(current).catch(() => null)
      // A change that arrived while loading is newer; a new site may have come meanwhile.
      if (site.value !== current) return
      if (!changed) collection.value = loaded
      loading.value = false
    },
    { immediate: true },
  )
  onBeforeUnmount(() => stop?.())
  return { collection, loading }
}
