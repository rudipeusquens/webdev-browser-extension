import { onBeforeUnmount, onMounted, type Ref, shallowRef } from 'vue'
import { keepNewest } from '@/composables/use-stored'
import { defaultSettings, loadSettings, type Settings, watchSettings } from '@/lib/settings'

/** The stored settings, kept current through `storage.onChanged`. */
export function useSettings(): { settings: Ref<Settings> } {
  const settings = shallowRef<Settings>(defaultSettings())
  const newestSettings = keepNewest((next: Settings) => (settings.value = next))
  let stop: (() => void) | undefined
  onMounted(async () => {
    stop = watchSettings(newestSettings.changed)
    newestSettings.loaded(await loadSettings())
  })
  onBeforeUnmount(() => stop?.())
  return { settings }
}
