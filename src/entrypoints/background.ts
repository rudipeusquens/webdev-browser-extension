import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'

export default defineBackground(() => {
  browser.action.onClicked.addListener((tab) => {
    // Chrome accepts sidePanel.open() only synchronously inside the user gesture:
    // nothing may be awaited before this call.
    void browser.sidePanel.open({ windowId: tab.windowId })
  })
})
