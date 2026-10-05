// Finding and walking the element under the pointer in element mode.

/** The page element under a viewport point, skipping the overlay host; never the root. */
export function pickAt(doc: Document, x: number, y: number, host: Element): Element | null {
  const el = doc.elementsFromPoint(x, y).find((candidate) => candidate !== host)
  return !el || el === doc.documentElement ? null : el
}

/** `↑` goes to the parent (up to `body`), `↓` back down the same way, else to the first child. */
export class TargetPath {
  private readonly trail: Element[] = []

  constructor(
    public current: Element,
    private readonly skip?: Element,
  ) {}

  up(): Element {
    const parent = this.current.parentElement
    if (parent && this.current.localName !== 'body' && parent.localName !== 'html') {
      this.trail.push(this.current)
      this.current = parent
    }
    return this.current
  }

  down(): Element {
    const back = this.trail.pop()
    if (back) return (this.current = back)
    let child = this.current.firstElementChild
    while (child && child === this.skip) child = child.nextElementSibling
    if (child) this.current = child
    return this.current
  }
}

const TEXT_INPUTS = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
])

/** Whether typing goes into `el`: then single-key shortcuts must stay off. */
export function isEditable(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLInputElement) return TEXT_INPUTS.has(el.type)
  const region = el.closest('[contenteditable]')
  return region !== null && region.getAttribute('contenteditable') !== 'false'
}

/** The focused element, looking into open shadow roots. */
export function deepActiveElement(doc: Document): Element | null {
  let active = doc.activeElement
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
  return active
}

/** The nearest ancestor that scrolls on `axis`, else the document's scrolling element. */
export function scrollableAncestor(el: Element | null, vertical: boolean): Element | null {
  for (
    let node = el;
    node && node !== node.ownerDocument.documentElement;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node)
    const overflow = vertical ? style.overflowY : style.overflowX
    const room = vertical
      ? node.scrollHeight > node.clientHeight
      : node.scrollWidth > node.clientWidth
    if (room && /auto|scroll|overlay/.test(overflow)) return node
  }
  return el?.ownerDocument.scrollingElement ?? null
}
