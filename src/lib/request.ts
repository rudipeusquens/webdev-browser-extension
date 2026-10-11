// A message from the panel or an overlay to the background, which answers with a `Reply`.

import { browser } from 'wxt/browser'
import type { BackgroundMessage, Reply } from './messages'

/** What the panel says when the background did not answer. */
export const NO_ANSWER = 'The extension did not answer. Try again.'

/**
 * The background's reply to `message`; undefined when there is none. `sendMessage` throws at
 * once in an overlay whose extension was reloaded, so it is awaited inside the `try`.
 */
export async function request(message: BackgroundMessage): Promise<Reply | undefined> {
  try {
    return (await browser.runtime.sendMessage(message)) as Reply | undefined
  } catch {
    return undefined
  }
}
