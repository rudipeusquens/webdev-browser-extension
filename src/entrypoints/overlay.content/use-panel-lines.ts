// The lines the side panel keeps open to this overlay: the panel learns what the pins point
// at, and the overlay learns when the panel moves away or closes.

import { type Ref, watch } from 'vue'
import { browser, type Browser } from 'wxt/browser'
import { isPanelAway, type Mode, type PinsPointed } from '@/lib/messages'

interface PanelLinesInput {
  /** The pin the pointer rests on. */
  hoveredPin: Ref<string | null>
  /** The open popover, and the item it edits. */
  draft: Readonly<Ref<{ edit?: { id: string } } | null>>
  /** The pin the panel highlights. */
  highlighted: Ref<string | null>
  setMode: (next: Mode) => void
}

export function usePanelLines({ hoveredPin, draft, highlighted, setMode }: PanelLinesInput) {
  /**
   * The panel keeps a line open to every overlay it has shown. When it moves to another tab, its
   * highlight goes; when it closes, the line goes and the page is left to work normally (spec
   * section 8).
   */
  const panels = new Set<Browser.runtime.Port>()

  /** What the pins point at, by id only: the panel marks the entries (spec section 8). */
  function pointedNow(): PinsPointed {
    return {
      type: 'pins:pointed',
      hovered: hoveredPin.value,
      open: draft.value?.edit?.id ?? null,
      popover: draft.value !== null,
    }
  }

  function tellPanels(message: PinsPointed) {
    for (const port of panels) {
      try {
        port.postMessage(message)
      } catch {
        panels.delete(port)
      }
    }
  }

  watch([hoveredPin, () => draft.value?.edit?.id ?? null, () => draft.value !== null], () =>
    tellPanels(pointedNow()),
  )

  const onConnect: Parameters<typeof browser.runtime.onConnect.addListener>[0] = (port) => {
    if (port.name !== 'panel' || port.sender?.id !== browser.runtime.id) return
    panels.add(port)
    port.onMessage.addListener((message) => {
      if (isPanelAway(message)) highlighted.value = null
    })
    port.onDisconnect.addListener(() => {
      panels.delete(port)
      highlighted.value = null
      setMode('browse')
    })
    const now = pointedNow()
    if (now.hovered || now.open || now.popover) tellPanels(now)
  }

  return { panels, onConnect }
}
