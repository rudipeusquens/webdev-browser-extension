// The panel keeps a line to every overlay in its window (spec section 8): when it moves to
// another tab, the overlay it showed drops what the panel highlighted there and keeps its mode;
// when the panel closes, every line goes and each overlay switches to Browse. Lines come from
// three places, so none is missed however quickly the developer switches tabs: the overlay of
// the active tab, overlays that announce themselves, and those running when the panel opens.

import { onBeforeUnmount, onMounted, type Ref, watch } from 'vue'
import { browser, type Browser } from 'wxt/browser'
import { isOverlayStatus, isPanelMessage, type PanelAway } from '@/lib/messages'
import type { TabStatus } from './use-active-tab'

export function useOverlayLines(tabId: Ref<number | undefined>, status: Ref<TabStatus>): void {
  const lines = new Map<number, { overlay: string; port: Browser.runtime.Port }>()
  let shownTab: number | undefined
  let closed = false
  // The panel's own window: overlays of other windows belong to their own panel.
  const ownWindow = browser.windows.getCurrent().then(
    (w) => w?.id,
    () => undefined,
  )

  function lineTo(tab: number, overlay: string) {
    if (closed) return
    const open = lines.get(tab)
    if (open?.overlay === overlay) return
    // A new overlay started on the tab: the old one is gone.
    open?.port.disconnect()
    lines.delete(tab)
    try {
      const port = browser.tabs.connect(tab, { name: 'panel' })
      // The tab navigated or closed.
      port.onDisconnect.addListener(() => {
        if (lines.get(tab)?.port === port) lines.delete(tab)
      })
      lines.set(tab, { overlay, port })
    } catch {
      // The overlay is gone again.
    }
  }

  watch(
    () =>
      status.value.kind === 'active' && tabId.value !== undefined
        ? { tab: tabId.value, overlay: status.value.instance }
        : undefined,
    (next) => {
      if (shownTab !== undefined && shownTab !== next?.tab) {
        try {
          lines.get(shownTab)?.port.postMessage({ type: 'panel:away' } satisfies PanelAway)
        } catch {
          // That overlay is gone already.
        }
      }
      shownTab = next?.tab
      if (next) lineTo(next.tab, next.overlay)
    },
  )

  const onMessage = (message: unknown, sender: Browser.runtime.MessageSender) => {
    const tab = sender.tab
    if (sender.id !== browser.runtime.id || !isPanelMessage(message) || tab?.id === undefined)
      return
    if (sender.frameId !== 0) return
    const id = tab.id
    void ownWindow.then((own) => {
      if (own !== undefined && tab.windowId === own) lineTo(id, message.instance)
    })
  }

  /** Overlays already running in this window when the panel opens. */
  async function findRunning() {
    const own = await ownWindow
    if (own === undefined) return
    const tabs = await browser.tabs.query({ windowId: own }).catch(() => [])
    for (const { id } of tabs) {
      if (id === undefined) continue
      browser.tabs
        .sendMessage(id, { type: 'overlay:status' })
        .then((reply) => {
          if (isOverlayStatus(reply)) lineTo(id, reply.instance)
        })
        .catch(() => undefined)
    }
  }

  onMounted(() => {
    browser.runtime.onMessage.addListener(onMessage)
    void findRunning()
  })
  onBeforeUnmount(() => {
    closed = true
    browser.runtime.onMessage.removeListener(onMessage)
    for (const { port } of lines.values()) port.disconnect()
    lines.clear()
  })
}
