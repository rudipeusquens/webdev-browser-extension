// Tabs where injecting the overlay failed (chrome://, Web Store, PDF viewer). Runtime state in
// `storage.session`: gone with the browser session, readable by the panel, never by pages.

import { browser } from 'wxt/browser'

export const BLOCKED_PREFIX = 'blocked:'
const key = (tabId: number) => `${BLOCKED_PREFIX}${tabId}`

export async function markBlocked(tabId: number): Promise<void> {
  await browser.storage.session.set({ [key(tabId)]: true })
}

export async function clearBlocked(tabId: number): Promise<void> {
  await browser.storage.session.remove(key(tabId))
}

export async function isBlocked(tabId: number): Promise<boolean> {
  const stored = await browser.storage.session.get(key(tabId))
  return stored[key(tabId)] === true
}
