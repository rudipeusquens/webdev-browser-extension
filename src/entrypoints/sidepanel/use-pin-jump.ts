// Go to and a click on an entry (spec section 8): on the current page the overlay opens the
// pin; on another page of the site the tab goes there first, and the pin opens once that
// page's overlay answers.

import { onBeforeUnmount, type Ref, watch } from 'vue'
import { browser } from 'wxt/browser'
import { isObject } from '@/lib/collection/validate'
import { type BackgroundMessage, type OverlayMessage, PIN_NOT_KEPT } from '@/lib/messages'
import type { TabStatus } from './use-active-tab'

/** How long a jump to an item of another page waits for that page's overlay. */
const JUMP_WAIT = 30_000

/**
 * Go to, and the entries' jump and reveal; each cancels a jump that still waits. `change`
 * sends Go to and shows its refusal; a pin the overlay would not open is said in `panelError`.
 */
export function usePinJump(
  tabId: Ref<number | undefined>,
  status: Ref<TabStatus>,
  change: (message: BackgroundMessage) => Promise<boolean>,
  panelError: Ref<string>,
): {
  goTo: (pageKey: string) => void
  jumpTo: (pageKey: string, id: string) => void
  reveal: (id: string) => void
} {
  let jump: {
    tab: number
    pageKey: string
    id: string
    timer: ReturnType<typeof setTimeout>
  } | null = null

  function cancelJump() {
    if (jump) clearTimeout(jump.timer)
    jump = null
  }

  function goTo(pageKey: string) {
    cancelJump()
    if (tabId.value === undefined) return
    void change({ type: 'tab:go', tabId: tabId.value, pageKey })
  }

  /** An entry of another page: open the page in the tab, then show the item once it is ready. */
  function jumpTo(pageKey: string, id: string) {
    cancelJump()
    const tab = tabId.value
    if (tab === undefined) return
    // Set before the page loads: its overlay may answer before Go to does.
    const pending = { tab, pageKey, id, timer: setTimeout(cancelJump, JUMP_WAIT) }
    jump = pending
    void change({ type: 'tab:go', tabId: tab, pageKey }).then((went) => {
      if (!went && jump === pending) cancelJump()
    })
  }

  /**
   * Opens a pin on the tab's page. The overlay refuses only while its popover holds unsaved
   * text: that is shown, as a refused change is, until something works.
   */
  async function showPin(id: string) {
    if (tabId.value === undefined) return
    const message: OverlayMessage = { type: 'overlay:reveal', id }
    const reply: unknown = await browser.tabs
      .sendMessage(tabId.value, message, { frameId: 0 })
      .catch(() => undefined)
    if (isObject(reply) && reply.ok === false) panelError.value = PIN_NOT_KEPT
    else if (isObject(reply) && reply.ok === true) panelError.value = ''
  }

  watch(status, (now) => {
    if (!jump || now.kind !== 'active') return
    if (tabId.value !== jump.tab || now.pageKey !== jump.pageKey) return
    const { id } = jump
    cancelJump()
    void showPin(id)
  })

  function reveal(id: string) {
    cancelJump()
    void showPin(id)
  }

  onBeforeUnmount(cancelJump)
  return { goTo, jumpTo, reveal }
}
