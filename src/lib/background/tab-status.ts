// Tabs where injecting the overlay failed (chrome://, Web Store, PDF viewer), and tabs where it
// was injected but did not start. Runtime state in `storage.session`: gone with the browser
// session, readable by the panel, never by pages.

import { browser } from 'wxt/browser'

export const BLOCKED_PREFIX = 'blocked:'
export const FAILED_PREFIX = 'failed:'

/** A mark per tab, stored under `prefix` and the tab's id: set, cleared and read. */
function flag(prefix: string) {
  const key = (tabId: number) => `${prefix}${tabId}`
  return {
    async mark(tabId: number): Promise<void> {
      await browser.storage.session.set({ [key(tabId)]: true })
    },
    async clear(tabId: number): Promise<void> {
      await browser.storage.session.remove(key(tabId))
    },
    async is(tabId: number): Promise<boolean> {
      const stored = await browser.storage.session.get(key(tabId))
      return stored[key(tabId)] === true
    },
  }
}

export const { mark: markBlocked, clear: clearBlocked, is: isBlocked } = flag(BLOCKED_PREFIX)
export const { mark: markFailed, clear: clearFailed, is: isFailed } = flag(FAILED_PREFIX)
