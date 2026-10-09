// A key of `storage.local` as a ref: read, then kept up to date. The key may change (the
// site's dictations follow the active site); `null` stands for none.

import { onScopeDispose, type Ref, shallowRef, watch } from 'vue'
import { loadStored, watchStored } from '@/lib/storage'

export function useStored<T>(key: Ref<string | null>, parse: (value: unknown) => T): Ref<T> {
  const value = shallowRef<T>(parse(undefined))
  let stop: (() => void) | undefined
  watch(
    key,
    (now) => {
      stop?.()
      stop = undefined
      value.value = parse(undefined)
      if (!now) return
      let changed = false
      stop = watchStored(now, parse, (next) => {
        changed = true
        value.value = next
      })
      void loadStored(now, parse).then((read) => {
        if (!changed && key.value === now) value.value = read
      })
    },
    { immediate: true },
  )
  onScopeDispose(() => stop?.())
  return value
}
