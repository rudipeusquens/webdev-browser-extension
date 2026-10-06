// Code origins, read by the bridge in the page's own world (origin-bridge.ts). The page
// answers, so the answer is checked like any page data, and it gets a deadline.

import { browser } from 'wxt/browser'
import { parseVueOrigin } from '../capture/origin'
import { vueOrigins } from '../capture/origin-bridge'
import type { CodeOrigin } from '../collection/model'

/** A page that blocks its main thread or never answers does not hold up the comment. */
export const ORIGIN_TIMEOUT = 1500

export async function readOrigins(
  tabId: number,
  documentId: string,
  selectors: string[],
): Promise<(CodeOrigin | null)[]> {
  const none = selectors.map(() => null)
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>((done) => {
    timer = setTimeout(() => done(undefined), ORIGIN_TIMEOUT)
  })
  try {
    const results = await Promise.race([
      browser.scripting.executeScript({
        // Only the document that asked: a navigation meanwhile must not answer for it.
        target: { tabId, documentIds: [documentId] },
        world: 'MAIN',
        func: vueOrigins,
        args: [selectors],
      }),
      late,
    ])
    const raw: unknown = results?.[0]?.result
    if (!Array.isArray(raw) || raw.length !== selectors.length) return none
    return raw.map((origin) => parseVueOrigin(origin) ?? null)
  } catch {
    return none
  } finally {
    clearTimeout(timer)
  }
}
