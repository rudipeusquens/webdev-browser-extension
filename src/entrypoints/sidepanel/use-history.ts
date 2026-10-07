import { onBeforeUnmount, type Ref, ref, watch } from 'vue'
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
      let changed = false
      stop = watchLabels(current, (next) => {
        changed = true
        labels.value = next
      })
      const loaded = await loadLabels(current)
      if (!changed && site.value === current) labels.value = loaded
    },
    { immediate: true },
  )
  onBeforeUnmount(() => stop?.())
  return { labels }
}
