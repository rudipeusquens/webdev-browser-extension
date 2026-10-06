// "Open settings" in a comment popover (spec section 8): the background opens the panel and
// leaves a `panelView` entry in `storage.session`; the panel of that window opens its
// settings, also when it opens only now, and removes the entry.

import { onBeforeUnmount, onMounted, type Ref, watch } from 'vue'
import { browser } from 'wxt/browser'
import { isPanelView, PANEL_VIEW_KEY } from '@/lib/messages'

/** Older entries are leftovers: the panel was closed meanwhile. */
const FRESH = 10_000

export function usePanelView(windowId: Ref<number | undefined>, openSettings: () => void) {
  async function check(entry?: unknown) {
    const view =
      entry !== undefined
        ? entry
        : (await browser.storage.session.get(PANEL_VIEW_KEY))[PANEL_VIEW_KEY]
    if (!isPanelView(view) || windowId.value === undefined || view.windowId !== windowId.value) {
      return
    }
    if (Date.now() - view.at > FRESH) return
    await browser.storage.session.remove(PANEL_VIEW_KEY)
    openSettings()
  }

  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const change = changes[PANEL_VIEW_KEY]
    if (area === 'session' && change?.newValue !== undefined) void check(change.newValue)
  }

  onMounted(() => browser.storage.onChanged.addListener(onChanged))
  onBeforeUnmount(() => browser.storage.onChanged.removeListener(onChanged))
  // The window is known once the active tab is.
  watch(windowId, () => void check().catch(() => undefined), { immediate: true })
}
