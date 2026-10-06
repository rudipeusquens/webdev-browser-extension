import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'
import { clearBlocked, markBlocked } from '@/lib/background/tab-status'
import { createWriter } from '@/lib/background/writer'
import { clearMissing, createAnchorStore } from '@/lib/background/anchor-status'
import { readOrigins } from '@/lib/background/origins'
import { isBackgroundMessage, type OriginReply, type Reply } from '@/lib/messages'

export default defineBackground(() => {
  const write = createWriter()
  const recordAnchors = createAnchorStore()

  browser.action.onClicked.addListener((tab) => {
    // Chrome accepts sidePanel.open() only synchronously inside the user gesture:
    // nothing may be awaited before this call.
    browser.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined)
    const tabId = tab.id
    if (tabId === undefined) return
    browser.scripting
      .executeScript({ target: { tabId }, files: ['/content-scripts/overlay.js'] })
      // Restricted pages (chrome://, Web Store) refuse injection; the panel says so.
      .then(
        () => clearBlocked(tabId),
        () => markBlocked(tabId),
      )
      .catch(() => undefined)
  })

  browser.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading') void clearBlocked(tabId).catch(() => undefined)
  })
  browser.tabs.onRemoved.addListener((tabId) => {
    void clearBlocked(tabId).catch(() => undefined)
  })

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Without externally_connectable only our own contexts can reach this listener; the
    // id check keeps it that way if the manifest ever changes.
    if (sender.id !== browser.runtime.id || !isBackgroundMessage(message)) return
    if (message.type === 'origin:read') {
      const tabId = sender.tab?.id
      const { documentId } = sender
      if (tabId === undefined || sender.frameId !== 0 || !documentId) {
        sendResponse({ ok: false, error: 'Origins are read for a page.' } satisfies OriginReply)
        return
      }
      void readOrigins(tabId, documentId, message.selectors).then((origins) =>
        sendResponse({ ok: true, origins } satisfies OriginReply),
      )
      return true
    }
    if (message.type === 'anchors:report') {
      if (!sender.tab) {
        sendResponse({ ok: false, error: 'Reports come from a page.' } satisfies Reply)
        return
      }
      void recordAnchors(message).then(
        () => sendResponse({ ok: true } satisfies Reply),
        () => sendResponse({ ok: false, error: 'Could not record.' } satisfies Reply),
      )
      return true
    }
    if (message.type === 'annotation:add' && !sender.tab) {
      sendResponse({ ok: false, error: 'Items are added from a page.' } satisfies Reply)
      return
    }
    // Chrome 116 ignores promises returned from this listener: answer via sendResponse.
    void write(message).then(async (reply) => {
      if (reply.ok && message.type === 'collection:clear') await clearMissing().catch(() => {})
      sendResponse(reply)
    })
    return true
  })
})
