// Code origins, read by the bridge in the page's own world (origin-bridge.ts). The page
// answers, so the answer is checked like any page data, and it gets a deadline.

import { browser } from 'wxt/browser'
import { parseVueOrigin } from '../capture/origin'
import { vueOrigins } from '../capture/origin-bridge'
import type { CodeOrigin } from '../collection/model'
import { within } from '../within'

/** A page that blocks its main thread or never answers does not hold up the comment. */
export const ORIGIN_TIMEOUT = 1500

export async function readOrigins(
  tabId: number,
  documentId: string,
  selectors: string[],
): Promise<(CodeOrigin | null)[]> {
  const none = selectors.map(() => null)
  try {
    const results = await within(
      browser.scripting.executeScript({
        // Only the document that asked: a navigation meanwhile must not answer for it.
        target: { tabId, documentIds: [documentId] },
        world: 'MAIN',
        func: vueOrigins,
        args: [selectors],
      }),
      ORIGIN_TIMEOUT,
    )
    const raw: unknown = results?.[0]?.result
    if (!Array.isArray(raw) || raw.length !== selectors.length) return none
    return raw.map((origin) => parseVueOrigin(origin) ?? null)
  } catch {
    return none
  }
}
