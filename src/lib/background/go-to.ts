// Go to: the panel opens another page of the collection in the active tab. It is the
// extension's own navigation, so the overlay starts on the new page as soon as it has loaded
// (while Chrome's grant for the tab still holds: the same origin), unless the site is
// remembered and loads the overlay by itself.

import { browser } from 'wxt/browser'
import type { Reply } from '../messages'
import { OVERLAY_SCRIPT } from './sites'

/** How long a page may take to load before the overlay is started anyway. */
export const LOAD_TIMEOUT = 30_000

function loaded(tabId: number): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(finish, LOAD_TIMEOUT)
    function listener(id: number, info: { status?: string }) {
      if (id === tabId && info.status === 'complete') finish()
    }
    function finish() {
      clearTimeout(timer)
      browser.tabs.onUpdated.removeListener(listener)
      done()
    }
    browser.tabs.onUpdated.addListener(listener)
  })
}

export async function goTo(tabId: number, url: string, remembered: boolean): Promise<Reply> {
  // Listening before the update starts: a fast page could finish first.
  const ready = loaded(tabId)
  try {
    await browser.tabs.update(tabId, { url })
  } catch {
    return { ok: false, error: 'Could not open the page in this tab.' }
  }
  await ready
  if (!remembered) {
    await browser.scripting
      .executeScript({ target: { tabId }, files: [`/${OVERLAY_SCRIPT}`] })
      .catch(() => undefined)
  }
  return { ok: true }
}
