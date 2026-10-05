import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'

export default defineBackground(() => {
  browser.action.onClicked.addListener((tab) => {
    // Chrome accepts sidePanel.open() only synchronously inside the user gesture:
    // nothing may be awaited before this call.
    void browser.sidePanel.open({ windowId: tab.windowId })
    if (tab.id === undefined) return
    browser.scripting
      .executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/overlay.js'] })
      // Restricted pages (chrome://, Web Store) refuse injection; milestone 2 reports it in the panel.
      .catch(() => undefined)
  })
})
