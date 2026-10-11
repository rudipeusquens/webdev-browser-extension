// The Pin chip in Browse mode (spec section 8): offered for the page's selection once the user
// lets go of the mouse or a key, below the selection's end while any of it is in view, and
// gone as soon as the selection changes.

import { computed, onBeforeUnmount, type Ref, shallowRef } from 'vue'
import {
  chipAnchor,
  firstShownCharacter,
  rangeContainer,
  sameRange,
  selectionRange,
} from '@/lib/capture/text'
import type { Mode } from '@/lib/messages'
import { clippersOf, inBounds, notRendered, toRect, visibleBounds } from './pins'

interface SelectionChipInput {
  /** The overlay's host: releases inside the overlay reach the window as its own. */
  host: HTMLElement
  mode: Ref<Mode>
  /** The open popover: no chip while there is one. */
  draft: Readonly<Ref<unknown>>
  frame: Ref<number>
}

export function useSelectionChip({ host, mode, draft, frame }: SelectionChipInput) {
  // The page's selection the Pin chip offers to pin (browse mode), the character the chip sits
  // under, and the first one the selection shows.
  const chip = shallowRef<{ range: Range; anchor: Range; start: Range | null } | null>(null)
  let chipCheck = 0

  // The scroll containers and clipping boxes around the chip's selection: looked up once per
  // selection, measured on every frame.
  const chipClippers = computed(() => {
    const anchor = chip.value?.anchor
    return anchor ? clippersOf(rangeContainer(anchor), true) : []
  })
  const chipLine = computed(() => {
    void frame.value
    const anchor = chip.value?.anchor
    if (!anchor || mode.value !== 'browse' || draft.value) return null
    const r = anchor.getBoundingClientRect()
    const line = toRect(r)
    // The page hid the selection's end (a menu closed): it would sit in the corner.
    if (notRendered(line)) return null
    // From the first character to the last: a long selection keeps its chip at the edge while
    // any of it is in view.
    const s = chip.value?.start?.getBoundingClientRect() ?? r
    const x = Math.min(r.x, s.x)
    const y = Math.min(r.y, s.y)
    const span = {
      x,
      y,
      width: Math.max(r.right, s.right) - x,
      height: Math.max(r.bottom, s.bottom) - y,
    }
    const viewport = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
    // Scrolled out of view or out of its box: no chip, until the selection is back.
    const bounds = visibleBounds(chipClippers.value, viewport)
    return bounds && inBounds(span, bounds) ? line : null
  })

  /**
   * Offers the chip for the page's selection after the user let go of the mouse or a key: a
   * selection the page makes by script gets none. The check waits a frame, until the
   * selection has settled. Releases inside the overlay reach the window as the host's and are
   * not checked, except over a pin (its own listener): a selection dragged onto a pin.
   */
  function onRelease(e: Event) {
    if (!e.isTrusted || e.target === host || mode.value !== 'browse' || draft.value) return
    cancelAnimationFrame(chipCheck)
    chipCheck = requestAnimationFrame(() => {
      const range = selectionRange(document)
      const anchor = range && chipAnchor(range)
      chip.value = range && anchor ? { range, anchor, start: firstShownCharacter(range) } : null
    })
  }

  /** Hides the chip as soon as the selection it was offered for changes. */
  function onSelectionChange() {
    const offered = chip.value
    if (!offered) return
    const current = selectionRange(document)
    if (!current || !sameRange(current, offered.range)) chip.value = null
  }

  onBeforeUnmount(() => cancelAnimationFrame(chipCheck))
  return { chip, chipLine, onRelease, onSelectionChange }
}
