// The background's questions to the overlay of a tab: whether one runs there, and whether its
// page may be left. Only this extension's content scripts receive them; an overlay that does
// not answer in time counts as none.

import { browser } from 'wxt/browser'
import { isObject } from '../collection/validate'
import { isOverlayStatus, type OverlayMessage } from '../messages'

/** How long the overlay may take to answer: it answers at once, unless the page is busy. */
export const ASK_WAIT = 1000

async function ask(tabId: number, message: OverlayMessage): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>((done) => {
    timer = setTimeout(() => done(undefined), ASK_WAIT)
  })
  try {
    return await Promise.race([browser.tabs.sendMessage(tabId, message, { frameId: 0 }), late])
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** Whether an overlay of this extension runs on the tab: it is not started a second time. */
export async function overlayRuns(tabId: number): Promise<boolean> {
  return isOverlayStatus(await ask(tabId, { type: 'overlay:status' }))
}

/** Whether the tab's overlay lets its page go: not while its popover holds unsaved text. */
export async function overlayLetsGo(tabId: number): Promise<boolean> {
  const reply = await ask(tabId, { type: 'overlay:leave' })
  return !(isObject(reply) && reply.ok === false)
}
