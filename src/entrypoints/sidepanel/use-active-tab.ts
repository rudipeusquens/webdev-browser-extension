// What the overlay on the active tab is doing, asked directly; the background only records
// tabs that refused the overlay.

import { onBeforeUnmount, onMounted, type Ref, ref } from 'vue'
import { browser } from 'wxt/browser'
import { BLOCKED_PREFIX, isBlocked } from '@/lib/background/tab-status'
import { isOverlayStatus, isPanelMessage, type Mode } from '@/lib/messages'

export type TabStatus =
  | { kind: 'active'; host: string; pageKey: string; mode: Mode }
  | { kind: 'blocked' }
  | { kind: 'idle' }

export function useActiveTab(): {
  tabId: Ref<number | undefined>
  status: Ref<TabStatus>
  refresh: () => Promise<void>
} {
  const tabId = ref<number>()
  const status = ref<TabStatus>({ kind: 'idle' })
  let latest = 0

  async function refresh() {
    const run = ++latest
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    const id = tab?.id
    let next: TabStatus = { kind: 'idle' }
    if (id !== undefined) {
      const reply = await browser.tabs.sendMessage(id, { type: 'overlay:status' }).catch(() => {})
      if (isOverlayStatus(reply)) next = { kind: 'active', ...reply }
      else if (await isBlocked(id)) next = { kind: 'blocked' }
    }
    // An older refresh must not overwrite a newer one.
    if (run !== latest) return
    tabId.value = id
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
    if (area === 'session' && Object.keys(changes).some((k) => k.startsWith(BLOCKED_PREFIX)))
      void refresh()
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

  return { tabId, status, refresh }
}
