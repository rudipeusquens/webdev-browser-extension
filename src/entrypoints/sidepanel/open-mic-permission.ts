// Only a page in a tab can show Chrome's microphone prompt, not the side panel (spec section 5).

import { browser } from 'wxt/browser'

/** Opens the extension's page that asks for the microphone, in a new tab. */
export function openMicPermission(): void {
  void browser.tabs.create({ url: browser.runtime.getURL('/mic-permission.html') })
}
