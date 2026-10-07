import styles from '@/assets/tailwind.css?inline'
import { type App as VueApp, createApp } from 'vue'
import { browser } from 'wxt/browser'
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root'
import { defineContentScript } from 'wxt/utils/define-content-script'
import type { BackgroundMessage } from '@/lib/messages'
import Overlay from './Overlay.vue'
import { keepOnTop } from './top-layer'

// Stopped at the shadow root, so page listeners in the bubble phase never see what happens
// inside the overlay (shortcuts, outside-click handlers, focus traps, paste handlers).
const ISOLATED_EVENTS = [
  'keydown',
  'keyup',
  'keypress',
  'beforeinput',
  'input',
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
  'focusin',
  'focusout',
  'paste',
  'copy',
  'cut',
  'dragenter',
  'dragover',
  'dragleave',
  'drop',
  'compositionstart',
  'compositionupdate',
  'compositionend',
]

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
  // Everything lives inside main: WXT strips its body when it reads this file's options at
  // build time, and code outside it would be evaluated there.
  async main(ctx) {
    try {
      // Every injection mounts. A repeated injection (where the last overlay did not answer)
      // starts a new context; WXT then invalidates the previous one, which removes its UI.
      const ui = await createShadowRootUi<VueApp>(ctx, {
        // A built-in element: a custom element name could be defined by the page first, which
        // then constructs the host and, through ElementInternals, reaches the closed shadow
        // root. A div runs no page code and has no internals.
        name: 'div',
        position: 'overlay',
        zIndex: 2147483647,
        anchor: 'body',
        append: 'last',
        mode: 'closed',
        // WXT moves @property rules into the page's <head>, where they would also apply to the
        // page's own --tw-* variables (`inherits: false` breaks inheritance). Ours get a name
        // no page uses.
        css: styles.replaceAll(':root', ':host').replaceAll('--tw-', '--webdev-tw-'),
        isolateEvents: ISOLATED_EVENTS,
        onMount(container, shadow, host) {
          const layer = keepOnTop(host, shadow)
          // Registered after WXT's own cleanup, so the host is gone before this stops watching.
          ctx.onInvalidated(layer.stop)
          const app = createApp(Overlay, { host, layer })
          // Vue's production build only logs errors in setup, render and hooks: one while the
          // app mounts means the overlay did not start. Later ones are logged as Vue would.
          let starting = true
          let failure: { error: unknown } | undefined
          app.config.errorHandler = (error) => {
            if (starting) failure ??= { error }
            else console.error(error)
          }
          app.mount(container)
          starting = false
          if (failure) {
            app.unmount()
            throw failure.error
          }
          return app
        },
        onRemove(app) {
          app?.unmount()
        },
      })
      try {
        ui.mount()
      } catch (error) {
        // Nothing half-mounted stays on the page.
        ui.remove()
        throw error
      }
      // After the extension is reloaded or updated, this script is orphaned: it cannot reach
      // the extension anymore. WXT's interval notices (`browser.runtime.id` is gone) and
      // invalidates the context, which removes the overlay.
      ctx.setInterval(() => undefined, 1000)
      globalThis.__webdevOverlay = { shadow: ui.shadow }
    } catch (error) {
      // WXT's production build logs nothing when a content script fails to start: say it
      // here, and tell the panel. The error stays on the page, it may hold page content.
      console.error('Webdev Browser Extension: The overlay could not start on this page.', error)
      const failed: BackgroundMessage = { type: 'overlay:failed' }
      browser.runtime.sendMessage(failed).catch(() => undefined)
    }
  },
})
