// Reading the text a page shows, from its text nodes. Neither `innerText` (it lists every
// option of a `<select>`) nor `Selection.toString()` (it returns a focused field's value) is
// used: form fields, scripts, styles and text the page does not show are skipped here, so no
// field value ever reaches a snapshot (spec section 6). Every walk has a budget.

import { LIMITS } from '../collection/model'
import { collapse, truncate } from '../text'
import { closestOf, MAX_DEPTH, parentOf, tagOf } from './dom'

const SKIPPED_TAGS = new Set([
  'input',
  'textarea',
  'select',
  'option',
  'optgroup',
  'datalist',
  'script',
  'style',
  'noscript',
  'template',
])
const SKIPPED = [...SKIPPED_TAGS].join(', ')
// Displays that do not start a box of their own: their text runs on with the text around.
const INLINE_DISPLAYS = new Set(['', 'inline', 'contents'])

/** Most nodes one walk looks at; a longer walk stops and marks its text as cut. */
export const NODE_BUDGET = 5000

class BudgetExhausted extends Error {}

export const elementOf = (node: Node): Element | null =>
  node instanceof Element ? node : node.parentElement

/**
 * Which nodes hold text the page shows, and which box each one belongs to. `selectable`
 * also leaves out text that cannot be selected (`user-select: none`): a selection never
 * contains it, although the page shows it.
 */
export class TextReader {
  private readonly styles = new Map<Element, CSSStyleDeclaration>()
  private readonly shown = new Map<Element, boolean>()
  private visited = 0

  constructor(
    private readonly view: Window,
    private readonly selectable = false,
  ) {}

  private style(el: Element): CSSStyleDeclaration {
    let style = this.styles.get(el)
    if (!style) {
      style = this.view.getComputedStyle(el)
      this.styles.set(el, style)
    }
    return style
  }

  /** Whether the text directly inside `el` counts. */
  private shows(el: Element): boolean {
    let shown = this.shown.get(el)
    if (shown === undefined) {
      const style = this.style(el)
      shown =
        closestOf(el, SKIPPED) === null &&
        (Element.prototype.checkVisibility?.call(el) ?? true) &&
        style.visibility !== 'hidden' &&
        style.visibility !== 'collapse' &&
        !(this.selectable && style.userSelect === 'none')
      this.shown.set(el, shown)
    }
    return shown
  }

  /** Accepts text nodes that count and `<br>`; rejects subtrees that never show text. */
  private readonly filter = (node: Node): number => {
    if (++this.visited > NODE_BUDGET) throw new BudgetExhausted()
    if (node instanceof Text) {
      const parent = node.parentElement
      return parent && this.shows(parent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    }
    if (!(node instanceof Element)) return NodeFilter.FILTER_SKIP
    const tag = tagOf(node)
    if (SKIPPED_TAGS.has(tag)) return NodeFilter.FILTER_REJECT
    if (tag === 'br' && this.shows(node)) return NodeFilter.FILTER_ACCEPT
    return NodeFilter.FILTER_SKIP
  }

  /** The nearest ancestor (inclusive) laid out as a box of its own. */
  blockOf(node: Node): Element | null {
    let el = elementOf(node)
    for (let depth = 0; el && depth < MAX_DEPTH; depth++, el = parentOf(el)) {
      if (!INLINE_DISPLAYS.has(this.style(el).display)) return el
    }
    return null
  }

  /** Runs `walk` with a fresh budget; true when the budget ran out. */
  run(root: Node, walk: (walker: TreeWalker, accepts: (node: Node) => boolean) => void): boolean {
    const doc = root.ownerDocument ?? (root as Document)
    this.visited = 0
    const walker = doc.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      this.filter,
    )
    try {
      walk(walker, (node) => this.filter(node) === NodeFilter.FILTER_ACCEPT)
      return false
    } catch (error) {
      if (error instanceof BudgetExhausted) return true
      throw error
    }
  }
}

export interface Piece {
  text: string
  /** The box the text belongs to; text of different boxes is separated by a space. */
  block: Element | null
}

export interface Read {
  pieces: Piece[]
  /** The walk stopped before its end: there was more text. */
  cut: boolean
}

