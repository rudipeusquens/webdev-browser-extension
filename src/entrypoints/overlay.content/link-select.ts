// Ctrl+drag (⌘+drag on macOS) in Browse mode selects text, also inside a link, while the panel
// is open (spec section 8). Chrome drags a link instead of selecting its text; made not
// draggable, it still starts no selection on the first half of the link's first character,
// where a drag over a link's text begins (spike, 2026-10-09). So with the modifier the overlay
// selects by itself: the press is kept from the page (no drag, no focus, no handler) and puts
// the caret under the pointer, each move extends the selection to the caret under the pointer,
// a double click selects the word. Nothing is added to the page; the selection is the page's
// own, so the Pin chip comes as for any other. A click with the modifier never reaches the
// page: no link opens, no tab, no handler runs.

export interface CaretPoint {
  node: Node
  offset: number
}

/** What the gesture uses of the page; tests pass plain objects. */
export interface SelectSurface {
  /** The caret position under a viewport point, or null (nothing there, or the overlay). */
  caretAt(x: number, y: number): CaretPoint | null
  /** Sets the page's selection from `base` to `extent` (the same point: a caret). */
  select(base: CaretPoint, extent: CaretPoint): void
}

/** When the gesture applies, and what is not the page's text. */
export interface SelectGate {
  /** The overlay's host: events inside the overlay (the chip, the pins) are its own. */
  host: EventTarget
  mac: boolean
  /** Browse mode with the panel open. */
  active(): boolean
  /** A text field keeps its own selection. */
  editable(target: EventTarget | null): boolean
}

type Caret = {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

/** The page's caret positions and selection; nothing inside the overlay counts. */
export function pageSelectSurface(doc: Document, host: Node): SelectSurface {
  const caret = doc as Document & Caret
  return {
    caretAt(x, y) {
      let at: CaretPoint | null = null
      if (typeof caret.caretPositionFromPoint === 'function') {
        const position = caret.caretPositionFromPoint(x, y)
        if (position) at = { node: position.offsetNode, offset: position.offset }
      } else if (typeof caret.caretRangeFromPoint === 'function') {
        const range = caret.caretRangeFromPoint(x, y)
        if (range) at = { node: range.startContainer, offset: range.startOffset }
      }
      if (!at || at.node === host || host.contains(at.node)) return null
      return at
    },
    select(base, extent) {
      try {
        doc.getSelection()?.setBaseAndExtent(base.node, base.offset, extent.node, extent.offset)
      } catch {
        // A node the page removed meanwhile.
      }
    },
  }
}

/** The modifier of the gesture: ⌘ on macOS, where Ctrl+click is a right click; Ctrl elsewhere. */
export function selectModifier(e: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>, mac: boolean): boolean {
  return mac ? e.metaKey : e.ctrlKey
}

/** The word around a caret in a text node, as the start and end of a selection. */
export function wordAt(at: CaretPoint): [CaretPoint, CaretPoint] | null {
  const { node, offset } = at
  if (node.nodeType !== Node.TEXT_NODE) return null
  const text = (node as Text).data
  for (const part of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) {
    const end = part.index + part.segment.length
    if (part.isWordLike && part.index <= offset && offset <= end) {
      return [
        { node, offset: part.index },
        { node, offset: end },
      ]
    }
  }
  return null
}

export function createLinkSelect(surface: SelectSurface, gate: SelectGate) {
  /** Where the press put the caret, while the button is held. */
  let anchor: CaretPoint | null = null

  const applies = (e: MouseEvent) =>
    e.isTrusted && e.target !== gate.host && selectModifier(e, gate.mac) && gate.active()

  return {
    /** A press with the modifier: the caret goes under the pointer, or the word with a double click. */
    down(e: MouseEvent) {
      anchor = null
      if (e.button !== 0 || !applies(e) || gate.editable(e.composedPath()[0] ?? null)) return
      const at = surface.caretAt(e.clientX, e.clientY)
      if (!at) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.detail >= 2) {
        const word = wordAt(at)
        if (word) surface.select(...word)
        return
      }
      anchor = at
      surface.select(at, at)
    },
    /** A move with the button held: the selection reaches the caret under the pointer. */
    move(e: MouseEvent) {
      if (!anchor) return
      if ((e.buttons & 1) === 0) {
        anchor = null
        return
      }
      const at = surface.caretAt(e.clientX, e.clientY)
      if (at) surface.select(anchor, at)
    },
    /** The release, or the window losing the focus. */
    up() {
      anchor = null
    },
    /** A click with the modifier never reaches the page. */
    click(e: MouseEvent) {
      if (!applies(e)) return
      e.preventDefault()
      e.stopImmediatePropagation()
    },
  }
}
