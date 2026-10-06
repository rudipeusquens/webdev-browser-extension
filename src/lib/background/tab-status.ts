// Tabs where injecting the overlay failed (chrome://, Web Store, PDF viewer), and tabs where it
// was injected but did not start. Runtime state in `storage.session`: gone with the browser
// session, readable by the panel, never by pages.

import { browser } from 'wxt/browser'

export const BLOCKED_PREFIX = 'blocked:'
export const FAILED_PREFIX = 'failed:'
const key = (tabId: number) => `${BLOCKED_PREFIX}${tabId}`
const failedKey = (tabId: number) => `${FAILED_PREFIX}${tabId}`

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

export async function markFailed(tabId: number): Promise<void> {
  await browser.storage.session.set({ [failedKey(tabId)]: true })
}

export async function clearFailed(tabId: number): Promise<void> {
  await browser.storage.session.remove(failedKey(tabId))
}

export async function isFailed(tabId: number): Promise<boolean> {
  const stored = await browser.storage.session.get(failedKey(tabId))
  return stored[failedKey(tabId)] === true
}
