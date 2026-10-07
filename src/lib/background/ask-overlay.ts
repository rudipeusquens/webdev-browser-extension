// The background's questions to the overlay of a tab: whether one runs there, and whether its
// page may be left. Only this extension's content scripts receive them. An overlay that is
// not there (none, or orphaned by an update) refuses the message at once; one that does not
// answer in time is there but busy, so the question fails closed: nothing is injected over it
// and its page is not left.

import { browser } from 'wxt/browser'
import { isObject } from '../collection/validate'
import { isOverlayStatus, type OverlayMessage } from '../messages'

/** How long an overlay may take to answer: it answers at once, unless its page is busy. */
export const ASK_WAIT = 10_000

const NONE = Symbol('no overlay')
const LATE = Symbol('no answer in time')

async function ask(tabId: number, message: OverlayMessage): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<typeof LATE>((done) => {
    timer = setTimeout(() => done(LATE), ASK_WAIT)
  })
  try {
    return await Promise.race([browser.tabs.sendMessage(tabId, message, { frameId: 0 }), late])
  } catch {
    return NONE
  } finally {
    clearTimeout(timer)
  }
}

/** Whether an overlay of this extension may run on the tab: it is not started a second time. */
export async function overlayRuns(tabId: number): Promise<boolean> {
  const reply = await ask(tabId, { type: 'overlay:status' })
  return reply === LATE || isOverlayStatus(reply)
}

/**
 * Whether the tab's overlay lets its page go: 'unsaved' while its popover holds unsaved text,
 * 'busy' when it does not answer in time.
 */
export async function overlayLetsGo(tabId: number): Promise<'go' | 'unsaved' | 'busy'> {
  const reply = await ask(tabId, { type: 'overlay:leave' })
  if (reply === LATE) return 'busy'
  return isObject(reply) && reply.ok === false ? 'unsaved' : 'go'
}
