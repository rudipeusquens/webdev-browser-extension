import { onBeforeUnmount, type Ref, ref, watch } from 'vue'
import { keepNewest } from '@/composables/use-stored'
import { type Labels, loadLabels, watchLabels } from '@/lib/background/history'

/** What Undo and Redo of `site` would do, kept current through `storage.onChanged`. */
export function useHistory(site: Ref<string | null>): { labels: Ref<Labels> } {
  const labels = ref<Labels>({})
  let stop: (() => void) | undefined

  watch(
    site,
    async (current) => {
      stop?.()
      stop = undefined
      labels.value = {}
      if (!current) return
      const setLabels = keepNewest((next: Labels) => (labels.value = next))
      stop = watchLabels(current, setLabels.changed)
      const loaded = await loadLabels(current)
      if (site.value === current) setLabels.loaded(loaded)
    },
    { immediate: true },
  )
  onBeforeUnmount(() => stop?.())
  return { labels }
}
