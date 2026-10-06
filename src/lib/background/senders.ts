// Who sent a message (spec section 11): the panel, or the overlay in the top frame of a tab,
// which counts for the site of its own page only.

import { browser, type Browser } from 'wxt/browser'
import { siteOf } from '../collection/site'

/** The side panel of this extension: no tab, our id, the panel's own URL. */
export function isPanelSender(sender: Browser.runtime.MessageSender): boolean {
  return (
    !sender.tab &&
    sender.id === browser.runtime.id &&
    sender.url === browser.runtime.getURL('/sidepanel.html')
  )
}

/** The site of the page whose top frame sent the message; null for anything else. */
export function pageSite(sender: Browser.runtime.MessageSender): string | null {
  if (!sender.tab || sender.frameId !== 0 || !sender.url) return null
  try {
    return siteOf(sender.url)
  } catch {
    return null
  }
}
