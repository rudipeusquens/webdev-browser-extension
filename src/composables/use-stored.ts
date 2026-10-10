// Stored values in the UI, watched from before they are loaded so that no change is missed: a
// change that arrives while loading is newer than what was loaded.

import { onScopeDispose, type Ref, ref, shallowRef, watch } from 'vue'
import { loadStored, watchStored } from '@/lib/storage'

/**
 * The newest of a watched value: `apply` gets every change, and what was loaded unless a change
 * came first. A value chosen here (`changed`) counts as a change.
 */
export function keepNewest<T>(apply: (value: T) => void): {
  changed: (value: T) => void
  loaded: (value: T) => void
} {
  let changed = false
  return {
    changed: (value) => {
      changed = true
      apply(value)
    },
    loaded: (value) => {
      if (!changed) apply(value)
    },
  }
}

/**
 * A key of `storage.local` as a ref: read, then kept up to date. The key may change (the
 * site's dictations follow the active site); `null` stands for none. `loaded` is false until
 * the key was read: what depends on it can wait.
 */
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
      const set = keepNewest((next: T) => (value.value = next))
      stop = watchStored(now, parse, (next) => {
        set.changed(next)
        loaded.value = true
      })
      void loadStored(now, parse).then((read) => {
        if (key.value !== now) return
        set.loaded(read)
        loaded.value = true
      })
    },
    { immediate: true },
  )
  onScopeDispose(() => stop?.())
  return { value, loaded }
}
