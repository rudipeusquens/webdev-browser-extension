import { onBeforeUnmount, onMounted, type Ref, shallowRef } from 'vue'
import { keepNewest } from '@/composables/use-stored'
import { loadMissing, watchMissing } from '@/lib/background/anchor-status'

/** Items not found when their page was last open, kept current through `storage.onChanged`. */
export function useMissing(): { missing: Ref<ReadonlySet<string>> } {
  const missing = shallowRef<ReadonlySet<string>>(new Set())
  const newestMissing = keepNewest((next: ReadonlySet<string>) => (missing.value = next))
  let stop: (() => void) | undefined
  onMounted(async () => {
    stop = watchMissing(newestMissing.changed)
    newestMissing.loaded(await loadMissing())
  })
  onBeforeUnmount(() => stop?.())
  return { missing }
}
