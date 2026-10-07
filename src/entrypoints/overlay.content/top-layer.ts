// Keeps the overlay host in the browser's top layer, above everything a page can show.
//
// A z-index cannot beat the top layer (modal dialogs, popovers, fullscreen), so the host is a
// manual popover. A modal dialog also makes every node outside it inert, top-layer elements
// included, so while one is open the host lives inside it (spec section 13, spike 3). Script
// focus traps pull focus out of anything outside their container, so while a comment is
// written the host can also live inside such a container (`contain`).

import { shadowRootOf } from '@/lib/capture/dom'

export interface Layer {
  /** Prefer `container` as the host's parent (null: back to normal); it must be connected. */
  contain(container: Element | null): void
  /**
   * Stacks the host above what the page opened later, at most once a second: something of the
   * page lies over it that its toggle listener did not see (a popover inside a shadow root).
   */
  raise(): void
  stop(): void
}

/** How often `raise` may re-stack the host: a page that re-stacks its own cover each time
 * would otherwise keep both busy. */
const RAISE_EVERY = 1000

const isOpenModal = (d: HTMLDialogElement) => d.isConnected && d.open && d.matches(':modal')

/** Open modal dialogs in the shadow tree of `host`, including nested components. */
function modalsInside(host: Element): HTMLDialogElement[] {
  const found: HTMLDialogElement[] = []
  const root = shadowRootOf(host)
  if (!root) return found
  for (const dialog of root.querySelectorAll('dialog')) {
    if (isOpenModal(dialog)) found.push(dialog)
  }
  for (const el of root.querySelectorAll('*')) found.push(...modalsInside(el))
  return found
}

const OBSERVED: MutationObserverInit = {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['open', 'inert'],
}

export function keepOnTop(host: HTMLElement, shadow: ShadowRoot): Layer {
  // Modal dialogs in the order they opened; the last one is on top.
  const modals: HTMLDialogElement[] = []
  const observedRoots = new WeakSet<Node>()
  let container: Element | null = null
  let stopped = false
  let raisedAt = -Infinity

  function topModal(): HTMLDialogElement | undefined {
    for (let i = modals.length - 1; i >= 0; i--) {
      if (!isOpenModal(modals[i] as HTMLDialogElement)) modals.splice(i, 1)
    }
    return modals.at(-1)
  }

  function preferredParent(): Element {
    const modal = topModal()
    const contained = container?.isConnected && (!modal || modal.contains(container))
    return (contained ? container : modal) ?? document.body
  }

  /** Moves the host where it is usable and shows it; `raise` re-stacks it above newer layers. */
  function place(raise: boolean) {
    if (stopped) return
    const focused = shadow.activeElement
    const parent = preferredParent()
    const moved = host.parentNode !== parent
    // Moving a popover hides it, and so does hiding it to re-raise: focus is lost either way.
    if (moved) parent.append(host)
    if (host.hasAttribute('inert')) host.removeAttribute('inert')
    try {
      if (raise && !moved && host.matches(':popover-open')) host.hidePopover()
      if (!host.matches(':popover-open')) host.showPopover()
    } catch {
      // Not connected or the document is going away: the next mutation tries again.
      return
    }
    if ((moved || raise) && focused instanceof HTMLElement) focused.focus({ preventScroll: true })
  }

  /** Tracks a newly opened modal; mutations inside a shadow tree need their own observation. */
  function track(dialog: HTMLDialogElement): boolean {
    if (modals.includes(dialog)) return false
    modals.push(dialog)
    dialog.addEventListener('close', () => place(false), { once: true })
    const root = dialog.getRootNode()
    if (root instanceof ShadowRoot && !observedRoots.has(root)) {
      observedRoots.add(root)
      observer.observe(root, OBSERVED)
    }
    return true
  }

  function onMutations(records: MutationRecord[]) {
    let raise = false
    for (const record of records) {
      const target = record.target
      if (
        record.type === 'attributes' &&
        record.attributeName === 'open' &&
        target instanceof HTMLDialogElement &&
        isOpenModal(target)
      ) {
        raise = track(target) || raise
      }
    }
    place(raise)
  }

  function onToggle(event: Event) {
    const state = (event as ToggleEvent).newState
    // The page hid the host's popover: show it again. A re-stack of our own shows it at once,
    // so its toggle reports it open.
    if (event.target === host) {
      if (state === 'closed') place(false)
      return
    }
    // A page popover opened above the host.
    if (state === 'open') place(true)
  }

  // showModal() moves focus into the dialog; focus events cross shadow boundaries, attribute
  // mutations inside shadow trees do not reach the document observer.
  function onFocusIn(event: Event) {
    const target = event.target
    if (!(target instanceof Element) || target === host || !shadowRootOf(target)) return
    let raise = false
    for (const dialog of modalsInside(target)) raise = track(dialog) || raise
    if (raise) place(true)
  }

  const onFullscreen = () => place(true)

  const observer = new MutationObserver(onMutations)
  host.setAttribute('popover', 'manual')
  for (const dialog of document.querySelectorAll('dialog')) {
    if (isOpenModal(dialog)) track(dialog)
  }
  for (const el of document.querySelectorAll('*')) {
    if (el !== host) for (const dialog of modalsInside(el)) track(dialog)
  }
  observer.observe(document.documentElement, OBSERVED)
  document.addEventListener('toggle', onToggle, true)
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('fullscreenchange', onFullscreen)
  place(false)

  return {
    contain(next) {
      container = next
      place(false)
    },
    raise() {
      const now = performance.now()
      if (now - raisedAt < RAISE_EVERY) return
      raisedAt = now
      place(true)
    },
    stop() {
      stopped = true
      observer.disconnect()
      document.removeEventListener('toggle', onToggle, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('fullscreenchange', onFullscreen)
    },
  }
}
