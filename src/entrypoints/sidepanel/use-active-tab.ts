// What the overlay on the active tab is doing, asked directly; the background only records
// tabs that refused the overlay.

import { onBeforeUnmount, onMounted, type Ref, ref } from 'vue'
import { browser } from 'wxt/browser'
import { BLOCKED_PREFIX, FAILED_PREFIX, isBlocked, isFailed } from '@/lib/background/tab-status'
import { siteOf } from '@/lib/collection/site'
import { isOverlayStatus, isPanelMessage, type Mode } from '@/lib/messages'

/**
 * `url`: the tab's address, where Chrome tells it to the panel (the extension may run there
 * already); missing elsewhere.
 */
export type TabStatus =
  | { kind: 'active'; host: string; pageKey: string; mode: Mode; pins: boolean; instance: string }
  | { kind: 'blocked'; url?: string }
  | { kind: 'failed'; url?: string }
  | { kind: 'idle'; url?: string }

function sameSite(url: string, pageKey: string): boolean {
  try {
    return siteOf(url) === siteOf(pageKey)
  } catch {
    return false
  }
}

export function useActiveTab(): {
  tabId: Ref<number | undefined>
  /** The window of the active tab: the panel's own. */
  windowId: Ref<number | undefined>
  status: Ref<TabStatus>
  refresh: () => Promise<void>
} {
  const tabId = ref<number>()
  const windowId = ref<number>()
  const status = ref<TabStatus>({ kind: 'idle' })
  let latest = 0

  async function refresh() {
    const run = ++latest
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    const id = tab?.id
    const url = tab?.url || undefined
    let next: TabStatus = { kind: 'idle', url }
    if (id !== undefined) {
      const reply = await browser.tabs
        .sendMessage(id, { type: 'overlay:status' }, { frameId: 0 })
        .catch(() => {})
      // Where Chrome tells the tab's address, an overlay that names another site is not this
      // tab's (it is going away, or it lies): the panel shows and acts on the tab's site only.
      const ours = isOverlayStatus(reply) && (!url || sameSite(url, reply.pageKey))
      if (ours) next = { kind: 'active', ...reply }
      else if (await isBlocked(id)) next = { kind: 'blocked', url }
      else if (await isFailed(id)) next = { kind: 'failed', url }
    }
    // An older refresh must not overwrite a newer one.
    if (run !== latest) return
    tabId.value = id
    windowId.value = tab?.windowId
    status.value = next
  }

  const onActivated = () => void refresh()
  const onUpdated = (id: number, info: { status?: string }) => {
    if (id === tabId.value && info.status) void refresh()
  }
  const onMessage = (message: unknown, sender: { id?: string; tab?: { id?: number } }) => {
    if (sender.id === browser.runtime.id && isPanelMessage(message)) void refresh()
  }
  const onStorage = (changes: Record<string, unknown>, area: string) => {
    const status = (k: string) => k.startsWith(BLOCKED_PREFIX) || k.startsWith(FAILED_PREFIX)
    if (area === 'session' && Object.keys(changes).some(status)) void refresh()
  }

  onMounted(() => {
    browser.tabs.onActivated.addListener(onActivated)
    browser.tabs.onUpdated.addListener(onUpdated)
    browser.runtime.onMessage.addListener(onMessage)
    browser.storage.onChanged.addListener(onStorage)
    void refresh()
  })
  onBeforeUnmount(() => {
    browser.tabs.onActivated.removeListener(onActivated)
    browser.tabs.onUpdated.removeListener(onUpdated)
    browser.runtime.onMessage.removeListener(onMessage)
    browser.storage.onChanged.removeListener(onStorage)
  })

  return { tabId, windowId, status, refresh }
}
