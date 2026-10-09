// A key of `storage.local` as a ref: read, then kept up to date. The key may change (the
// site's dictations follow the active site); `null` stands for none. `loaded` is false until
// the key was read: what depends on it can wait.

import { onScopeDispose, type Ref, ref, shallowRef, watch } from 'vue'
import { loadStored, watchStored } from '@/lib/storage'

export function useStored<T>(
  key: Ref<string | null>,
  parse: (value: unknown) => T,
): { value: Ref<T>; loaded: Ref<boolean> } {
  const value = shallowRef<T>(parse(undefined))
  const loaded = ref(false)
  let stop: (() => void) | undefined
  watch(
    key,
    (now) => {
      stop?.()
      stop = undefined
      value.value = parse(undefined)
      loaded.value = !now
      if (!now) return
      let changed = false
      stop = watchStored(now, parse, (next) => {
        changed = true
        value.value = next
        loaded.value = true
      })
      void loadStored(now, parse).then((read) => {
        if (key.value !== now) return
        if (!changed) value.value = read
        loaded.value = true
      })
    },
    { immediate: true },
  )
  onScopeDispose(() => stop?.())
  return { value, loaded }
}
