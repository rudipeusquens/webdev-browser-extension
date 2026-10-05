import styles from '@/assets/tailwind.css?inline'
import { type App as VueApp, createApp } from 'vue'
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root'
import { defineContentScript } from 'wxt/utils/define-content-script'
import Overlay from './Overlay.vue'

declare global {
  // Set in the content-script world only, for E2E tests to reach the closed shadow root.
  // Never read by extension code: a page can shadow the name with an element id.
  var __webdevOverlay: { shadow?: ShadowRoot } | undefined
}

export default defineContentScript({
  // Injected by the background after an action click; never declared in the manifest.
  registration: 'runtime',
  // CSS is passed inline: with 'ui' mode Chrome would block the stylesheet fetch.
  cssInjectionMode: 'manual',
  async main(ctx) {
    // Every injection mounts. A repeated injection (second action click) starts a new
    // context; WXT then invalidates the previous one, which removes its UI.
    const ui = await createShadowRootUi<VueApp>(ctx, {
      name: 'webdev-overlay',
      position: 'overlay',
      zIndex: 2147483647,
      anchor: 'body',
      append: 'last',
      mode: 'closed',
      css: styles.replaceAll(':root', ':host'),
      onMount(container) {
        const app = createApp(Overlay, { portalTarget: container })
        app.mount(container)
        return app
      },
      onRemove(app) {
        app?.unmount()
      },
    })
    ui.mount()
    globalThis.__webdevOverlay = { shadow: ui.shadow }
  },
})
