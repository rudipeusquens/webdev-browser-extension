import { onBeforeUnmount, onMounted, type Ref, ref } from 'vue'
import { browser } from 'wxt/browser'
import type { BackgroundMessage } from '@/lib/messages'
import { type Filter, loadView, watchView } from '@/lib/view'

/**
 * The filter of the list and the pins, kept current through `storage.onChanged`. Choosing one
 * shows it at once and asks the background to keep it.
 */
export function useView(): { filter: Ref<Filter>; choose: (next: Filter) => void } {
  const filter = ref<Filter>('open')
  let changed = false
  let stop: (() => void) | undefined

  onMounted(async () => {
    stop = watchView((view) => {
      changed = true
      filter.value = view.filter
    })
    const loaded = await loadView()
    // A change that arrived while loading is newer than what was loaded.
    if (!changed) filter.value = loaded.filter
  })
  onBeforeUnmount(() => stop?.())

  function choose(next: Filter) {
    changed = true
    filter.value = next
    const message: BackgroundMessage = { type: 'view:set', filter: next }
    browser.runtime.sendMessage(message).catch(() => undefined)
  }

  return { filter, choose }
}