const pieceOf = (reader: TextReader, node: Node, text: string): Piece => ({
  text: node instanceof Text ? text : ' ',
  block: reader.blockOf(node),
})

/** Joins pieces; pieces from different boxes are separated by a space. */
export function join(pieces: Piece[]): string {
  return pieces
    .map((p, i) => (i > 0 && pieces[i - 1]?.block !== p.block ? ` ${p.text}` : p.text))
    .join('')
}

/** The first node at or after the boundary point (`container`, `offset`), in tree order. */
function nodeAt(container: Node, offset: number): Node | null {
  if (container instanceof CharacterData) return container
  const child = container.childNodes[offset]
  if (child) return child
  let node: Node | null = container
  for (let depth = 0; node && !node.nextSibling && depth < MAX_DEPTH; depth++) {
    node = node.parentNode
  }
  return node?.nextSibling ?? null
}

export interface Until {
  /** The node is past the end: stop before it. */
  stop: boolean
  /** The node is the last one; read its text up to this offset. */
  endOffset?: number
}

/**
 * Text inside `root` from the boundary point (`container`, `offset`) on, until `until` stops
 * the walk or more than `limit` characters were read.
 */
export function readForward(
  reader: TextReader,
  root: Node,
  container: Node,
  offset: number,
  until: (node: Node) => Until,
  limit: number,
): Read {
  const pieces: Piece[] = []
  let cut = false
  const exhausted = reader.run(root, (walker, accepts) => {
    let node = nodeAt(container, offset)
    if (!node) return
    walker.currentNode = node
    if (!accepts(node)) node = walker.nextNode()
    let length = 0
    for (; node; node = walker.nextNode()) {
      const { stop, endOffset } = until(node)
      if (stop) return
      const from = node === container ? offset : 0
      const text = node instanceof Text ? node.data.slice(from, endOffset ?? node.data.length) : ''
      pieces.push(pieceOf(reader, node, text))
      length += text.length
      if (endOffset !== undefined) return
      if (length > limit) {
        cut = true
        return
      }
    }
  })
  return { pieces, cut: cut || exhausted }
}

/**
 * Text inside `root` before the boundary point (`container`, `offset`), until more than
 * `limit` characters (collapsed) were read.
 */
export function readBackward(
  reader: TextReader,
  root: Node,
  container: Node,
  offset: number,
  limit: number,
): Read {
  // Newest first while reading.
  const pieces: Piece[] = []
  const enough = () => [...collapse(join([...pieces].reverse()))].length > limit
  let cut = false
  const exhausted = reader.run(root, (walker, accepts) => {
    let node: Node | null
    if (container instanceof CharacterData) {
      if (accepts(container)) {
        pieces.push(pieceOf(reader, container, (container as Text).data.slice(0, offset)))
      }
      walker.currentNode = container
      node = walker.previousNode()
    } else {
      const before = container.childNodes[offset - 1]
      if (!before) {
        walker.currentNode = container
        node = walker.previousNode()
      } else if (accepts(before)) {
        node = before
      } else {
        walker.currentNode = before
        node = walker.lastChild()
        if (!node) {
          walker.currentNode = before
          node = walker.previousNode()
        }
      }
    }
    for (; node; node = walker.previousNode()) {
      if (enough()) {
        cut = true
        return
      }
      pieces.push(pieceOf(reader, node, node instanceof Text ? node.data : ''))
    }
    cut = enough()
  })
  return { pieces: pieces.reverse(), cut: cut || exhausted }
}

/** `text` capped at `max` code points; `…` also when the walk was cut before `max`. */
export function capText(text: string, max: number, cut: boolean): string {
  if (!cut || [...text].length >= max) return truncate(text, max)
  return `${text}…`
}

/** The text an element shows, collapsed, capped at `max` (spec section 6). */
export function shownText(el: Element, view: Window, max: number = LIMITS.text): string {
  const read = readForward(new TextReader(view), el, el, 0, () => ({ stop: false }), max * 8)
  const text = collapse(join(read.pieces)).trim()
  return text ? capText(text, max, read.cut) : ''
}
