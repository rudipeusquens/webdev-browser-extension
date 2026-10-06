import { browser, type Browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'
import { clearMissing, createAnchorStore } from '@/lib/background/anchor-status'
import { goTo } from '@/lib/background/go-to'
import { readOrigins } from '@/lib/background/origins'
import { createSites, OVERLAY_SCRIPT } from '@/lib/background/sites'
import { clearBlocked, clearFailed, markBlocked, markFailed } from '@/lib/background/tab-status'
import { createVoice } from '@/lib/background/voice'
import { isPanelSender, setVoice } from '@/lib/background/voice-settings'
import { createWriter } from '@/lib/background/writer'
import { loadCollection } from '@/lib/collection/store'
import {
  type BackgroundMessage,
  isBackgroundMessage,
  isPanelToggleReply,
  type OriginReply,
  PANEL_VIEW_KEY,
  type PanelToggle,
  type PanelView,
  type Reply,
} from '@/lib/messages'
import { isSiteOrigin, originPattern } from '@/lib/settings'

/** The page's context menu entry: it activates the extension like the toolbar icon. */
const MENU_ENTRY = 'annotate'

export default defineBackground(() => {
  const write = createWriter()
  const recordAnchors = createAnchorStore()
  const sites = createSites()
  const voice = createVoice()

  const inject = (tabId: number) =>
    browser.scripting.executeScript({ target: { tabId }, files: [`/${OVERLAY_SCRIPT}`] })

  /**
   * The icon, its shortcut and the page's context menu entry open the panel; each grants
   * `activeTab`. Chrome accepts sidePanel.open() only synchronously inside the user gesture:
   * nothing may be awaited before this call. The tab, if there is one to start the overlay on.
   */
  function openPanel(tab: Browser.tabs.Tab): number | undefined {
    browser.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined)
    // -1: a frame outside any tab, such as one in another extension's panel.
    return tab.id !== undefined && tab.id >= 0 ? tab.id : undefined
  }

  function start(tabId: number) {
    void clearFailed(tabId).catch(() => undefined)
    inject(tabId)
      // Restricted pages (chrome://, Web Store) refuse injection; the panel says so.
      .then(
        () => clearBlocked(tabId),
        () => markBlocked(tabId),
      )
      .catch(() => undefined)
  }

  /** The context menu entry only ever opens the panel and starts the overlay. */
  function activate(tab: Browser.tabs.Tab) {
    const tabId = openPanel(tab)
    if (tabId !== undefined) start(tabId)
  }

  /**
   * The icon and its shortcut toggle the panel: an open panel whose page is active on this tab
   * closes itself and says so (spec section 8); otherwise the overlay starts.
   */
  function toggle(tab: Browser.tabs.Tab) {
    const tabId = openPanel(tab)
    if (tabId === undefined) return
    const ask: PanelToggle = { type: 'panel:toggle', windowId: tab.windowId, tabId }
    browser.runtime
      .sendMessage(ask)
      // No panel answers when none is open.
      .then(
        (reply) => isPanelToggleReply(reply) && reply.closing,
        () => false,
      )
      .then((closing) => {
        if (!closing) start(tabId)
      })
      .catch(() => undefined)
  }

  browser.action.onClicked.addListener(toggle)
  browser.runtime.onConnect.addListener(voice.onConnect)
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ENTRY && tab) activate(tab)
  })

  /** Chrome keeps the entry across restarts and updates; written again, it is never doubled. */
  function addMenuEntry() {
    // Read, so Chrome does not log an unchecked error.
    const checked = () => browser.runtime.lastError
    try {
      // Callbacks: contextMenus returns promises only from Chrome 123 on.
      browser.contextMenus.removeAll(() => {
        checked()
        browser.contextMenus.create(
          {
            id: MENU_ENTRY,
            title: 'Annotate this page',
            contexts: ['page', 'frame', 'selection', 'link', 'editable', 'image', 'video', 'audio'],
            documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*'],
          },
          checked,
        )
      })
    } catch {
      // No entry then; the icon and the shortcut still work.
    }
  }

  browser.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== 'loading') return
    void clearBlocked(tabId).catch(() => undefined)
    void clearFailed(tabId).catch(() => undefined)
  })
  browser.tabs.onRemoved.addListener((tabId) => {
    void clearBlocked(tabId).catch(() => undefined)
    void clearFailed(tabId).catch(() => undefined)
  })

  // Remembered sites follow Chrome's grants, which can change in chrome://extensions, and
  // their registration is written again whenever the extension starts.
  const reconcile = () => sites.reconcile().catch(() => [] as string[])
  browser.permissions.onRemoved.addListener(() => void reconcile())
  browser.runtime.onStartup.addListener(() => {
    void reconcile()
    addMenuEntry()
  })
  browser.runtime.onInstalled.addListener(({ reason }) => {
    void reconcile().then(async (origins) => {
      // After an update, the open tabs of remembered sites hold orphaned overlays that
      // removed themselves: they get a fresh one.
      if (reason !== 'update' || origins.length === 0) return
      const tabs = await browser.tabs.query({ url: origins.map(originPattern) })
      for (const { id } of tabs) if (id !== undefined) await inject(id).catch(() => undefined)
    })
    addMenuEntry()
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
      case 'overlay:failed': {
        // The overlay runs in the top frame of a tab only.
        const tabId = sender.tab?.id
        if (tabId === undefined || sender.frameId !== 0) {
          return { ok: false, error: 'Only an overlay reports its start.' } satisfies Reply
        }
        return markFailed(tabId).then(() => ({ ok: true }) satisfies Reply)
      }
      case 'voice:set':
      case 'voice:key:save':
      case 'voice:key:remove':
      case 'voice:key:test':
        if (!isPanelSender(sender)) {
          return { ok: false, error: 'Voice is set up in the panel.' } satisfies Reply
        }
        return setVoice(message)
      case 'voice:grant':
      case 'voice:settings': {
        const { tab } = sender
        if (tab?.id === undefined || sender.frameId !== 0) {
          return { ok: false, error: 'Only a comment popover asks for this.' } satisfies Reply
        }
        if (message.type === 'voice:grant') {
          return browser.tabs
            .create({
              url: browser.runtime.getURL('/mic-permission.html'),
              windowId: tab.windowId,
              index: tab.index + 1,
              openerTabId: tab.id,
            })
            .then(() => ({ ok: true }) satisfies Reply)
        }
        // Inside the click's gesture: nothing may be awaited before this call.
        browser.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined)
        const view: PanelView = { windowId: tab.windowId, view: 'settings', at: Date.now() }
        return browser.storage.session
          .set({ [PANEL_VIEW_KEY]: view })
          .then(() => ({ ok: true }) satisfies Reply)
      }
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
