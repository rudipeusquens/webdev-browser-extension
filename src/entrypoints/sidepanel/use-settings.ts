import { onBeforeUnmount, onMounted, type Ref, shallowRef } from 'vue'
import { defaultSettings, loadSettings, type Settings, watchSettings } from '@/lib/settings'

/** The stored settings, kept current through `storage.onChanged`. */
export function useSettings(): { settings: Ref<Settings> } {
  const settings = shallowRef<Settings>(defaultSettings())
  let changed = false
  let stop: (() => void) | undefined
  onMounted(async () => {
    stop = watchSettings((next) => {
      changed = true
      settings.value = next
    })
    const loaded = await loadSettings()
    // A change that arrived while loading is newer than what was loaded.
    if (!changed) settings.value = loaded
  })
  onBeforeUnmount(() => stop?.())
  return { settings }
}
