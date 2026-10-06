// The toolbar icon and its shortcut close an open panel whose page is active on the tab they
// were used on: the background asks, the panel answers and closes itself (spec section 8).

import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { browser, type Browser } from 'wxt/browser'
import { isOverlayStatus, isPanelToggle, type PanelToggleReply } from '@/lib/messages'

/** Whether an overlay answers on `tabId` now. */
const activeOn = (tabId: number): Promise<boolean> =>
  browser.tabs.sendMessage(tabId, { type: 'overlay:status' }).then(isOverlayStatus, () => false)

export function usePanelToggle(windowId: Ref<number | undefined>): void {
  const onMessage = (
    message: unknown,
    sender: Browser.runtime.MessageSender,
    sendResponse: (reply: PanelToggleReply) => void,
  ) => {
    // Only the background asks: it has no tab.
    if (sender.id !== browser.runtime.id || sender.tab || !isPanelToggle(message)) return
    // Other windows have panels of their own.
    if (windowId.value === undefined || message.windowId !== windowId.value) return
    // Asked again, not taken from the panel's status: the tab may have just navigated.
    void activeOn(message.tabId).then((closing) => {
      sendResponse({ closing })
      // After the answer has gone out.
      if (closing) setTimeout(() => window.close(), 0)
    })
    return true
  }

  onMounted(() => browser.runtime.onMessage.addListener(onMessage))
  onBeforeUnmount(() => browser.runtime.onMessage.removeListener(onMessage))
}
