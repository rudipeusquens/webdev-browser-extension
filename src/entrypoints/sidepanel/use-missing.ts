import { onBeforeUnmount, onMounted, type Ref, shallowRef } from 'vue'
import { loadMissing, watchMissing } from '@/lib/background/anchor-status'

/** Items not found when their page was last open, kept current through `storage.onChanged`. */
export function useMissing(): { missing: Ref<ReadonlySet<string>> } {
  const missing = shallowRef<ReadonlySet<string>>(new Set())
  let changed = false
  let stop: (() => void) | undefined
  onMounted(async () => {
    stop = watchMissing((next) => {
      changed = true
      missing.value = next
    })
    const loaded = await loadMissing()
    // A change that arrived while loading is newer than what was loaded.
    if (!changed) missing.value = loaded
  })
  onBeforeUnmount(() => stop?.())
  return { missing }
}
