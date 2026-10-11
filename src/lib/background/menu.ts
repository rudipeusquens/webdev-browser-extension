// The page's context menu entry (spec section 8): present while its option is on; it starts the
// extension like the toolbar icon.

import { browser } from 'wxt/browser'
import { loadSettings } from '../settings'
import { serial } from './serial'

/** The page's context menu entry: it activates the extension like the toolbar icon. */
export const MENU_ENTRY = 'annotate'

/**
 * The entry exists while its option is on (off by default). Chrome keeps entries across
 * restarts and updates; written again, it is never doubled, and one an older version left
 * goes.
 */
function setMenuEntry(on: boolean): Promise<void> {
  return new Promise((done) => {
    // Read, so Chrome does not log an unchecked error.
    const checked = () => {
      void browser.runtime.lastError
      done()
    }
    try {
      // Callbacks: contextMenus returns promises only from Chrome 123 on.
      browser.contextMenus.removeAll(() => {
        if (!on) return checked()
        void browser.runtime.lastError
        browser.contextMenus.create(
          {
            id: MENU_ENTRY,
            title: 'Annotate this page',
            contexts: ['page', 'frame', 'selection', 'link', 'editable', 'image', 'video', 'audio'],
            documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*'],
          },
          checked,
        )
      })
    } catch {
      // No entry then; the icon and the shortcut still work.
      done()
    }
  })
}

/**
 * The sync of the entry with its option, never rejecting. One update at a time, each with the
 * option as stored when it runs: turned on and off at once, the entry ends as the option does.
 */
export function createMenuSync() {
  const menuInOrder = serial()
  return () =>
    menuInOrder(async () => {
      const { contextMenu } = await loadSettings()
      await setMenuEntry(contextMenu)
    }).catch(() => undefined)
}
