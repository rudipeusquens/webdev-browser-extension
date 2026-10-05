// Keeps the overlay host in the browser's top layer, above everything a page can show.
//
// A z-index cannot beat the top layer (modal dialogs, popovers, fullscreen), so the host is a
// manual popover. A modal dialog also makes every node outside it inert, top-layer elements
// included, so while one is open the host lives inside it (spec section 13, spike 3).

export function keepOnTop(host: HTMLElement, shadow: ShadowRoot): () => void {
  // Modal dialogs in the order they opened; the last one is on top.
  const modals: HTMLDialogElement[] = []
  let stopped = false

  const isOpenModal = (d: HTMLDialogElement) => d.isConnected && d.open && d.matches(':modal')

  function topModal(): HTMLDialogElement | undefined {
    for (let i = modals.length - 1; i >= 0; i--) {
      if (!isOpenModal(modals[i] as HTMLDialogElement)) modals.splice(i, 1)
    }
    return modals.at(-1)
  }

  /** Moves the host where it is usable and shows it; `raise` re-stacks it above newer layers. */
  function place(raise: boolean) {
    if (stopped) return
    const focused = shadow.activeElement
    const parent = topModal() ?? document.body
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

  function onMutations(records: MutationRecord[]) {
    let raise = false
    for (const record of records) {
      const target = record.target
      if (
        record.type === 'attributes' &&
        record.attributeName === 'open' &&
        target instanceof HTMLDialogElement &&
        isOpenModal(target) &&
        !modals.includes(target)
      ) {
        modals.push(target)
        raise = true
      }
    }
    place(raise)
  }

  function onToggle(event: Event) {
    // A page popover opened above the host.
    if (event.target !== host && (event as ToggleEvent).newState === 'open') place(true)
  }

  const onFullscreen = () => place(true)

  host.setAttribute('popover', 'manual')
  for (const dialog of document.querySelectorAll('dialog')) {
    if (isOpenModal(dialog)) modals.push(dialog)
  }
  const observer = new MutationObserver(onMutations)
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['open', 'inert'],
  })
  document.addEventListener('toggle', onToggle, true)
  document.addEventListener('fullscreenchange', onFullscreen)
  place(false)

  return () => {
    stopped = true
    observer.disconnect()
    document.removeEventListener('toggle', onToggle, true)
    document.removeEventListener('fullscreenchange', onFullscreen)
  }
}
