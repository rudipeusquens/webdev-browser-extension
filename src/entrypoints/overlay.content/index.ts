import styles from '@/assets/tailwind.css?inline'
import { type App as VueApp, createApp } from 'vue'
import { browser } from 'wxt/browser'
import { ContentScriptContext } from 'wxt/utils/content-script-context'
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root'
import { defineContentScript } from 'wxt/utils/define-content-script'
import type { BackgroundMessage } from '@/lib/messages'
import Overlay from './Overlay.vue'
import { overlayCss } from './overlay-css'
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
  // WXT would tell the page that a content script started, with the extension's id.
  noScriptStartedPostMessage: true,
  // Everything lives inside main: WXT strips its body when it reads this file's options at
  // build time, and code outside it would be evaluated there.
  async main() {
    /**
     * WXT's context without its start signal: WXT's own takes a document event as the start
     * of a newer script, and a page can fake that event to remove the overlay. A newer overlay
     * stops this one through the content-script world instead, which the page cannot reach.
     */
    class OverlayContext extends ContentScriptContext {
      override stopOldScripts() {}
      override listenForNewerScripts() {}
    }
    const ctx = new OverlayContext('overlay', {
      registration: 'runtime',
      cssInjectionMode: 'manual',
      noScriptStartedPostMessage: true,
    })
    // A symbol, not a name: a page's element ids show up as names on the window here too.
    const STOP = Symbol.for('webdev-overlay:stop')
    const world = globalThis as unknown as Record<symbol, (() => void) | undefined>
    world[STOP]?.()
    world[STOP] = () => ctx.notifyInvalidated()
    try {
      // Every injection mounts. A repeated injection (where the last overlay did not answer)
      // stopped the previous one above, which removed its UI.
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
        css: overlayCss(styles),
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
      // the extension anymore. The context's interval notices (`browser.runtime.id` is gone)
      // and invalidates it, which removes the overlay.
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
