// Finding and walking the element under the pointer in element mode. DOM reads go through
// src/lib/capture/dom.ts: page markup cannot redirect them.

import {
  closestOf,
  firstChildOf,
  MAX_DEPTH,
  nextSiblingOf,
  ownerDocumentOf,
  parentOf,
  tagOf,
} from '@/lib/capture/dom'

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
    const parent = parentOf(this.current)
    if (parent && tagOf(this.current) !== 'body' && tagOf(parent) !== 'html') {
      this.trail.push(this.current)
      this.current = parent
    }
    return this.current
  }

  down(): Element {
    const back = this.trail.pop()
    if (back) return (this.current = back)
    let child = firstChildOf(this.current)
    while (child && child === this.skip) child = nextSiblingOf(child)
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
  const region = closestOf(el, '[contenteditable]')
  return region !== null && region.getAttribute('contenteditable') !== 'false'
}

/** Whether the glass scrolls the page for this wheel turn; Ctrl or Cmd zooms instead. */
export function forwardsWheel(e: Pick<WheelEvent, 'ctrlKey' | 'metaKey'>): boolean {
  return !e.ctrlKey && !e.metaKey
}

/**
 * What a wheel turn scrolls: a scroll container (scrolled by the overlay), `'page'` (the
 * browser scrolls the document under the glass by itself) or null (nothing scrolls).
 */
export type WheelTarget = Element | 'page' | null

/** An overflow that is `visible`; happy-dom (unit tests) leaves an unset one empty. */
const isVisible = (overflow: string) => overflow === 'visible' || overflow === ''

/**
 * Where a wheel turn of `delta` pixels on one axis goes, as the browser would send it if the
 * glass were not there: the nearest scroll container around `el` that can still move that way;
 * nothing past a container that keeps the wheel at its end (`overscroll-behavior`); else the
 * page. The browser chains a turn over the glass to the document only.
 */
export function wheelTarget(el: Element | null, vertical: boolean, delta: number): WheelTarget {
  if (!el) return 'page'
  const doc = ownerDocumentOf(el)
  // While the root's overflow is visible, the body's belongs to the viewport: the body is no
  // scroll container then, whatever its own overflow says.
  const root = getComputedStyle(doc.documentElement)
  const bodyScrolls = !isVisible(root.overflowX) || !isVisible(root.overflowY)
  let node: Element | null = el
  for (let depth = 0; node && depth < MAX_DEPTH; depth++, node = parentOf(node)) {
    if (node === doc.documentElement || (node === doc.body && !bodyScrolls)) break
    const style = getComputedStyle(node)
    const overflow = vertical ? style.overflowY : style.overflowX
    if (!/auto|scroll|overlay/.test(overflow)) continue
    const at = vertical ? node.scrollTop : node.scrollLeft
    const end = vertical
      ? node.scrollHeight - node.clientHeight
      : node.scrollWidth - node.clientWidth
    // Rounding leaves a fraction of a pixel at the end.
    if (delta > 0 ? at < end - 1 : delta < 0 && at > 0) return node
    const keeps = style.getPropertyValue(
      vertical ? 'overscroll-behavior-y' : 'overscroll-behavior-x',
    )
    if (end > 0 && keeps && keeps !== 'auto') return null
  }
  return 'page'
}
