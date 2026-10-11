import { onBeforeUnmount, onMounted, type Ref, ref } from 'vue'
import { browser } from 'wxt/browser'
import { keepNewest } from '@/composables/use-stored'
import type { BackgroundMessage } from '@/lib/messages'
import { type Filter, loadView, watchView } from '@/lib/view'

/**
 * The filter of the list and the pins, kept current through `storage.onChanged`. Choosing one
 * shows it at once and asks the background to keep it.
 */
export function useView(): { filter: Ref<Filter>; choose: (next: Filter) => void } {
  const filter = ref<Filter>('open')
  const newestFilter = keepNewest((next: Filter) => (filter.value = next))
  let stop: (() => void) | undefined

  onMounted(async () => {
    stop = watchView((view) => newestFilter.changed(view.filter))
    newestFilter.loaded((await loadView()).filter)
  })
  onBeforeUnmount(() => stop?.())

  function choose(next: Filter) {
    newestFilter.changed(next)
    const message: BackgroundMessage = { type: 'view:set', filter: next }
    browser.runtime.sendMessage(message).catch(() => undefined)
  }

  return { filter, choose }
}
