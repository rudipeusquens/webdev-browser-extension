import { onBeforeUnmount, onMounted, type Ref, shallowRef } from 'vue'
import type { Collection } from '@/lib/collection/model'
import { emptyCollection } from '@/lib/collection/ops'
import { loadCollection, watchCollection } from '@/lib/collection/store'

/** The stored collection, kept current through `storage.onChanged`. */
export function useCollection(): { collection: Ref<Collection> } {
  const collection = shallowRef<Collection>(emptyCollection())
  let changed = false
  let stop: (() => void) | undefined
  onMounted(async () => {
    stop = watchCollection((c) => {
      changed = true
      collection.value = c
    })
    const loaded = await loadCollection()
    // A change that arrived while loading is newer than what was loaded.
    if (!changed) collection.value = loaded
  })
  onBeforeUnmount(() => stop?.())
  return { collection }
}
