import { browser, type Browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'
import { clearMissing, createAnchorStore } from '@/lib/background/anchor-status'
import { goTo } from '@/lib/background/go-to'
import { readOrigins } from '@/lib/background/origins'
import { createSites, OVERLAY_SCRIPT } from '@/lib/background/sites'
import { clearBlocked, markBlocked } from '@/lib/background/tab-status'
import { createWriter } from '@/lib/background/writer'
import { loadCollection } from '@/lib/collection/store'
import {
  type BackgroundMessage,
  isBackgroundMessage,
  type OriginReply,
  type Reply,
} from '@/lib/messages'
import { isSiteOrigin, originPattern } from '@/lib/settings'

export default defineBackground(() => {
  const write = createWriter()
  const recordAnchors = createAnchorStore()
  const sites = createSites()

  const inject = (tabId: number) =>
    browser.scripting.executeScript({ target: { tabId }, files: [`/${OVERLAY_SCRIPT}`] })

  browser.action.onClicked.addListener((tab) => {
    // Chrome accepts sidePanel.open() only synchronously inside the user gesture:
    // nothing may be awaited before this call.
    browser.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined)
    const tabId = tab.id
    if (tabId === undefined) return
    inject(tabId)
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

  // Remembered sites follow Chrome's grants, which can change in chrome://extensions, and
  // their registration is written again whenever the extension starts.
  const reconcile = () => sites.reconcile().catch(() => [] as string[])
  browser.permissions.onRemoved.addListener(() => void reconcile())
  browser.runtime.onStartup.addListener(() => void reconcile())
  browser.runtime.onInstalled.addListener(({ reason }) => {
    void reconcile().then(async (origins) => {
      // After an update, the open tabs of remembered sites hold orphaned overlays that
      // removed themselves: they get a fresh one.
      if (reason !== 'update' || origins.length === 0) return
      const tabs = await browser.tabs.query({ url: origins.map(originPattern) })
      for (const { id } of tabs) if (id !== undefined) await inject(id).catch(() => undefined)
    })
  })

  /** Go to: only pages of the collection, only on the web. */
  async function openPage(tabId: number, pageKey: string): Promise<Reply> {
    const { pages } = await loadCollection()
    const page = pages[pageKey]
    const origin = page && new URL(page.url).origin
    if (!page || !origin || !isSiteOrigin(origin)) {
      return { ok: false, error: 'This page cannot be opened from here.' }
    }
    return goTo(tabId, page.url, await sites.isRemembered(origin))
  }

  function answer(
    message: BackgroundMessage,
    sender: Browser.runtime.MessageSender,
  ): Promise<unknown> | unknown {
    switch (message.type) {
      case 'origin:read': {
        const tabId = sender.tab?.id
        const { documentId } = sender
        if (tabId === undefined || sender.frameId !== 0 || !documentId) {
          return { ok: false, error: 'Origins are read for a page.' } satisfies OriginReply
        }
        return readOrigins(tabId, documentId, message.selectors).then(
          (origins) => ({ ok: true, origins }) satisfies OriginReply,
        )
      }
      case 'anchors:report':
        if (!sender.tab) return { ok: false, error: 'Reports come from a page.' } satisfies Reply
        return recordAnchors(message).then(() => ({ ok: true }) satisfies Reply)
      case 'site:remember':
      case 'site:forget':
        if (sender.tab) return { ok: false, error: 'Sites are set in the panel.' } satisfies Reply
        return message.type === 'site:remember'
          ? sites.remember(message.origin)
          : sites.forget(message.origin)
      case 'tab:go':
        if (sender.tab)
          return { ok: false, error: 'Pages are opened from the panel.' } satisfies Reply
        return openPage(message.tabId, message.pageKey)
      case 'annotation:add':
        if (!sender.tab) return { ok: false, error: 'Items are added from a page.' } satisfies Reply
        return write(message)
      case 'collection:clear':
        return write(message).then(async (reply) => {
          if (reply.ok) await clearMissing().catch(() => undefined)
          return reply
        })
      default:
        return write(message)
    }
  }

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Without externally_connectable only our own contexts can reach this listener; the
    // id check keeps it that way if the manifest ever changes.
    if (sender.id !== browser.runtime.id || !isBackgroundMessage(message)) return
    // Chrome 116 ignores promises returned from this listener: answer via sendResponse.
    void Promise.resolve(answer(message, sender)).then(sendResponse, () =>
      sendResponse({ ok: false, error: 'Something went wrong.' } satisfies Reply),
    )
    return true
  })
})
